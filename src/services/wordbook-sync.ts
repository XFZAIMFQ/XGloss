import { t } from '../i18n'
import { browser } from 'wxt/browser'
import { z } from 'zod'
import type {
    CollectionLanguage,
    WordbookCategory,
    WordbookProfile,
    WordbookProviderType,
} from '../domain/models'

const requestTimeoutMs = 20_000
const eudicBatchSize = 100
const eudicOrigin = 'https://api.frdic.com'
const maimemoOrigin = 'https://open.maimemo.com'
const rateLimitStorageKey = 'wordbookRateLimits'

export interface WordbookRateLimitPolicy {
    shortLimit: number
    shortWindowMs: number
    longLimit: number
    longWindowMs: number
    minIntervalMs: number
    cooldown429Ms: number
    maxWaitMs: number
}

// Conservative margins below official quotas:
// - Eudic: 30 req/1min (1h ban), 500 req/30min (24h ban) -> 25/1min, 450/30min.
// - MaiMemo: 20 req/10s, 40 req/60s -> 15/10s, 32/60s.
export const defaultWordbookRateLimits: Record<WordbookProviderType, WordbookRateLimitPolicy> = {
    eudic: {
        shortLimit: 25,
        shortWindowMs: 60_000,
        longLimit: 450,
        longWindowMs: 30 * 60_000,
        minIntervalMs: 350,
        cooldown429Ms: 60 * 60_000,
        maxWaitMs: 65_000,
    },
    maimemo: {
        shortLimit: 15,
        shortWindowMs: 10_000,
        longLimit: 32,
        longWindowMs: 60_000,
        minIntervalMs: 350,
        cooldown429Ms: 60_000,
        maxWaitMs: 65_000,
    },
}

export class WordbookRateLimitError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'WordbookRateLimitError'
    }
}

export interface RateLimitStorageLike {
    get(key: string): Promise<Record<string, unknown>>
    set(items: Record<string, unknown>): Promise<void>
}

interface ProfileRateState {
    timestamps: number[]
    blockedUntil: number
}

const persistedRateStateSchema = z.record(
    z.string(),
    z.object({
        timestamps: z.array(z.number().finite()).max(1000).default([]),
        blockedUntil: z.number().finite().default(0),
    }),
)

function formatWaitMinutes(waitMs: number): number {
    return Math.max(1, Math.ceil(waitMs / 60_000))
}

export class WordbookRateLimiter {
    private states = new Map<string, ProfileRateState>()
    private chains = new Map<string, Promise<void>>()
    private loaded = false
    private policies: Record<WordbookProviderType, WordbookRateLimitPolicy>
    private now: () => number
    private sleep: (ms: number) => Promise<void>
    private storage?: RateLimitStorageLike

    constructor(options?: {
        policies?: Partial<Record<WordbookProviderType, WordbookRateLimitPolicy>>
        now?: () => number
        sleep?: (ms: number) => Promise<void>
        storage?: RateLimitStorageLike | null
    }) {
        this.policies = {
            eudic: options?.policies?.eudic ?? defaultWordbookRateLimits.eudic,
            maimemo: options?.policies?.maimemo ?? defaultWordbookRateLimits.maimemo,
        }
        this.now = options?.now ?? (() => Date.now())
        this.sleep = options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
        this.storage =
            options?.storage === null
                ? undefined
                : (options?.storage ??
                  (typeof browser !== 'undefined' && browser.storage?.local
                      ? browser.storage.local
                      : undefined))
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return
        this.loaded = true
        if (!this.storage) return
        try {
            const raw = await this.storage.get(rateLimitStorageKey)
            const parsed = persistedRateStateSchema.safeParse(raw[rateLimitStorageKey])
            if (parsed.success) {
                for (const [profileId, state] of Object.entries(parsed.data)) {
                    this.states.set(profileId, {
                        timestamps: [...state.timestamps].sort((a, b) => a - b),
                        blockedUntil: state.blockedUntil,
                    })
                }
            }
        } catch {
            // Fall back to in-memory state if storage is unavailable.
        }
    }

    private async persist(): Promise<void> {
        if (!this.storage) return
        const payload: Record<string, ProfileRateState> = {}
        for (const [profileId, state] of this.states.entries()) {
            if (state.timestamps.length || state.blockedUntil > this.now()) {
                payload[profileId] = {
                    timestamps: state.timestamps.slice(-600),
                    blockedUntil: state.blockedUntil,
                }
            }
        }
        try {
            await this.storage.set({ [rateLimitStorageKey]: payload })
        } catch {
            // Keep in-memory rate tracking active even if storage write fails.
        }
    }

