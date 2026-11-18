import { browser } from 'wxt/browser'
import { z } from 'zod'
import { database } from '../data/database'
import { exportVocabulary, importVocabulary, saveWord } from '../data/vocabulary-repository'
import {
    loadDefinitionMode,
    loadRecall,
    loadSettings,
    loadSiteReading,
    loadSpotlight,
    saveDefinitionMode,
    saveRecall,
    saveSettings,
    saveSiteReading,
    saveSpotlight,
} from '../data/settings'
import { webHostname } from '../platform/web-site'
import { summarizeActivity } from '../domain/activity'
import {
    errorMessage,
    pdfBookmarkSchema,
    sourceSchema,
    translationInputSchema,
    wordRatingSchema,
} from '../domain/models'
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
    'saveDefinitionMode',
    'export',
    'import',
    'encounters',
    'wordDetails',
    'activityCounts',
    'activitiesForDay',
    'getProgress',
    'setProgress',
    'bookmarks',
    'setBookmark',
    'setSiteAnalysis',
])

function activityRange(input: unknown, maxDays: number) {
    const date = z.number().int().min(0).max(8.64e15)
    const { from, to } = z.object({ from: date, to: date }).parse(input)
    if (to <= from || to - from > maxDays * 86_400_000) throw new Error('学习活动日期范围无效')
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
    if (!site || (tabId === undefined && sender.frameId !== 0)) throw new Error('当前页面不支持网页分析')
    return site
}

export async function handleMessage(raw: unknown, sender: Browser.runtime.MessageSender) {
    try {
        const message = envelopeSchema.parse(raw)
        const extensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) ?? false
        if (privileged.has(message.operation) && !extensionPage) throw new Error('此操作仅限扩展页面')
        if (
            ['settings', 'saveSettings', 'saveDefinitionMode'].includes(message.operation) &&
            sender.url !== browser.runtime.getURL('/options.html')
        ) {
            throw new Error('此配置操作仅限设置页访问')
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
    switch (message.operation) {
        case 'siteReading': {
            const tabId = z.number().int().nonnegative().optional().parse(message.input)
            if (tabId !== undefined && !sender.url?.startsWith(browser.runtime.getURL('/')))
                throw new Error('此操作仅限扩展页面')
            return loadSiteReading(await resolveWebSite(sender, tabId))
        }
        case 'setSiteAnalysis': {
            const input = z
                .object({ tabId: z.number().int().nonnegative(), site: z.string(), enabled: z.boolean() })
                .parse(message.input)
            const site = await resolveWebSite(sender, input.tabId)
            if (site !== input.site) throw new Error('当前标签页已切换网站，请重新打开扩展菜单')
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
    }
    const db = await database
    const owner = `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:`
    switch (message.operation) {
        case 'words':
            return db.getAll('words')
        case 'saveWord': {
            const input = wordRatingSchema
                .extend({
                    text: z.string().trim().min(1).max(200),
                    source: sourceSchema.optional(),
                    reviewed: z.boolean().optional(),
                })
                .parse(message.input)
            if (input.state !== 'learning' && input.level !== undefined)
                throw new Error('等级只适用于学习中词条')
            await saveWord(input.text, input.state, input.source, { ...input, id: message.requestId })
            await notifyChanged({ event: 'vocabularyChanged' })
            return null
        }
        case 'lookup':
            return lookupDictionary(z.string().max(200).parse(message.input))
        case 'wordDetails': {
            const keys = z.array(z.string().min(1).max(200)).max(30).parse(message.input)
            const index = db.transaction('encounters').store.index('wordDate')
            return Promise.all(
                keys.map(async (key) => {
                    const range = IDBKeyRange.bound([key, -Infinity], [key, Infinity])
                    const [cursor, entry] = await Promise.all([
                        index.openCursor(range, 'prev'),
                        lookupDictionary(key),
                    ])
                    return { key, entry, encounter: cursor?.value }
                }),
            )
        }
        case 'settings':
            return loadSettings()
        case 'saveSettings':
            await saveSettings(message.input)
            return null
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
