import { browser } from 'wxt/browser'
import { defaultTranslationSettings, translationSettingsSchema } from '../domain/models'

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
