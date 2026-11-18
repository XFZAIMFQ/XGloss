import { browser } from 'wxt/browser'
import { defaultTranslationSettings, definitionModeSchema, translationSettingsSchema } from '../domain/models'

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
