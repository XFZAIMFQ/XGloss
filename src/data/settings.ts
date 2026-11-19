import { browser } from 'wxt/browser'
import {
    defaultTranslationSettings,
    definitionModeSchema,
    selectionTriggerSchema,
    sourceLanguageSchema,
    translationLanguagesSchema,
    translationSettingsSchema,
    type SelectionTrigger,
    type SourceLanguage,
    type TranslationLanguages,
} from '../domain/models'

export async function loadSettings() {
    const stored = await browser.storage.local.get('translation')
    return translationSettingsSchema.parse({
        ...defaultTranslationSettings,
        ...translationSettingsSchema.partial().parse(stored.translation ?? {}),
    })
}

export async function saveSettings(input: unknown): Promise<void> {
    await browser.storage.local.set({ translation: translationSettingsSchema.parse(input) })
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
    const [sourceLanguage, settings] = await Promise.all([loadSourceLanguage(), loadSettings()])
    return {
        sourceLanguage,
        targetLanguage: settings.targetLanguage,
    }
}

export async function saveTranslationLanguages(input: unknown): Promise<TranslationLanguages> {
    const next = translationLanguagesSchema.parse(input)
    const current = await loadSettings()
    const writes: Promise<unknown>[] = [browser.storage.local.set({ sourceLanguage: next.sourceLanguage })]
    if (current.targetLanguage !== next.targetLanguage) {
        writes.push(saveSettings({ ...current, targetLanguage: next.targetLanguage }))
    }
    await Promise.all(writes)
    return next
}
