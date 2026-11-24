import { t } from '../i18n'
import { browser } from 'wxt/browser'
import { z } from 'zod'
import {
    defaultTranslationSettings,
    definitionModeSchema,
    googleSyncConfigSchema,
    readingPanelPositionSchema,
    selectionTriggerSchema,
    sourceLanguageSchema,
    translationLanguagesSchema,
    translationProviderInputSchema,
    translationProvidersStateSchema,
    translationSettingsSchema,
    wordbookProfileInputSchema,
    wordbookProfileSchema,
    type GoogleSyncConfig,
    type ReadingPanelPosition,
    type SelectionTrigger,
    type SourceLanguage,
    type TranslationLanguages,
    type TranslationProvider,
    type TranslationProvidersState,
    type TranslationSettings,
    type WordbookProfile,
    type WordbookProfileSummary,
} from '../domain/models'

function inferProviderName(baseUrl: string): string {
    const trimmed = baseUrl.trim()
    if (!trimmed) return 'Default'
    try {
        const { hostname } = new URL(trimmed)
        const lower = hostname.toLowerCase()
        if (lower.includes('deepseek')) return 'DeepSeek'
        if (lower.includes('openai')) return 'OpenAI'
        if (lower.includes('anthropic')) return 'Anthropic'
        if (lower.includes('openrouter')) return 'OpenRouter'
        if (['localhost', '127.0.0.1', '[::1]'].includes(lower)) return 'Local LLM'
        return hostname
    } catch {
        return 'Default'
    }
}

export function providerToTranslationSettings(
    provider: TranslationProvider | undefined,
    targetLanguage: string,
): TranslationSettings {
    return translationSettingsSchema.parse({
        baseUrl: provider?.baseUrl ?? '',
        apiKey: provider?.apiKey ?? '',
        model: provider?.model ?? '',
        targetLanguage,
        timeoutMs: provider?.timeoutMs ?? defaultTranslationSettings.timeoutMs,
    })
}

function normalizeProvidersState(raw: TranslationProvidersState): TranslationProvidersState {
    const activeId = raw.providers.some((provider) => provider.id === raw.activeId)
        ? raw.activeId
        : (raw.providers[0]?.id ?? '')
    return { ...raw, activeId }
}

async function persistProvidersState(state: TranslationProvidersState): Promise<TranslationProvidersState> {
    const normalized = normalizeProvidersState(translationProvidersStateSchema.parse(state))
    const active = normalized.providers.find((provider) => provider.id === normalized.activeId)
    await browser.storage.local.set({
        translationProviders: normalized,
        translation: providerToTranslationSettings(active, normalized.targetLanguage),
    })
    return normalized
}

export async function loadTranslationProviders(): Promise<TranslationProvidersState> {
    const stored = await browser.storage.local.get(['translationProviders', 'translation'])
    const parsedLegacy = translationSettingsSchema.parse({
        ...defaultTranslationSettings,
        ...translationSettingsSchema.partial().parse(stored.translation ?? {}),
    })
    if (stored.translationProviders !== undefined) {
        const parsed = translationProvidersStateSchema.safeParse(stored.translationProviders)
        if (parsed.success) {
            return normalizeProvidersState({
                ...parsed.data,
                targetLanguage: parsed.data.targetLanguage || parsedLegacy.targetLanguage,
            })
        }
    }
    if (parsedLegacy.baseUrl.trim() || parsedLegacy.model.trim()) {
        return {
            activeId: 'default',
            providers: [
                {
                    id: 'default',
                    name: inferProviderName(parsedLegacy.baseUrl),
                    baseUrl: parsedLegacy.baseUrl,
                    apiKey: parsedLegacy.apiKey,
                    model: parsedLegacy.model,
                    timeoutMs: parsedLegacy.timeoutMs,
                },
            ],
            targetLanguage: parsedLegacy.targetLanguage,
        }
    }
    return {
        activeId: '',
        providers: [],
        targetLanguage: parsedLegacy.targetLanguage,
    }
}

