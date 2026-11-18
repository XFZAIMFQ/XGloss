import { browser } from 'wxt/browser'
import { z } from 'zod'
import { database } from '../data/database'
import { exportVocabulary, importVocabulary, saveWord } from '../data/vocabulary-repository'
import { loadSettings, saveSettings } from '../data/settings'
import { errorMessage, sourceSchema, translationInputSchema, wordStateSchema } from '../domain/models'
import { lookupDictionary } from './dictionary'
import { completionEndpoint, requestTranslation, translationCacheKey } from './openai-translation'

const envelopeSchema = z.object({
    channel: z.literal('xgloss'),
    operation: z.string(),
    requestId: z.string().uuid(),
    input: z.unknown().optional(),
})
const controllers = new Map<string, AbortController>()
const privileged = new Set([
    'settings',
    'saveSettings',
    'export',
    'import',
    'encounters',
    'getProgress',
    'setProgress',
])

async function notifyVocabularyChanged() {
    const message = { event: 'vocabularyChanged' }
    await browser.runtime.sendMessage(message).catch(() => undefined)
    const tabs = await browser.tabs.query({})
    await Promise.allSettled(
        tabs.flatMap((tab) => (tab.id ? [browser.tabs.sendMessage(tab.id, message)] : [])),
    )
}

export async function handleMessage(raw: unknown, sender: Browser.runtime.MessageSender) {
    try {
        const message = envelopeSchema.parse(raw)
        const extensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) ?? false
        if (privileged.has(message.operation) && !extensionPage) throw new Error('此操作仅限扩展页面')
        if (
            ['settings', 'saveSettings'].includes(message.operation) &&
            sender.url !== browser.runtime.getURL('/options.html')
        ) {
            throw new Error('翻译配置仅限设置页访问')
        }
        const value = await execute(message, sender)
        return { ok: true, value }
    } catch (error) {
        return { ok: false, error: error instanceof z.ZodError ? '输入数据格式无效' : errorMessage(error) }
    }
}

async function execute(
    message: z.infer<typeof envelopeSchema>,
    sender: Browser.runtime.MessageSender,
): Promise<unknown> {
    const db = await database
    const owner = `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:`
    switch (message.operation) {
        case 'words':
            return db.getAll('words')
        case 'saveWord': {
            const input = z
                .object({
                    text: z.string().trim().min(1).max(200),
                    state: wordStateSchema,
                    source: sourceSchema.optional(),
                })
                .parse(message.input)
            await saveWord(input.text, input.state, input.source)
            await notifyVocabularyChanged()
            return null
        }
        case 'lookup':
            return lookupDictionary(z.string().max(200).parse(message.input))
        case 'settings':
            return loadSettings()
        case 'saveSettings':
            await saveSettings(message.input)
            return null
        case 'export':
            return exportVocabulary()
        case 'import': {
            const count = await importVocabulary(message.input)
            await notifyVocabularyChanged()
            return count
        }
        case 'encounters':
            return db.getAllFromIndex('encounters', 'wordKey', z.string().max(200).parse(message.input))
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
            await db.put('progress', progress)
            return null
        }
        case 'cancelTranslation': {
            controllers.get(owner + z.string().uuid().parse(message.input))?.abort()
            return null
        }
        case 'translate': {
            const input = translationInputSchema.parse(message.input)
            const settings = await loadSettings()
            if (!settings.baseUrl.trim()) throw new Error('请先打开 XGloss 设置，配置翻译服务')
            const endpoint = completionEndpoint(settings.baseUrl)
            if (!(await browser.permissions.contains({ origins: [`${endpoint.origin}/*`] }))) {
                throw new Error('翻译服务尚未授权，请在设置页保存并授权')
            }
            const key = await translationCacheKey(settings, input)
            const cached = await db.get('translations', key)
            if (cached) return cached.text
            if (controllers.size >= 4) throw new Error('正在处理其他翻译，请稍后重试')
            const controller = new AbortController()
            const requestKey = owner + message.requestId
            controllers.set(requestKey, controller)
            try {
                const text = await requestTranslation(settings, input, fetch, controller.signal)
                await db.put('translations', { key, text, createdAt: Date.now() }).catch(() => undefined)
                return text
            } catch (error) {
                if (controller.signal.aborted) throw new Error('翻译已取消', { cause: error })
                if (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))
                    throw new Error('翻译超时，请重试或调整超时时间', { cause: error })
                if (error instanceof TypeError)
                    throw new Error('无法连接翻译服务，请检查网络与服务地址', { cause: error })
                throw error
            } finally {
                controllers.delete(requestKey)
            }
        }
        default:
            throw new Error('不支持的操作')
    }
}
