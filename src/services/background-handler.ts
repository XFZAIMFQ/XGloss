import { t } from '../i18n'
import { browser } from 'wxt/browser'
import { z } from 'zod'
import { database } from '../data/database'
import {
    deleteCollection,
    deleteWord,
    deleteWords,
    exportVocabulary,
    importVocabulary,
    listCollections,
    loadEncounterMeaning,
    saveCollection,
    saveWord,
    toggleCollectionPin,
    updateWord,
} from '../data/vocabulary-repository'
import {
    clearGoogleSyncAuth,
    deleteTranslationProvider,
    deleteWordbookProfile,
    listWordbookProfileSummaries,
    loadActiveCollectionId,
    loadDefinitionMode,
    loadGoogleSyncConfig,
    loadReadingPanelPosition,
    loadRecall,
    loadSelectionTrigger,
    loadSettings,
    loadSiteReading,
    loadSourceLanguage,
    loadSpotlight,
    loadTranslationLanguages,
    loadTranslationProviders,
    loadWordbookProfiles,
    providerToTranslationSettings,
    saveActiveCollectionId,
    saveDefinitionMode,
    saveGoogleSyncConfig,
    saveReadingPanelPosition,
    saveRecall,
    saveSelectionTrigger,
    saveSettings,
    saveSiteReading,
    saveSourceLanguage,
    saveSpotlight,
    saveTargetLanguage,
    saveTranslationLanguages,
    saveTranslationProvider,
    saveWordbookProfile,
    setActiveTranslationProvider,
} from '../data/settings'
import { webHostname } from '../platform/web-site'
import { summarizeActivity } from '../domain/activity'
import { activeCollectionId, wordCollectionId } from '../domain/collections'
import { normalizeWord } from '../domain/vocabulary'
import {
    collectionIdSchema,
    collectionLanguageSchema,
    collectionWordbookSchema,
    deleteCollectionInputSchema,
    errorMessage,
    pdfBookmarkSchema,
    savedMeaningSchema,
    selectionTriggerSchema,
    sourceSchema,
    translationInputSchema,
    translationLanguagesSchema,
    type GoogleSyncConfig,
    type GoogleSyncState,
    type TranslationResult,
    type TranslationSettings,
    type WordState,
    wordRatingSchema,
} from '../domain/models'
import { completionEndpoint, requestTranslation, translationCacheKey } from './openai-translation'
import {
    authorizeGoogleDrive,
    googleApiOrigin,
    GoogleAuthExpiredError,
    googleRedirectUri,
    syncBackupWithGoogleDrive,
} from './google-drive-sync'
import {
    appendWordsToWordbook,
    enqueueWordbookTask,
    listWordbookCategories,
    removeWordsFromWordbook,
    wordbookOrigin,
} from './wordbook-sync'

const envelopeSchema = z.object({
    channel: z.literal('xgloss'),
    operation: z.string(),
    requestId: z.string().uuid(),
    input: z.unknown().optional(),
})
const controllers = new Map<string, AbortController>()
const ongoingTranslations = new Map<
    string,
    {
        controller: AbortController
        result: Promise<TranslationResult>
        consumers: number
    }
>()
const optionsOnly = new Set([
    'settings',
    'saveSettings',
    'saveDefinitionMode',
    'translationProviders',
    'saveTranslationProvider',
    'deleteTranslationProvider',
    'setActiveTranslationProvider',
    'saveTargetLanguage',
    'testTranslationProvider',
    'googleSyncState',
    'saveGoogleClientId',
    'connectGoogleSync',
    'disconnectGoogleSync',
    'runGoogleSync',
    'wordbookProfiles',
    'saveWordbookProfile',
    'deleteWordbookProfile',
    'testWordbookProfile',
])
const privileged = new Set([
    ...optionsOnly,
    'export',
    'import',
    'collections',
    'saveCollection',
    'toggleCollectionPin',
    'deleteCollection',
    'updateWord',
    'deleteWord',
    'deleteWords',
    'encounters',
    'wordDetails',
    'activityCounts',
    'activitiesForDay',
    'getProgress',
    'setProgress',
    'bookmarks',
    'setBookmark',
    'setSiteAnalysis',
    'setSelectionTrigger',
    'setTranslationLanguages',
    'activeCollection',
    'setActiveCollection',
    'wordbookProfileSummaries',
    'wordbookCategories',
    'syncCollectionWordbook',
])