export async function saveTranslationProvider(
    rawInput: unknown,
): Promise<{ state: TranslationProvidersState; provider: TranslationProvider }> {
    const input = translationProviderInputSchema.parse(rawInput)
    const current = await loadTranslationProviders()
    const id = input.id ?? crypto.randomUUID()
    const provider: TranslationProvider = {
        id,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        timeoutMs: input.timeoutMs,
    }
    const index = current.providers.findIndex((item) => item.id === id)
    const providers =
        index >= 0
            ? current.providers.map((item, i) => (i === index ? provider : item))
            : [...current.providers, provider]
    const shouldActivate = input.activate === true || !current.activeId || providers.length === 1
    const state = await persistProvidersState({
        ...current,
        providers,
        activeId: shouldActivate ? provider.id : current.activeId,
    })
    return { state, provider }
}

export async function deleteTranslationProvider(id: string): Promise<TranslationProvidersState> {
    const current = await loadTranslationProviders()
    if (!current.providers.some((provider) => provider.id === id)) {
        throw new Error(t('settings.providerNotFound'))
    }
    const providers = current.providers.filter((provider) => provider.id !== id)
    const activeId = current.activeId === id ? (providers[0]?.id ?? '') : current.activeId
    return persistProvidersState({ ...current, providers, activeId })
}

export async function setActiveTranslationProvider(id: string): Promise<TranslationProvidersState> {
    const current = await loadTranslationProviders()
    if (!current.providers.some((provider) => provider.id === id)) {
        throw new Error(t('settings.providerNotFound'))
    }
    return persistProvidersState({ ...current, activeId: id })
}

export async function saveTargetLanguage(targetLanguage: string): Promise<TranslationProvidersState> {
    const valid = z.string().trim().min(1).max(100).parse(targetLanguage)
    const current = await loadTranslationProviders()
    return persistProvidersState({ ...current, targetLanguage: valid })
}

export async function loadSettings(): Promise<TranslationSettings> {
    const state = await loadTranslationProviders()
    const active = state.providers.find((provider) => provider.id === state.activeId)
    return providerToTranslationSettings(active, state.targetLanguage)
}

export async function saveSettings(input: unknown): Promise<void> {
    const parsed = translationSettingsSchema.parse(input)
    const current = await loadTranslationProviders()
    const existing = current.providers.find((provider) => provider.id === current.activeId)
    const id = existing?.id ?? 'default'
    const provider: TranslationProvider = {
        id,
        name: existing?.name ?? inferProviderName(parsed.baseUrl),
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey,
        model: parsed.model,
        timeoutMs: parsed.timeoutMs,
    }
    const providers = existing
        ? current.providers.map((item) => (item.id === id ? provider : item))
        : [...current.providers, provider]
    await persistProvidersState({
        activeId: id,
        providers,
        targetLanguage: parsed.targetLanguage,
    })
}

export async function loadDefinitionMode() {
    const stored = await browser.storage.local.get('definitionMode')
    return definitionModeSchema.safeParse(stored.definitionMode).data ?? 'simple'
}

export async function saveDefinitionMode(input: unknown): Promise<void> {
    await browser.storage.local.set({ definitionMode: definitionModeSchema.parse(input) })
}

export async function loadSiteReading(site: string) {
    const analysisKey = `analysis:${site}`
    const stored = await browser.storage.local.get(analysisKey)
    return { analysis: stored[analysisKey] !== false }
}

export async function saveSiteReading(site: string, enabled: boolean) {
    const key = `analysis:${site}`
    if (enabled) await browser.storage.local.remove(key)
    else await browser.storage.local.set({ [key]: false })
}

export async function loadSpotlight() {
    const stored = await browser.storage.local.get('spotlightEnabled')
    return stored.spotlightEnabled !== false
}

export async function saveSpotlight(enabled: boolean) {
    await browser.storage.local.set({ spotlightEnabled: enabled })
}

export async function loadRecall() {
    const stored = await browser.storage.local.get('recallCandidateMeanings')
    return stored.recallCandidateMeanings === true
}

