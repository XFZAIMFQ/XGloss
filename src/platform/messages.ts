import { browser } from 'wxt/browser'
import type {
    Backup,
    DefinitionMode,
    DictionaryEntry,
    Encounter,
    LearningActivity,
    PdfBookmark,
    ReadingProgress,
    TranslationInput,
    TranslationSettings,
    Word,
    WordSource,
    WordRating,
} from '../domain/models'

export interface Operations {
    words: { input: undefined; output: Word[] }
    saveWord: { input: WordRating & { text: string; source?: WordSource; reviewed?: boolean }; output: null }
    wordDetails: {
        input: string[]
        output: { key: string; entry: DictionaryEntry | null; encounter?: Encounter }[]
    }
    lookup: { input: string; output: DictionaryEntry | null }
    translate: { input: TranslationInput; output: string }
    cancelTranslation: { input: string; output: null }
    settings: { input: undefined; output: TranslationSettings }
    saveSettings: { input: TranslationSettings; output: null }
    definitionMode: { input: undefined; output: DefinitionMode }
    saveDefinitionMode: { input: DefinitionMode; output: null }
    siteReading: { input: number | undefined; output: { analysis: boolean } }
    setSiteAnalysis: { input: { tabId: number; site: string; enabled: boolean }; output: null }
    spotlight: { input: undefined; output: boolean }
    setSpotlight: { input: boolean; output: null }
    recallCandidateMeanings: { input: undefined; output: boolean }
    setRecallCandidateMeanings: { input: boolean; output: null }
    export: { input: undefined; output: Backup }
    import: { input: unknown; output: number }
    encounters: { input: string; output: Encounter[] }
    activityCounts: { input: { from: number; to: number }; output: Record<string, number> }
    activitiesForDay: { input: { from: number; to: number }; output: LearningActivity[] }
    getProgress: { input: string; output: ReadingProgress | undefined }
    setProgress: { input: ReadingProgress; output: null }
    bookmarks: { input: string; output: PdfBookmark[] }
    setBookmark: { input: PdfBookmark & { saved: boolean }; output: null }
}

export function newRequestId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    // Plain HTTP documents can use getRandomValues even when randomUUID is unavailable.
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function request<K extends keyof Operations>(
    operation: K,
    input?: Operations[K]['input'],
    requestId = newRequestId(),
): Promise<Operations[K]['output']> {
    const response = await browser.runtime.sendMessage({ channel: 'xgloss', operation, input, requestId })
    if (!response || response.ok !== true)
        throw new Error(response?.error ?? '扩展后台暂时不可用，请重新加载页面')
    return response.value
}

export function onVocabularyChanged(callback: () => void): () => void {
    const listener = (message: unknown) => {
        if (
            typeof message === 'object' &&
            message !== null &&
            'event' in message &&
            message.event === 'vocabularyChanged'
        )
            callback()
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
}

export function onReadingChanged(callback: (change: 'site' | 'recall' | 'spotlight', site?: string) => void) {
    const listener = (message: unknown) => {
        if (!message || typeof message !== 'object' || !('event' in message)) return
        if (message.event === 'siteReadingChanged' && 'site' in message && typeof message.site === 'string')
            callback('site', message.site)
        if (message.event === 'candidateRecallChanged') callback('recall')
        if (message.event === 'spotlightChanged') callback('spotlight')
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
}