    private stateFor(profileId: string): ProfileRateState {
        let state = this.states.get(profileId)
        if (!state) {
            state = { timestamps: [], blockedUntil: 0 }
            this.states.set(profileId, state)
        }
        return state
    }

    private prune(state: ProfileRateState, policy: WordbookRateLimitPolicy, current: number): void {
        const cutoff = current - policy.longWindowMs
        if (state.timestamps.length && state.timestamps[0]! <= cutoff) {
            state.timestamps = state.timestamps.filter((ts) => ts > cutoff)
        }
        if (state.blockedUntil && state.blockedUntil <= current) {
            state.blockedUntil = 0
        }
    }

    async acquire(profileId: string, type: WordbookProviderType): Promise<void> {
        const previous = this.chains.get(profileId) ?? Promise.resolve()
        const task = previous
            .catch(() => undefined)
            .then(async () => {
                await this.ensureLoaded()
                const policy = this.policies[type]
                const state = this.stateFor(profileId)
                while (true) {
                    const current = this.now()
                    this.prune(state, policy, current)
                    if (state.blockedUntil > current) {
                        throw new WordbookRateLimitError(
                            t('wordbook.rateLimited', {
                                minutes: formatWaitMinutes(state.blockedUntil - current),
                            }),
                        )
                    }
                    let waitMs = 0
                    if (state.timestamps.length >= policy.longLimit) {
                        const oldestLong = state.timestamps[state.timestamps.length - policy.longLimit]!
                        const longWait = oldestLong + policy.longWindowMs - current + 100
                        if (longWait > policy.maxWaitMs) {
                            throw new WordbookRateLimitError(
                                t('wordbook.quotaExceeded', { minutes: formatWaitMinutes(longWait) }),
                            )
                        }
                        waitMs = Math.max(waitMs, longWait)
                    }
                    const shortCutoff = current - policy.shortWindowMs
                    const recent = state.timestamps.filter((ts) => ts > shortCutoff)
                    if (recent.length >= policy.shortLimit) {
                        const oldestShort = recent[recent.length - policy.shortLimit]!
                        const shortWait = oldestShort + policy.shortWindowMs - current + 100
                        waitMs = Math.max(waitMs, shortWait)
                    }
                    const last = state.timestamps.at(-1)
                    if (last !== undefined && current - last < policy.minIntervalMs) {
                        waitMs = Math.max(waitMs, policy.minIntervalMs - (current - last))
                    }
                    if (waitMs <= 0) {
                        state.timestamps.push(current)
                        await this.persist()
                        return
                    }
                    await this.sleep(waitMs)
                }
            })
        this.chains.set(profileId, task)
        try {
            await task
        } finally {
            if (this.chains.get(profileId) === task) this.chains.delete(profileId)
        }
    }

    async markRateLimited(profileId: string, type: WordbookProviderType): Promise<number> {
        await this.ensureLoaded()
        const policy = this.policies[type]
        const state = this.stateFor(profileId)
        const current = this.now()
        state.blockedUntil = Math.max(state.blockedUntil, current + policy.cooldown429Ms)
        await this.persist()
        return formatWaitMinutes(state.blockedUntil - current)
    }
}

export const defaultWordbookRateLimiter = new WordbookRateLimiter()

export interface WordbookAdapter {
    readonly type: WordbookProviderType
    readonly origin: string
    listCategories(
        token: string,
        language: CollectionLanguage,
        fetcher?: typeof fetch,
    ): Promise<WordbookCategory[]>
    appendWords(
        token: string,
        categoryId: string,
        language: CollectionLanguage,
        words: readonly string[],
        fetcher?: typeof fetch,
    ): Promise<number>
    removeWords(
        token: string,
        categoryId: string,
        language: CollectionLanguage,
        words: readonly string[],
        fetcher?: typeof fetch,
    ): Promise<number>
}

export function wordbookOrigin(type: WordbookProviderType): string {
    return type === 'maimemo' ? maimemoOrigin : eudicOrigin
}