export async function saveRecall(enabled: boolean) {
    await browser.storage.local.set({ recallCandidateMeanings: enabled })
}

export async function loadSelectionTrigger(): Promise<SelectionTrigger> {
    const stored = await browser.storage.local.get('selectionTrigger')
    const parsed = selectionTriggerSchema.safeParse(stored.selectionTrigger)
    return parsed.success ? parsed.data : 'auto'
}

export async function saveSelectionTrigger(trigger: SelectionTrigger): Promise<SelectionTrigger> {
    const valid = selectionTriggerSchema.parse(trigger)
    await browser.storage.local.set({ selectionTrigger: valid })
    return valid
}

export async function loadActiveCollectionId(): Promise<string | undefined> {
    const stored = await browser.storage.local.get('activeCollectionId')
    return typeof stored.activeCollectionId === 'string' && stored.activeCollectionId.trim()
        ? stored.activeCollectionId.trim()
        : undefined
}

export async function saveActiveCollectionId(collectionId: string): Promise<string> {
    const valid = collectionId.trim()
    await browser.storage.local.set({ activeCollectionId: valid })
    return valid
}

export async function loadSourceLanguage(): Promise<SourceLanguage> {
    const stored = await browser.storage.local.get('sourceLanguage')
    const parsed = sourceLanguageSchema.safeParse(stored.sourceLanguage)
    return parsed.success ? parsed.data : 'auto'
}

export async function saveSourceLanguage(language: SourceLanguage): Promise<SourceLanguage> {
    const valid = sourceLanguageSchema.parse(language)
    await browser.storage.local.set({ sourceLanguage: valid })
    return valid
}

export async function loadTranslationLanguages(): Promise<TranslationLanguages> {
    const [sourceLanguage, state] = await Promise.all([loadSourceLanguage(), loadTranslationProviders()])
    return {
        sourceLanguage,
        targetLanguage: state.targetLanguage,
    }
}

export async function saveTranslationLanguages(input: unknown): Promise<TranslationLanguages> {
    const next = translationLanguagesSchema.parse(input)
    const current = await loadTranslationProviders()
    const writes: Promise<unknown>[] = [browser.storage.local.set({ sourceLanguage: next.sourceLanguage })]
    if (current.targetLanguage !== next.targetLanguage) {
        writes.push(saveTargetLanguage(next.targetLanguage))
    }
    await Promise.all(writes)
    return next
}

export interface StorageAreaLike {
    get(keys: string): Promise<Record<string, unknown>>
    set(items: Record<string, unknown>): Promise<void>
    remove(keys: string): Promise<void>
}

const googleSyncClientIdKey = 'googleSyncClientId'

export async function readGoogleSyncConfig(
    localStorage: StorageAreaLike,
    syncStorage?: StorageAreaLike,
): Promise<GoogleSyncConfig> {
    const localStored = await localStorage.get('googleSync')
    const localConfig = googleSyncConfigSchema.parse(localStored.googleSync ?? {})
    if (!syncStorage) return localConfig
    try {
        const syncStored = await syncStorage.get(googleSyncClientIdKey)
        const parsedSyncId = z.string().trim().max(300).safeParse(syncStored[googleSyncClientIdKey])
        const syncClientId = parsedSyncId.success ? parsedSyncId.data : ''
        if (syncClientId && syncClientId !== localConfig.clientId) {
            const adopted = googleSyncConfigSchema.parse({
                ...localConfig,
                clientId: syncClientId,
                accessToken: '',
                tokenExpiresAt: 0,
                accountEmail: '',
            })
            await localStorage.set({ googleSync: adopted })
            return adopted
        }
        if (!syncClientId && localConfig.clientId) {
            await syncStorage.set({ [googleSyncClientIdKey]: localConfig.clientId })
        }
    } catch {
        // Browser profile sync can be disabled or offline; fall back to local storage.
    }
    return localConfig
}

