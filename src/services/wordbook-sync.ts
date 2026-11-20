import { t } from '../i18n'
import { z } from 'zod'
import type {
    CollectionLanguage,
    WordbookCategory,
    WordbookProfile,
    WordbookProviderType,
} from '../domain/models'

const requestTimeoutMs = 20_000
const batchSize = 50
const eudicOrigin = 'https://api.frdic.com'
const maimemoOrigin = 'https://open.maimemo.com'

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
        for (let offset = 0; offset < words.length; offset += batchSize) {
            const chunk = words.slice(offset, offset + batchSize)
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
        for (let offset = 0; offset < words.length; offset += batchSize) {
            const chunk = words.slice(offset, offset + batchSize)
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

export async function listWordbookCategories(
    profile: Pick<WordbookProfile, 'type' | 'token'>,
    language: CollectionLanguage,
    fetcher: typeof fetch = fetch,
): Promise<WordbookCategory[]> {
    return getWordbookAdapter(profile.type).listCategories(profile.token, language, fetcher)
}

export async function appendWordsToWordbook(
    profile: Pick<WordbookProfile, 'type' | 'token'>,
    categoryId: string,
    language: CollectionLanguage,
    words: readonly string[],
    fetcher: typeof fetch = fetch,
): Promise<number> {
    return getWordbookAdapter(profile.type).appendWords(profile.token, categoryId, language, words, fetcher)
}

export async function removeWordsFromWordbook(
    profile: Pick<WordbookProfile, 'type' | 'token'>,
    categoryId: string,
    language: CollectionLanguage,
    words: readonly string[],
    fetcher: typeof fetch = fetch,
): Promise<number> {
    return getWordbookAdapter(profile.type).removeWords(profile.token, categoryId, language, words, fetcher)
}

const profileQueues = new Map<string, Promise<void>>()

export function enqueueWordbookTask(profileId: string, task: () => Promise<void>, spacingMs = 350): void {
    const previous = profileQueues.get(profileId) ?? Promise.resolve()
    const next = previous
        .catch(() => undefined)
        .then(async () => {
            await task().catch(() => undefined)
            if (spacingMs > 0) await new Promise((resolve) => setTimeout(resolve, spacingMs))
        })
    profileQueues.set(profileId, next)
    void next.finally(() => {
        if (profileQueues.get(profileId) === next) profileQueues.delete(profileId)
    })
}