function toGoogleSyncState(config: GoogleSyncConfig): GoogleSyncState {
    const connected = Boolean(config.accessToken && config.tokenExpiresAt > Date.now())
    return {
        clientId: config.clientId,
        redirectUri: googleRedirectUri(),
        connected,
        accountEmail: connected ? config.accountEmail : '',
        lastSyncedAt: config.lastSyncedAt,
        lastSyncSummary: config.lastSyncSummary,
    }
}

async function scheduleAutoWordbookSync(
    wordText: string,
    state: WordState,
    collectionId: string,
): Promise<void> {
    if (state === 'ignored') return
    const [collections, profiles] = await Promise.all([listCollections(), loadWordbookProfiles()])
    const collection = collections.find((item) => item.id === collectionId)
    const binding = collection?.wordbook
    if (!collection || !binding?.autoSync) return
    const profile = profiles.find((item) => item.id === binding.profileId)
    if (!profile) return
    const hasPermission = await browser.permissions.contains({
        origins: [`${wordbookOrigin(profile.type)}/*`],
    })
    if (!hasPermission) return
    if (state === 'learning') {
        enqueueWordbookTask(profile.id, async () => {
            await appendWordsToWordbook(profile, binding.categoryId, collection.language, [wordText])
        })
    } else if (state === 'known' && binding.onMastered === 'remove') {
        enqueueWordbookTask(profile.id, async () => {
            await removeWordsFromWordbook(profile, binding.categoryId, collection.language, [wordText])
        })
    }
}

function activityRange(input: unknown, maxDays: number) {
    const date = z.number().int().min(0).max(8.64e15)
    const { from, to } = z.object({ from: date, to: date }).parse(input)
    if (to <= from || to - from > maxDays * 86_400_000) throw new Error(t('background.invalidActivityRange'))
    return IDBKeyRange.bound(from, to, false, true)
}

async function notifyChanged(message: { event: string; site?: string }) {
    const notifyTabs = async () => {
        const tabs = await browser.tabs.query({})
        await Promise.allSettled(
            tabs.flatMap((tab) =>
                tab.id !== undefined && (!message.site || !tab.url || webHostname(tab.url) === message.site)
                    ? [browser.tabs.sendMessage(tab.id, message, { frameId: 0 })]
                    : [],
            ),
        )
    }
    await Promise.allSettled([browser.runtime.sendMessage(message), notifyTabs()])
}

async function resolveWebSite(sender: Browser.runtime.MessageSender, tabId?: number) {
    const url = tabId === undefined ? sender.url : (await browser.tabs.get(tabId)).url
    const site = webHostname(url)
    if (!site || (tabId === undefined && sender.frameId !== 0))
        throw new Error(t('background.unsupportedPage'))
    return site
}

async function resolvePanelScope(sender: Browser.runtime.MessageSender): Promise<string> {
    if (sender.url?.startsWith(browser.runtime.getURL('/'))) return 'extension'
    return resolveWebSite(sender)
}

export async function handleMessage(raw: unknown, sender: Browser.runtime.MessageSender) {
    try {
        const message = envelopeSchema.parse(raw)
        const extensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) ?? false
        if (privileged.has(message.operation) && !extensionPage)
            throw new Error(t('background.extensionOnly'))
        if (optionsOnly.has(message.operation) && sender.url !== browser.runtime.getURL('/options.html')) {
            throw new Error(t('background.optionsOnly'))
        }
        const value = await execute(message, sender)
        return { ok: true, value }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof z.ZodError ? t('background.invalidInput') : errorMessage(error),
        }
    }
}