export async function writeGoogleSyncConfig(
    localStorage: StorageAreaLike,
    syncStorage: StorageAreaLike | undefined,
    patch: Partial<GoogleSyncConfig>,
): Promise<GoogleSyncConfig> {
    const current = await readGoogleSyncConfig(localStorage, syncStorage)
    const next = googleSyncConfigSchema.parse({ ...current, ...patch })
    await localStorage.set({ googleSync: next })
    if (patch.clientId !== undefined && syncStorage) {
        try {
            if (next.clientId) await syncStorage.set({ [googleSyncClientIdKey]: next.clientId })
            else await syncStorage.remove(googleSyncClientIdKey)
        } catch {
            // Keep local save resilient even when chrome.storage.sync is unavailable.
        }
    }
    return next
}

export async function loadGoogleSyncConfig(): Promise<GoogleSyncConfig> {
    return readGoogleSyncConfig(browser.storage.local, browser.storage.sync)
}

export async function saveGoogleSyncConfig(patch: Partial<GoogleSyncConfig>): Promise<GoogleSyncConfig> {
    return writeGoogleSyncConfig(browser.storage.local, browser.storage.sync, patch)
}

export async function clearGoogleSyncAuth(): Promise<GoogleSyncConfig> {
    return saveGoogleSyncConfig({
        accessToken: '',
        tokenExpiresAt: 0,
        accountEmail: '',
    })
}

export async function loadWordbookProfiles(): Promise<WordbookProfile[]> {
    const stored = await browser.storage.local.get('wordbookProfiles')
    const parsed = z.array(wordbookProfileSchema).max(50).safeParse(stored.wordbookProfiles)
    return parsed.success ? parsed.data : []
}

export async function listWordbookProfileSummaries(): Promise<WordbookProfileSummary[]> {
    const profiles = await loadWordbookProfiles()
    return profiles.map(({ id, name, type }) => ({ id, name, type }))
}

export async function saveWordbookProfile(
    rawInput: unknown,
): Promise<{ profiles: WordbookProfile[]; profile: WordbookProfile }> {
    const input = wordbookProfileInputSchema.parse(rawInput)
    const current = await loadWordbookProfiles()
    const now = Date.now()
    const existing = input.id ? current.find((item) => item.id === input.id) : undefined
    const profile: WordbookProfile = wordbookProfileSchema.parse({
        id: existing?.id ?? input.id ?? crypto.randomUUID(),
        name: input.name,
        type: input.type,
        token: input.token,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    })
    const profiles = existing
        ? current.map((item) => (item.id === profile.id ? profile : item))
        : [...current, profile]
    await browser.storage.local.set({ wordbookProfiles: profiles })
    return { profiles, profile }
}

export async function deleteWordbookProfile(id: string): Promise<WordbookProfile[]> {
    const current = await loadWordbookProfiles()
    if (!current.some((item) => item.id === id)) throw new Error(t('wordbook.profileNotFound'))
    const profiles = current.filter((item) => item.id !== id)
    await browser.storage.local.set({ wordbookProfiles: profiles })
    return profiles
}

const maxSavedPanelPositions = 200
const readingPanelPositionsSchema = z.record(z.string(), readingPanelPositionSchema)

export async function loadReadingPanelPosition(scope: string): Promise<ReadingPanelPosition | null> {
    const stored = await browser.storage.local.get('readingPanelPositions')
    const parsed = readingPanelPositionsSchema.safeParse(stored.readingPanelPositions)
    if (!parsed.success) return null
    return parsed.data[scope] ?? null
}

export async function saveReadingPanelPosition(
    scope: string,
    input: unknown,
): Promise<ReadingPanelPosition> {
    const position = readingPanelPositionSchema.parse(input)
    const stored = await browser.storage.local.get('readingPanelPositions')
    const parsed = readingPanelPositionsSchema.safeParse(stored.readingPanelPositions)
    const existing = parsed.success ? { ...parsed.data } : {}
    delete existing[scope]
    const entries = Object.entries(existing)
    while (entries.length >= maxSavedPanelPositions) entries.shift()
    entries.push([scope, position])
    await browser.storage.local.set({ readingPanelPositions: Object.fromEntries(entries) })
    return position
}