function normalizeWords(words: readonly string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const raw of words) {
        const trimmed = raw.trim()
        const lowered = trimmed.toLowerCase()
        if (!trimmed || seen.has(lowered)) continue
        seen.add(lowered)
        result.push(trimmed)
    }
    return result
}

function checkResponse(response: Response): void {
    if (response.status === 401 || response.status === 403) {
        throw new Error(t('wordbook.unauthorized'))
    }
    if (response.status === 429) {
        throw new WordbookRateLimitError(t('wordbook.rateLimited', { minutes: 60 }))
    }
    if (!response.ok) {
        throw new Error(t('wordbook.httpError', { status: response.status }))
    }
}

const eudicCategoriesSchema = z.object({
    data: z
        .array(
            z.object({
                id: z.union([z.string(), z.number()]).transform(String),
                name: z.string(),
            }),
        )
        .default([]),
})

const eudicAdapter: WordbookAdapter = {
    type: 'eudic',
    origin: eudicOrigin,
    async listCategories(token, language, fetcher = fetch) {
        const url = `${eudicOrigin}/api/open/v1/studylist/category?language=${encodeURIComponent(language)}`
        const response = await fetcher(url, {
            headers: { Authorization: token.trim() },
            signal: AbortSignal.timeout(requestTimeoutMs),
        })
        checkResponse(response)
        const parsed = eudicCategoriesSchema.parse(await response.json())
        return parsed.data.map(({ id, name }) => ({ id, name }))
    },
    async appendWords(token, categoryId, language, rawWords, fetcher = fetch) {
        const words = normalizeWords(rawWords)
        if (!words.length) return 0
        for (let offset = 0; offset < words.length; offset += eudicBatchSize) {
            const chunk = words.slice(offset, offset + eudicBatchSize)
            const response = await fetcher(`${eudicOrigin}/api/open/v1/studylist/words`, {
                method: 'POST',
                headers: {
                    Authorization: token.trim(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id: categoryId,
                    language,
                    words: chunk,
                }),
                signal: AbortSignal.timeout(requestTimeoutMs),
            })
            checkResponse(response)
        }
        return words.length
    },
    async removeWords(token, categoryId, language, rawWords, fetcher = fetch) {
        const words = normalizeWords(rawWords)
        if (!words.length) return 0
        for (let offset = 0; offset < words.length; offset += eudicBatchSize) {
            const chunk = words.slice(offset, offset + eudicBatchSize)
            const response = await fetcher(`${eudicOrigin}/api/open/v1/studylist/words`, {
                method: 'DELETE',
                headers: {
                    Authorization: token.trim(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    category_id: categoryId,
                    language,
                    words: chunk,
                }),
                signal: AbortSignal.timeout(requestTimeoutMs),
            })
            checkResponse(response)
        }
        return words.length
    },
}

function maimemoAuthHeader(token: string): string {
    const trimmed = token.trim()
    return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
}

const maimemoNotepadSchema = z.object({
    id: z.string().min(1),
    title: z.string().default(''),
    brief: z.string().default(''),
    content: z.string().default(''),
    status: z.string().default('UNPUBLISHED'),
    tags: z.array(z.string()).default([]),
})

const maimemoListResponseSchema = z.union([
    z.object({ data: z.object({ notepads: z.array(maimemoNotepadSchema).default([]) }) }),
    z.object({ notepads: z.array(maimemoNotepadSchema).default([]) }),
])

const maimemoDetailResponseSchema = z.union([
    z.object({ data: z.object({ notepad: maimemoNotepadSchema }) }),
    z.object({ notepad: maimemoNotepadSchema }),
])

async function fetchMaimemoNotepad(token: string, notepadId: string, fetcher: typeof fetch) {
    const response = await fetcher(`${maimemoOrigin}/open/api/v1/notepads/${encodeURIComponent(notepadId)}`, {
        headers: {
            Authorization: maimemoAuthHeader(token),
            Accept: 'application/json',
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
    })
    checkResponse(response)
    const parsed = maimemoDetailResponseSchema.parse(await response.json())
    return 'data' in parsed ? parsed.data.notepad : parsed.notepad
}

async function saveMaimemoNotepad(
    token: string,
    notepad: z.infer<typeof maimemoNotepadSchema>,
    content: string,
    fetcher: typeof fetch,
) {
    const response = await fetcher(
        `${maimemoOrigin}/open/api/v1/notepads/${encodeURIComponent(notepad.id)}`,
        {
            method: 'POST',
            headers: {
                Authorization: maimemoAuthHeader(token),
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                notepad: {
                    status: notepad.status || 'UNPUBLISHED',
                    title: notepad.title,
                    brief: notepad.brief,
                    tags: notepad.tags,
                    content,
                },
            }),
            signal: AbortSignal.timeout(requestTimeoutMs),
        },
    )
    checkResponse(response)
}