async function execute(
    message: z.infer<typeof envelopeSchema>,
    sender: Browser.runtime.MessageSender,
): Promise<unknown> {
    switch (message.operation) {
        case 'siteReading': {
            const tabId = z.number().int().nonnegative().optional().parse(message.input)
            if (tabId !== undefined && !sender.url?.startsWith(browser.runtime.getURL('/')))
                throw new Error(t('background.extensionOnly'))
            return loadSiteReading(await resolveWebSite(sender, tabId))
        }
        case 'setSiteAnalysis': {
            const input = z
                .object({ tabId: z.number().int().nonnegative(), site: z.string(), enabled: z.boolean() })
                .parse(message.input)
            const site = await resolveWebSite(sender, input.tabId)
            if (site !== input.site) throw new Error(t('background.siteChanged'))
            await saveSiteReading(site, input.enabled)
            await notifyChanged({ event: 'siteReadingChanged', site })
            return null
        }
        case 'spotlight':
            return loadSpotlight()
        case 'setSpotlight':
            await saveSpotlight(z.boolean().parse(message.input))
            await notifyChanged({ event: 'spotlightChanged' })
            return null
        case 'recallCandidateMeanings':
            return loadRecall()
        case 'setRecallCandidateMeanings':
            await saveRecall(z.boolean().parse(message.input))
            await notifyChanged({ event: 'candidateRecallChanged' })
            return null
        case 'readingPanelPosition':
            return loadReadingPanelPosition(await resolvePanelScope(sender))
        case 'saveReadingPanelPosition':
            return saveReadingPanelPosition(await resolvePanelScope(sender), message.input)
        case 'selectionTrigger':
            return loadSelectionTrigger()
        case 'setSelectionTrigger':
            await saveSelectionTrigger(selectionTriggerSchema.parse(message.input))
            await notifyChanged({ event: 'selectionTriggerChanged' })
            return null
        case 'translationLanguages':
            return loadTranslationLanguages()
        case 'setTranslationLanguages': {
            const updated = await saveTranslationLanguages(translationLanguagesSchema.parse(message.input))
            await notifyChanged({ event: 'translationLanguagesChanged' })
            return updated
        }
        case 'translationAvailable': {
            const settings = await loadSettings()
            return Boolean(settings.baseUrl.trim() && settings.model.trim())
        }
        case 'openTranslationSettings':
            await browser.runtime.openOptionsPage()
            return null
        case 'cancelTranslation':
        case 'translate': {
            const owner = `${sender.tab?.id ?? sender.documentId ?? 'extension'}:${sender.frameId ?? 0}:`
            if (message.operation === 'cancelTranslation') {
                controllers.get(owner + z.string().uuid().parse(message.input))?.abort()
                return null
            }
            return translate(owner + message.requestId, translationInputSchema.parse(message.input))
        }
    }
    const db = await database
    switch (message.operation) {
        case 'words':
            return db.getAll('words')
        case 'collections':
            return listCollections()
        case 'activeCollection': {
            const [storedId, collections] = await Promise.all([loadActiveCollectionId(), listCollections()])
            return storedId && collections.some((item) => item.id === storedId)
                ? storedId
                : activeCollectionId(collections)
        }
        case 'setActiveCollection': {
            const id = collectionIdSchema.parse(message.input)
            const collections = await listCollections()
            const target = collections.find((item) => item.id === id)
            if (!target) throw new Error(t('library.collectionNotFound'))
            await Promise.all([saveActiveCollectionId(target.id), saveSourceLanguage(target.language)])
            const languages = await loadTranslationLanguages()
            await Promise.all([
                notifyChanged({ event: 'activeCollectionChanged' }),
                notifyChanged({ event: 'translationLanguagesChanged' }),
            ])
            return { activeCollectionId: target.id, languages }
        }
        case 'saveCollection': {
            const input = z
                .object({
                    id: collectionIdSchema.optional(),
                    language: collectionLanguageSchema,
                    name: z.string().trim().min(1).max(80),
                    description: z.string().trim().max(300).default(''),
                    pinned: z.boolean().optional(),
                    wordbook: collectionWordbookSchema.nullable().optional(),
                })
                .parse(message.input)
            const saved = await saveCollection(input)
            await notifyChanged({ event: 'vocabularyChanged' })
            return saved
        }
        case 'toggleCollectionPin': {
            const updated = await toggleCollectionPin(collectionIdSchema.parse(message.input))
            await notifyChanged({ event: 'vocabularyChanged' })
            return updated
        }
        case 'deleteCollection': {
            const input = deleteCollectionInputSchema.parse(message.input)
            const storedActiveId = await loadActiveCollectionId()
            const result = await deleteCollection(input)
            const notifications: Promise<unknown>[] = [notifyChanged({ event: 'vocabularyChanged' })]
            if (storedActiveId === input.id) {
                await Promise.all([
                    saveActiveCollectionId(result.fallbackCollectionId),
                    saveSourceLanguage(result.fallbackLanguage),
                ])
                notifications.push(
                    notifyChanged({ event: 'activeCollectionChanged' }),
                    notifyChanged({ event: 'translationLanguagesChanged' }),
                )
            }
            await Promise.all(notifications)
            return {
                deletedWords: result.deletedWords,
                movedWords: result.movedWords,
                fallbackCollectionId: result.fallbackCollectionId,
            }
        }
        case 'saveWord': {
            const input = wordRatingSchema
                .extend({
                    text: z.string().trim().min(1).max(200),
                    source: sourceSchema.optional(),
                    reviewed: z.boolean().optional(),
                    meaning: savedMeaningSchema.optional(),
                    collectionId: collectionIdSchema.optional(),
                })
                .parse(message.input)
            if (input.state !== 'learning' && input.level !== undefined)
                throw new Error(t('rating.invalidLevel'))
            const defaultCollectionId = input.collectionId ? undefined : await loadActiveCollectionId()
            await saveWord(input.text, input.state, input.source, {
                ...input,
                id: message.requestId,
                defaultCollectionId,
            })
            const savedRecord = await db.get('words', normalizeWord(input.text))
            if (savedRecord) {
                void scheduleAutoWordbookSync(
                    savedRecord.text,
                    savedRecord.state,
                    wordCollectionId(savedRecord),
                ).catch(() => undefined)
            }
            await notifyChanged({ event: 'vocabularyChanged' })
            return null
        }
        case 'updateWord': {
            const input = wordRatingSchema
                .extend({
                    originalKey: z.string().min(1).max(200),
                    text: z.string().trim().min(1).max(200),
                    meaning: z.string().trim().max(300).optional(),
                    collectionId: collectionIdSchema.optional(),
                })
                .parse(message.input)
            if (input.state !== 'learning' && input.level !== undefined)
                throw new Error(t('rating.invalidLevel'))
            const updated = await updateWord(input)
            void scheduleAutoWordbookSync(updated.text, updated.state, wordCollectionId(updated)).catch(
                () => undefined,
            )
            await notifyChanged({ event: 'vocabularyChanged' })
            return updated
        }
        case 'deleteWord': {
            await deleteWord(z.string().min(1).max(200).parse(message.input))
            await notifyChanged({ event: 'vocabularyChanged' })
            return null
        }
        case 'deleteWords': {
            const keys = z.array(z.string().min(1).max(200)).max(5000).parse(message.input)
            const deleted = await deleteWords(keys)
            if (deleted > 0) await notifyChanged({ event: 'vocabularyChanged' })
            return deleted
        }
        case 'encounterMeaning': {
            const input = z
                .object({ text: z.string().trim().min(1).max(200), source: sourceSchema })
                .parse(message.input)
            return loadEncounterMeaning(input.text, input.source)
        }
        case 'wordDetails': {
            const keys = z.array(z.string().min(1).max(200)).max(30).parse(message.input)
            const index = db.transaction('encounters').store.index('wordDate')
            return Promise.all(
                keys.map(async (key) => {
                    const range = IDBKeyRange.bound([key, -Infinity], [key, Infinity])
                    const cursor = await index.openCursor(range, 'prev')
                    return { key, encounter: cursor?.value }
                }),
            )
        }
        case 'settings':
            return loadSettings()
        case 'saveSettings':
            await saveSettings(message.input)
            await notifyChanged({ event: 'translationLanguagesChanged' })
            return null
        case 'translationProviders':
            return loadTranslationProviders()
        case 'saveTranslationProvider':
            return saveTranslationProvider(message.input)
        case 'deleteTranslationProvider':
            return deleteTranslationProvider(z.string().trim().min(1).max(100).parse(message.input))
        case 'setActiveTranslationProvider':
            return setActiveTranslationProvider(z.string().trim().min(1).max(100).parse(message.input))
        case 'saveTargetLanguage': {
            const state = await saveTargetLanguage(z.string().trim().min(1).max(100).parse(message.input))
            await notifyChanged({ event: 'translationLanguagesChanged' })
            return state
        }
        case 'testTranslationProvider': {
            const providerId = z.string().trim().min(1).max(100).parse(message.input)
            const state = await loadTranslationProviders()
            const provider = state.providers.find((item) => item.id === providerId)
            if (!provider) throw new Error(t('settings.providerNotFound'))
            const owner = `${sender.tab?.id ?? sender.documentId ?? 'extension'}:${sender.frameId ?? 0}:`
            return translate(
                owner + message.requestId,
                {
                    text: 'register',
                    context: 'Write the value to the hardware register.',
                },
                providerToTranslationSettings(provider, state.targetLanguage),
            )
        }
        case 'googleSyncState':
            return toGoogleSyncState(await loadGoogleSyncConfig())
        case 'saveGoogleClientId': {
            const clientId = z.string().trim().max(300).parse(message.input)
            const current = await loadGoogleSyncConfig()
            const changed = current.clientId !== clientId
            const updated = await saveGoogleSyncConfig(
                changed ? { clientId, accessToken: '', tokenExpiresAt: 0, accountEmail: '' } : { clientId },
            )
            return toGoogleSyncState(updated)
        }
        case 'connectGoogleSync': {
            const config = await loadGoogleSyncConfig()
            if (!config.clientId.trim()) throw new Error(t('sync.clientIdRequired'))
            if (!(await browser.permissions.contains({ origins: [`${googleApiOrigin}/*`] }))) {
                throw new Error(t('sync.permissionRequired'))
            }
            const auth = await authorizeGoogleDrive(config.clientId)
            const updated = await saveGoogleSyncConfig({
                accessToken: auth.accessToken,
                tokenExpiresAt: auth.tokenExpiresAt,
                accountEmail: auth.accountEmail,
            })
            return toGoogleSyncState(updated)
        }
        case 'disconnectGoogleSync':
            return toGoogleSyncState(await clearGoogleSyncAuth())
        case 'runGoogleSync': {
            let config = await loadGoogleSyncConfig()
            if (!config.clientId.trim()) throw new Error(t('sync.clientIdRequired'))
            if (!(await browser.permissions.contains({ origins: [`${googleApiOrigin}/*`] }))) {
                throw new Error(t('sync.permissionRequired'))
            }
            if (!config.accessToken || config.tokenExpiresAt <= Date.now()) {
                const auth = await authorizeGoogleDrive(config.clientId)
                config = await saveGoogleSyncConfig({
                    accessToken: auth.accessToken,
                    tokenExpiresAt: auth.tokenExpiresAt,
                    accountEmail: auth.accountEmail,
                })
            }
            try {
                const result = await syncBackupWithGoogleDrive(
                    config.accessToken,
                    exportVocabulary,
                    importVocabulary,
                )
                const summary = t('sync.syncDone', {
                    merged: result.mergedWords,
                    uploaded: result.uploadedWords,
                })
                const updated = await saveGoogleSyncConfig({
                    lastSyncedAt: Date.now(),
                    lastSyncSummary: summary,
                })
                if (result.mergedWords > 0) await notifyChanged({ event: 'vocabularyChanged' })
                return {
                    state: toGoogleSyncState(updated),
                    mergedWords: result.mergedWords,
                    uploadedWords: result.uploadedWords,
                }
            } catch (error) {
                if (error instanceof GoogleAuthExpiredError) {
                    await clearGoogleSyncAuth()
                }
                throw error
            }
        }
        case 'wordbookProfiles':
            return loadWordbookProfiles()
        case 'saveWordbookProfile':
            return saveWordbookProfile(message.input)
        case 'deleteWordbookProfile':
            return deleteWordbookProfile(z.string().trim().min(1).max(100).parse(message.input))
        case 'testWordbookProfile': {
            const profileId = z.string().trim().min(1).max(100).parse(message.input)
            const profiles = await loadWordbookProfiles()
            const profile = profiles.find((item) => item.id === profileId)
            if (!profile) throw new Error(t('wordbook.profileNotFound'))
            if (!(await browser.permissions.contains({ origins: [`${wordbookOrigin(profile.type)}/*`] }))) {
                throw new Error(t('wordbook.permissionRequired'))
            }
            const categories = await listWordbookCategories(profile, 'en')
            return { count: categories.length, categories }
        }
        case 'wordbookProfileSummaries':
            return listWordbookProfileSummaries()
        case 'wordbookCategories': {
            const input = z
                .object({
                    profileId: z.string().trim().min(1).max(100),
                    language: collectionLanguageSchema,
                })
                .parse(message.input)
            const profiles = await loadWordbookProfiles()
            const profile = profiles.find((item) => item.id === input.profileId)
            if (!profile) throw new Error(t('wordbook.profileNotFound'))
            if (!(await browser.permissions.contains({ origins: [`${wordbookOrigin(profile.type)}/*`] }))) {
                throw new Error(t('library.wordbookPermissionRequired'))
            }
            return listWordbookCategories(profile, input.language)
        }
        case 'syncCollectionWordbook': {
            const collectionId = collectionIdSchema.parse(message.input)
            const [collections, profiles, allWords] = await Promise.all([
                listCollections(),
                loadWordbookProfiles(),
                db.getAll('words'),
            ])
            const collection = collections.find((item) => item.id === collectionId)
            if (!collection) throw new Error(t('library.collectionNotFound'))
            const binding = collection.wordbook
            if (!binding) throw new Error(t('wordbook.notConfigured'))
            const profile = profiles.find((item) => item.id === binding.profileId)
            if (!profile) throw new Error(t('wordbook.profileNotFound'))
            if (!(await browser.permissions.contains({ origins: [`${wordbookOrigin(profile.type)}/*`] }))) {
                throw new Error(t('library.wordbookPermissionRequired'))
            }
            const learningWords = allWords
                .filter((word) => wordCollectionId(word) === collection.id && word.state === 'learning')
                .map((word) => word.text)
            const syncedCount = await appendWordsToWordbook(
                profile,
                binding.categoryId,
                collection.language,
                learningWords,
            )
            return { syncedCount, categoryName: binding.categoryName || binding.categoryId }
        }
        case 'definitionMode':
            return loadDefinitionMode()
        case 'saveDefinitionMode':
            await saveDefinitionMode(message.input)
            return null
        case 'export':
            return exportVocabulary()
        case 'import': {
            const count = await importVocabulary(message.input)
            await notifyChanged({ event: 'vocabularyChanged' })
            return count
        }
        case 'encounters':
            return db.getAllFromIndex('encounters', 'wordKey', z.string().max(200).parse(message.input))
        case 'activityCounts':
            return summarizeActivity(
                await db.getAllFromIndex('activities', 'createdAt', activityRange(message.input, 372)),
            )
        case 'activitiesForDay': {
            const rows = []
            let cursor = await db
                .transaction('activities')
                .store.index('createdAt')
                .openCursor(activityRange(message.input, 2), 'prev')
            while (cursor && rows.length < 201) {
                rows.push(cursor.value)
                cursor = await cursor.continue()
            }
            return rows
        }
        case 'getProgress':
            return db.get('progress', z.string().max(500).parse(message.input))
        case 'setProgress': {
            const progress = z
                .object({
                    id: z.string().max(500),
                    page: z.number().int().positive(),
                    updatedAt: z.number().finite(),
                })
                .parse(message.input)
            const tx = db.transaction('progress', 'readwrite')
            const previous = await tx.store.get(progress.id)
            if (!previous || previous.updatedAt <= progress.updatedAt) await tx.store.put(progress)
            await tx.done
            return null
        }
        case 'bookmarks':
            return db.getAllFromIndex(
                'bookmarks',
                'documentId',
                z.string().min(1).max(500).parse(message.input),
            )
        case 'setBookmark': {
            const { documentId, page, saved } = pdfBookmarkSchema
                .extend({ saved: z.boolean() })
                .parse(message.input)
            if (saved) await db.put('bookmarks', { documentId, page })
            else await db.delete('bookmarks', [documentId, page])
            return null
        }
        default:
            throw new Error(t('background.unsupported'))
    }
}

