import { browser } from 'wxt/browser'
import type {
    Backup,
    DictionaryEntry,
    Encounter,
    ReadingProgress,
    TranslationInput,
    TranslationSettings,
    Word,
    WordSource,
    WordState,
} from '../domain/models'

export interface Operations {
    words: { input: undefined; output: Word[] }
    saveWord: { input: { text: string; state: WordState; source?: WordSource }; output: null }
    lookup: { input: string; output: DictionaryEntry | null }
    translate: { input: TranslationInput; output: string }
    cancelTranslation: { input: string; output: null }
    settings: { input: undefined; output: TranslationSettings }
    saveSettings: { input: TranslationSettings; output: null }
    export: { input: undefined; output: Backup }
    import: { input: unknown; output: number }
    encounters: { input: string; output: Encounter[] }
    getProgress: { input: string; output: ReadingProgress | undefined }
    setProgress: { input: ReadingProgress; output: null }
}

export async function request<K extends keyof Operations>(
    operation: K,
    input?: Operations[K]['input'],
    requestId = crypto.randomUUID(),
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