const maimemoAdapter: WordbookAdapter = {
    type: 'maimemo',
    origin: maimemoOrigin,
    async listCategories(token, _language, fetcher = fetch) {
        const response = await fetcher(`${maimemoOrigin}/open/api/v1/notepads?limit=50&offset=0`, {
            headers: {
                Authorization: maimemoAuthHeader(token),
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(requestTimeoutMs),
        })
        checkResponse(response)
        const parsed = maimemoListResponseSchema.parse(await response.json())
        const notepads = 'data' in parsed ? parsed.data.notepads : parsed.notepads
        return notepads.map(({ id, title }) => ({ id, name: title || id }))
    },
    async appendWords(token, categoryId, _language, rawWords, fetcher = fetch) {
        const words = normalizeWords(rawWords)
        if (!words.length) return 0
        const notepad = await fetchMaimemoNotepad(token, categoryId, fetcher)
        const existingLines = notepad.content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        const existingSet = new Set(existingLines.map((line) => line.toLowerCase()))
        const additions = words.filter((word) => !existingSet.has(word.toLowerCase()))
        if (!additions.length) return 0
        const nextContent = [...existingLines, ...additions].join('\n')
        await saveMaimemoNotepad(token, notepad, nextContent, fetcher)
        return additions.length
    },
    async removeWords(token, categoryId, _language, rawWords, fetcher = fetch) {
        const targets = new Set(normalizeWords(rawWords).map((word) => word.toLowerCase()))
        if (!targets.size) return 0
        const notepad = await fetchMaimemoNotepad(token, categoryId, fetcher)
        const existingLines = notepad.content.split(/\r?\n/)
        let removed = 0
        const keptLines = existingLines.filter((line) => {
            const trimmed = line.trim().toLowerCase()
            if (trimmed && targets.has(trimmed)) {
                removed++
                return false
            }
            return true
        })
        if (!removed) return 0
        await saveMaimemoNotepad(token, notepad, keptLines.join('\n'), fetcher)
        return removed
    },
}

export function getWordbookAdapter(type: WordbookProviderType): WordbookAdapter {
    return type === 'maimemo' ? maimemoAdapter : eudicAdapter
}

type WordbookProfileRef = Pick<WordbookProfile, 'type' | 'token'> & { id?: string }

function wrapRateLimitedFetcher(
    profile: WordbookProfileRef,
    fetcher: typeof fetch,
    rateLimiter?: WordbookRateLimiter,
): typeof fetch {
    const limiter = rateLimiter ?? (profile.id ? defaultWordbookRateLimiter : undefined)
    if (!limiter || !profile.id) return fetcher
    const profileId = profile.id
    return async (input, init) => {
        await limiter.acquire(profileId, profile.type)
        const response = await fetcher(input, init)
        if (response.status === 429) {
            const minutes = await limiter.markRateLimited(profileId, profile.type)
            throw new WordbookRateLimitError(t('wordbook.rateLimited', { minutes }))
        }
        return response
    }
}

export async function listWordbookCategories(
    profile: WordbookProfileRef,
    language: CollectionLanguage,
    fetcher: typeof fetch = fetch,
    rateLimiter?: WordbookRateLimiter,
): Promise<WordbookCategory[]> {
    return getWordbookAdapter(profile.type).listCategories(
        profile.token,
        language,
        wrapRateLimitedFetcher(profile, fetcher, rateLimiter),
    )
}

export async function appendWordsToWordbook(
    profile: WordbookProfileRef,
    categoryId: string,
    language: CollectionLanguage,
    words: readonly string[],
    fetcher: typeof fetch = fetch,
    rateLimiter?: WordbookRateLimiter,
): Promise<number> {
    return getWordbookAdapter(profile.type).appendWords(
        profile.token,
        categoryId,
        language,
        words,
        wrapRateLimitedFetcher(profile, fetcher, rateLimiter),
    )
}

export async function removeWordsFromWordbook(
    profile: WordbookProfileRef,
    categoryId: string,
    language: CollectionLanguage,
    words: readonly string[],
    fetcher: typeof fetch = fetch,
    rateLimiter?: WordbookRateLimiter,
): Promise<number> {
    return getWordbookAdapter(profile.type).removeWords(
        profile.token,
        categoryId,
        language,
        words,
        wrapRateLimitedFetcher(profile, fetcher, rateLimiter),
    )
}

interface PendingAutoSyncBucket {
    profile: WordbookProfile
    categoryId: string
    language: CollectionLanguage
    toAdd: Map<string, string>
    toRemove: Map<string, string>
    timer?: ReturnType<typeof setTimeout>
}

export class WordbookAutoSyncQueue {
    private buckets = new Map<string, PendingAutoSyncBucket>()
    private flushing = new Map<string, Promise<void>>()
    private debounceMs: number
    private fetcher: typeof fetch
    private rateLimiter?: WordbookRateLimiter

    constructor(options?: {
        debounceMs?: number
        fetcher?: typeof fetch
        rateLimiter?: WordbookRateLimiter
    }) {
        this.debounceMs = options?.debounceMs ?? 10_000
        this.fetcher = options?.fetcher ?? fetch
        this.rateLimiter = options?.rateLimiter
    }

    enqueue(input: {
        profile: WordbookProfile
        categoryId: string
        language: CollectionLanguage
        word: string
        action: 'add' | 'remove'
    }): void {
        const trimmed = input.word.trim()
        const key = trimmed.toLowerCase()
        if (!key) return
        const bucketKey = `${input.profile.id}:${input.categoryId}:${input.language}`
        let bucket = this.buckets.get(bucketKey)
        if (!bucket) {
            bucket = {
                profile: input.profile,
                categoryId: input.categoryId,
                language: input.language,
                toAdd: new Map(),
                toRemove: new Map(),
            }
            this.buckets.set(bucketKey, bucket)
        } else {
            bucket.profile = input.profile
        }
        if (input.action === 'add') {
            if (!bucket.toRemove.delete(key)) {
                bucket.toAdd.set(key, trimmed)
            }
        } else if (!bucket.toAdd.delete(key)) {
            bucket.toRemove.set(key, trimmed)
        }
        if (bucket.timer) clearTimeout(bucket.timer)
        bucket.timer = setTimeout(() => {
            bucket.timer = undefined
            void this.flushBucket(bucketKey)
        }, this.debounceMs)
    }

    async flushAll(): Promise<void> {
        const keys = [...this.buckets.keys()]
        for (const key of keys) {
            const bucket = this.buckets.get(key)
            if (bucket?.timer) {
                clearTimeout(bucket.timer)
                bucket.timer = undefined
            }
        }
        await Promise.all(keys.map((key) => this.flushBucket(key)))
    }

    private flushBucket(bucketKey: string): Promise<void> {
        const bucket = this.buckets.get(bucketKey)
        if (!bucket) return this.flushing.get(bucketKey) ?? Promise.resolve()
        const additions = [...bucket.toAdd.values()]
        const removals = [...bucket.toRemove.values()]
        const { profile, categoryId, language } = bucket
        bucket.toAdd.clear()
        bucket.toRemove.clear()
        if (!bucket.timer) this.buckets.delete(bucketKey)
        if (!additions.length && !removals.length) return this.flushing.get(bucketKey) ?? Promise.resolve()

        const previous = this.flushing.get(bucketKey) ?? Promise.resolve()
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                if (additions.length) {
                    await appendWordsToWordbook(
                        profile,
                        categoryId,
                        language,
                        additions,
                        this.fetcher,
                        this.rateLimiter,
                    ).catch(() => undefined)
                }
                if (removals.length) {
                    await removeWordsFromWordbook(
                        profile,
                        categoryId,
                        language,
                        removals,
                        this.fetcher,
                        this.rateLimiter,
                    ).catch(() => undefined)
                }
            })
        this.flushing.set(bucketKey, next)
        void next.finally(() => {
            if (this.flushing.get(bucketKey) === next) this.flushing.delete(bucketKey)
        })
        return next
    }
}

const defaultAutoSyncQueue = new WordbookAutoSyncQueue()

export function enqueueWordbookAutoSync(input: {
    profile: WordbookProfile
    categoryId: string
    language: CollectionLanguage
    word: string
    action: 'add' | 'remove'
}): void {
    defaultAutoSyncQueue.enqueue(input)
}