async function translate(
    requestKey: string,
    input: z.infer<typeof translationInputSchema>,
    overrideSettings?: TranslationSettings,
) {
    if (controllers.size >= 64 || controllers.has(requestKey)) throw new Error(t('translation.busy'))
    const controller = new AbortController()
    controllers.set(requestKey, controller)
    try {
        const [settings, defaultSource] = await Promise.all([
            overrideSettings ? Promise.resolve(overrideSettings) : loadSettings(),
            loadSourceLanguage(),
        ])
        if (!settings.baseUrl.trim() || !settings.model.trim()) throw new Error(t('translation.configure'))
        const endpoint = completionEndpoint(settings.baseUrl)
        if (!(await browser.permissions.contains({ origins: [`${endpoint.origin}/*`] }))) {
            throw new Error(t('translation.permission'))
        }
        const effectiveInput: z.infer<typeof translationInputSchema> = {
            ...input,
            sourceLanguage: input.sourceLanguage ?? defaultSource,
            targetLanguage: input.targetLanguage ?? settings.targetLanguage,
        }
        const key = await translationCacheKey(settings, effectiveInput)
        const db = await database
        const cached = await db.get('translations', key)
        controller.signal.throwIfAborted()
        if (cached && 'result' in cached) return cached.result
        let ongoing = ongoingTranslations.get(key)
        if (!ongoing) {
            if (ongoingTranslations.size >= 6) throw new Error(t('translation.busy'))
            const upstream = new AbortController()
            const result = requestTranslation(settings, effectiveInput, fetch, upstream.signal)
                .then(async (result) => {
                    await db
                        .put('translations', { key, result, createdAt: Date.now() })
                        .catch(() => undefined)
                    return result
                })
                .finally(() => {
                    if (ongoingTranslations.get(key)?.controller === upstream) ongoingTranslations.delete(key)
                })
            ongoing = { controller: upstream, result, consumers: 0 }
            ongoingTranslations.set(key, ongoing)
        }
        ongoing.consumers++
        const abortListener = new AbortController()
        const cancelled = new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
                once: true,
                signal: abortListener.signal,
            })
        })
        try {
            return await Promise.race([ongoing.result, cancelled])
        } finally {
            abortListener.abort()
            ongoing.consumers--
            if (ongoing.consumers === 0 && ongoingTranslations.get(key) === ongoing) {
                ongoingTranslations.delete(key)
                ongoing.controller.abort()
            }
        }
    } catch (error) {
        if (controller.signal.aborted) throw new Error(t('translation.cancelled'), { cause: error })
        if (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))
            throw new Error(t('translation.timeout'), { cause: error })
        if (error instanceof TypeError) throw new Error(t('translation.network'), { cause: error })
        throw error
    } finally {
        controllers.delete(requestKey)
    }
}
