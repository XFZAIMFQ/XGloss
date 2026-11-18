<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { browser } from 'wxt/browser'
import { PdfSession, type PdfOutlineEntry } from '../../features/pdf/pdf-session'
import { contextAround, normalizeWord } from '../../domain/vocabulary'
import { selectionAnchor } from '../../features/reading/selection-anchor'
import { useSpotlight } from '../../features/reading/use-spotlight'
import {
    errorMessage,
    type PdfBookmark,
    type ReadingProgress,
    type Word,
    type WordSource,
} from '../../domain/models'
import { onVocabularyChanged, request } from '../../platform/messages'
import ReadingPanel from '../../components/ReadingPanel.vue'
import FloatingWordCard from '../../components/FloatingWordCard.vue'

const container = ref<HTMLDivElement>()
const pages = ref<HTMLDivElement>()
const page = ref(1)
const pageInput = ref<number | string>(1)
const pageCount = ref(0)
const scale = ref('page-fit')
const spread = ref(false)
const continuous = ref(true)
const title = ref('PDF 阅读器')
const documentId = ref('')
const sourceUrl = ref('')
const url = ref(new URLSearchParams(location.search).get('url') ?? '')
const status = ref('打开文档后按页分析词汇')
const error = ref('')
const loading = ref(false)
const ready = ref(false)
const sidebar = ref<'' | 'outline' | 'bookmarks'>('')
const outline = ref<PdfOutlineEntry[]>()
const outlineLoading = ref(false)
const outlineError = ref('')
const bookmarks = ref<PdfBookmark[]>([])
const bookmarkSaving = ref(false)
const bookmarked = computed(() => bookmarks.value.some((bookmark) => bookmark.page === page.value))
const selected = ref('')
const anchor = shallowRef<HTMLElement | Range>()
const anchorBoundary = computed(() => (anchor.value instanceof Range ? container.value : undefined))
const selectedSource = ref<WordSource>({ title: '', url: '', context: '' })
const words = shallowRef<Word[]>()
const selectedRating = computed(() => words.value?.find((word) => word.key === normalizeWord(selected.value)))
const counts = shallowRef(new Map<string, number>())
const panelVisible = ref(true)
let session: PdfSession | undefined
let unsubscribe: (() => void) | undefined
let opening = 0
let selecting = 0
let refreshing = 0
let networkController: AbortController | undefined
let progressTimer: ReturnType<typeof setTimeout> | undefined
let pendingProgress: ReadingProgress | undefined
const { highlighting, setSpotlight } = useSpotlight((enabled) => {
    session?.highlight(words.value ?? [], enabled)
})

async function reloadWords(): Promise<Word[]> {
    const generation = ++refreshing
    const result = await request('words')
    if (generation === refreshing) {
        words.value = result
        session?.highlight(result, highlighting.value)
    }
    return result
}
async function refresh() {
    try {
        await reloadWords()
    } catch (reason) {
        error.value = errorMessage(reason)
    }
}

function flushProgress() {
    clearTimeout(progressTimer)
    const progress = pendingProgress
    pendingProgress = undefined
    if (!progress) return
    void request('setProgress', progress).catch((reason: unknown) => {
        if (progress.id === documentId.value) error.value = errorMessage(reason)
    })
}

function pageChanged(next: number) {
    page.value = next
    pageInput.value = next
    if (!ready.value || !documentId.value) return
    pendingProgress = { id: documentId.value, page: next, updatedAt: Date.now() }
    clearTimeout(progressTimer)
    progressTimer = setTimeout(flushProgress, 150)
}

async function open(data: Uint8Array, name: string, source: string) {
    const reader = session
    if (!reader) return
    const current = ++opening
    flushProgress()
    ready.value = false
    loading.value = true
    error.value = ''
    closeWordCard()
    counts.value = new Map()
    pageCount.value = 0
    outline.value = undefined
    outlineLoading.value = false
    outlineError.value = ''
    bookmarks.value = []
    bookmarkSaving.value = false
    status.value = '准备分析文档词汇…'
    try {
        const document = await reader.open(data)
        if (current !== opening) return
        const id = `pdf:${document.fingerprints[0]}`
        title.value = name
        sourceUrl.value = source
        documentId.value = id
        const [progress, saved] = await Promise.allSettled([
            request('getProgress', id),
            request('bookmarks', id),
        ])
        if (current !== opening) return
        if (progress.status === 'rejected') error.value = errorMessage(progress.reason)
        if (saved.status === 'rejected') error.value = errorMessage(saved.reason)
        else bookmarks.value = saved.value
        const restored = progress.status === 'fulfilled' ? (progress.value?.page ?? 1) : 1
        pageCount.value = document.numPages
        pageChanged(Math.min(restored, document.numPages))
        await nextTick()
        if (current !== opening) return
        await reader.show(page.value, scale.value, { spread: spread.value, continuous: continuous.value })
        if (current !== opening) return
        ready.value = true
        pageChanged(page.value)
        reader.highlight(words.value ?? [], highlighting.value)
        if (sidebar.value === 'outline') void loadOutline()
        void reader
            .analyze((nextCounts, analyzed, limited) => {
                if (current !== opening) return
                counts.value = nextCounts
                status.value = limited
                    ? `已分析 ${analyzed} 页 · 达到文本预算`
                    : analyzed < pageCount.value
                      ? `正在分析 ${analyzed} / ${pageCount.value} 页…`
                      : ''
                if (!nextCounts.size && analyzed === pageCount.value)
                    status.value = '未提取到文字，扫描文档需要 OCR'
            })
            .catch((reason: unknown) => {
                if (current === opening) error.value = errorMessage(reason)
            })
    } catch (reason) {
        if (current === opening) {
            pageCount.value = 0
            error.value = errorMessage(reason)
            await reader.close().catch(() => undefined)
        }
    } finally {
        if (current === opening) loading.value = false
    }
}

async function fileChanged(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || loading.value) return
    loading.value = true
    try {
        await open(new Uint8Array(await file.arrayBuffer()), file.name, '')
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        loading.value = false
        input.value = ''
    }
}

async function openUrl(authorized = false) {
    if (loading.value) return
    loading.value = true
    error.value = ''
    const controller = new AbortController()
    networkController = controller
    try {
        const parsed = new URL(url.value)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('请输入 HTTP 或 HTTPS PDF 链接')
        if (!authorized && !(await browser.permissions.request({ origins: [`${parsed.origin}/*`] })))
            throw new Error('需要 PDF 来源权限')
        const response = await fetch(parsed, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
            credentials: 'omit',
        })
        if (!response.ok) throw new Error(`PDF 下载失败，HTTP ${response.status}。可下载文件后本地打开。`)
        const data = new Uint8Array(await response.arrayBuffer())
        if (controller.signal.aborted) return
        const pathName = parsed.pathname.split('/').pop() || '在线 PDF'
        let file = pathName
        try {
            file = decodeURIComponent(pathName)
        } catch {
            // A malformed escape in the filename does not prevent reading the PDF.
        }
        await open(data, file, parsed.href)
    } catch (reason) {
        if (!controller.signal.aborted) error.value = errorMessage(reason)
    } finally {
        if (networkController === controller) {
            networkController = undefined
            loading.value = false
        }
    }
}

async function loadOutline() {
    if (!session || outline.value || outlineLoading.value) return
    const current = opening
    outlineLoading.value = true
    outlineError.value = ''
    try {
        const entries = await session.outline()
        if (current === opening) outline.value = entries
    } catch (reason) {
        if (current === opening) outlineError.value = errorMessage(reason)
    } finally {
        if (current === opening) outlineLoading.value = false
    }
}

async function jumpTo(entry: PdfOutlineEntry) {
    if (!entry.destination) return
    try {
        await session?.goToDestination(entry.destination)
    } catch (reason) {
        outlineError.value = errorMessage(reason)
    }
}

function toggleSidebar(view: 'outline' | 'bookmarks') {
    sidebar.value = sidebar.value === view ? '' : view
    if (sidebar.value === 'outline') void loadOutline()
}

async function toggleBookmark() {
    if (!ready.value || bookmarkSaving.value) return
    const current = opening
    const item = { documentId: documentId.value, page: page.value }
    const saved = !bookmarked.value
    bookmarkSaving.value = true
    try {
        await request('setBookmark', { ...item, saved })
        if (current !== opening) return
        bookmarks.value = saved
            ? [...bookmarks.value, item].sort((a, b) => a.page - b.page)
            : bookmarks.value.filter((bookmark) => bookmark.page !== item.page)
    } catch (reason) {
        if (current === opening) error.value = errorMessage(reason)
    } finally {
        if (current === opening) bookmarkSaving.value = false
    }
}

async function sourceForWord(
    word: string,
    number = session?.pageForWord(word) ?? page.value,
    fallback = '',
): Promise<WordSource> {
    const source = {
        title: title.value.slice(0, 1000),
        url: sourceUrl.value.slice(0, 8000),
        page: number,
        documentId: documentId.value,
    }
    const context = await session?.contextForWord(word, number)
    return { ...source, context: (context || fallback).slice(0, 3000) }
}

async function select(text: string, position: HTMLElement | Range, number?: number, fallback = '') {
    const current = ++selecting
    try {
        const source = await sourceForWord(text, number, fallback)
        if (current !== selecting) return
        anchor.value = position
        selectedSource.value = source
        selected.value = text
    } catch (reason) {
        if (current === selecting) error.value = errorMessage(reason)
    }
}

function selection() {
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!selection?.rangeCount || !text || text.length > 2000) return
    const node = selection.getRangeAt(0).startContainer
    const element = node instanceof Element ? node : node.parentElement
    const layer = element?.closest('.textLayer')
    const sourcePage = layer?.closest<HTMLElement>('[data-page-number]')
    if (!sourcePage || !pages.value?.contains(sourcePage)) return
    const number = Number(sourcePage.dataset.pageNumber)
    if (!Number.isInteger(number) || number < 1 || number > pageCount.value) return
    void select(text, selectionAnchor(selection), number, contextAround(element?.textContent ?? '', text))
}

function turn(next: number | string) {
    if (!ready.value) return
    const number = Number(next)
    if (!Number.isInteger(number) || number < 1) {
        pageInput.value = page.value
        return
    }
    const target = Math.min(pageCount.value, number)
    session?.goTo(target)
    pageChanged(target)
}

function changeLayout() {
    session?.setLayout({ spread: spread.value, continuous: continuous.value })
}

function closeWordCard() {
    selecting++
    selected.value = ''
    anchor.value = undefined
}

onMounted(() => {
    if (container.value && pages.value) {
        session = new PdfSession(container.value, pages.value, pageChanged)
        session.highlight(words.value ?? [], highlighting.value)
    }
    void refresh()
    unsubscribe = onVocabularyChanged(() => void refresh())
    window.addEventListener('pagehide', flushProgress)
    const parsed = URL.canParse(url.value) ? new URL(url.value) : null
    if (parsed && ['http:', 'https:'].includes(parsed.protocol)) {
        void browser.permissions
            .contains({ origins: [`${parsed.origin}/*`] })
            .then((allowed) => {
                if (allowed && url.value === parsed.href && session) void openUrl(true)
            })
            .catch(() => undefined)
    }
})
onBeforeUnmount(() => {
    opening++
    selecting++
    refreshing++
    flushProgress()
    window.removeEventListener('pagehide', flushProgress)
    networkController?.abort()
    unsubscribe?.()
    void session?.destroy().catch(() => undefined)
    session = undefined
})
</script>

<template>
    <main class="pdf-reader">
        <header class="reader-toolbar">
            <a class="brand" href="library.html">XGloss</a>
            <label class="file-button">
                打开本地 PDF
                <input type="file" accept="application/pdf,.pdf" :disabled="loading" @change="fileChanged" />
            </label>
            <input v-model="url" placeholder="在线 PDF 链接" class="url-input" @keydown.enter="openUrl()" />
            <button :disabled="loading" @click="openUrl()">{{ loading ? '正在打开…' : '打开链接' }}</button>
            <a href="options.html">翻译设置</a>
        </header>
        <div v-if="pageCount" class="page-toolbar">
            <span class="document-title" :title="title">{{ title }}</span>
            <button :disabled="!ready || page === 1" @click="session?.step(-1)">上一页</button>
            <input
                v-model.number="pageInput"
                aria-label="页码"
                type="number"
                min="1"
                :max="pageCount"
                @change="turn(pageInput)"
                @keydown.enter="turn(pageInput)"
            />
            <span>/ {{ pageCount }}</span>
            <button :disabled="!ready || page === pageCount" @click="session?.step(1)">下一页</button>
            <select v-model="scale" aria-label="缩放" :disabled="!ready" @change="session?.setScale(scale)">
                <option value="page-fit">适合页面</option>
                <option value="page-width">适合宽度</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
                <option value="2">200%</option>
            </select>
            <select v-model="spread" aria-label="页面布局" :disabled="!ready" @change="changeLayout">
                <option :value="false">单页</option>
                <option :value="true">双页</option>
            </select>
            <select v-model="continuous" aria-label="滚动方式" :disabled="!ready" @change="changeLayout">
                <option :value="true">连续滚动</option>
                <option :value="false">分页阅读</option>
            </select>
            <button :disabled="!ready" @click="session?.rotate()">旋转</button>
            <button
                :disabled="!ready"
                :aria-pressed="sidebar === 'outline'"
                @click="toggleSidebar('outline')"
            >
                目录
            </button>
            <button
                :disabled="!ready"
                :aria-pressed="sidebar === 'bookmarks'"
                @click="toggleSidebar('bookmarks')"
            >
                书签
            </button>
            <button :disabled="!ready || bookmarkSaving" @click="toggleBookmark">
                {{ bookmarked ? '移除本页书签' : '添加本页书签' }}
            </button>
            <button :aria-pressed="panelVisible" @click="panelVisible = !panelVisible">词汇面板</button>
        </div>
        <p v-if="error" class="reader-error error" role="alert">{{ error }}</p>
        <div v-if="!pageCount" class="reader-welcome">
            <h1>让技术文档成为你的词汇来源</h1>
            <p class="muted">打开 PDF，选中陌生单词，收藏原句。词汇状态与网页共享。</p>
            <p class="muted small">支持带文字层的 PDF。本地文件在电脑上解析。</p>
        </div>
        <div v-show="pageCount" class="reader-body">
            <aside
                v-if="sidebar"
                class="reader-sidebar"
                :aria-label="sidebar === 'outline' ? '文档目录' : '我的书签'"
            >
                <template v-if="sidebar === 'outline'">
                    <h2>文档目录</h2>
                    <p v-if="outlineLoading" role="status">正在读取目录…</p>
                    <p v-else-if="outlineError" role="alert">
                        {{ outlineError }}
                        <button @click="loadOutline">重试</button>
                    </p>
                    <p v-else-if="!outline?.length">这个 PDF 没有内置目录。</p>
                    <ul v-else class="pdf-navigation">
                        <li
                            v-for="(entry, index) in outline"
                            :key="index"
                            :style="{ paddingInlineStart: Math.min(8, entry.depth) * 10 + 'px' }"
                        >
                            <button v-if="entry.destination" class="quiet" @click="jumpTo(entry)">
                                {{ entry.title }}
                            </button>
                            <span v-else>{{ entry.title }}</span>
                        </li>
                    </ul>
                </template>
                <template v-else>
                    <h2>我的书签</h2>
                    <p v-if="!bookmarks.length">使用工具栏为当前页添加书签。</p>
                    <ul v-else class="pdf-navigation">
                        <li v-for="bookmark in bookmarks" :key="bookmark.page">
                            <button
                                class="quiet"
                                :aria-current="page === bookmark.page ? 'page' : undefined"
                                @click="turn(bookmark.page)"
                            >
                                第 {{ bookmark.page }} 页
                            </button>
                        </li>
                    </ul>
                </template>
            </aside>
            <div class="pdf-stage">
                <div
                    ref="container"
                    class="pdf-scroll"
                    aria-label="PDF 文档"
                    tabindex="0"
                    @mouseup="selection"
                    @keyup.shift="selection"
                >
                    <div ref="pages" class="pdfViewer"></div>
                </div>
            </div>
        </div>
        <div v-if="ready" v-show="panelVisible" class="floating">
            <ReadingPanel
                :source-id="documentId"
                :source-for-word="sourceForWord"
                :words="words"
                :counts="counts"
                :reload-words="reloadWords"
                :status="status"
                :highlighted="highlighting"
                :set-spotlight="setSpotlight"
                @select="select"
            />
        </div>
        <FloatingWordCard
            v-if="selected && anchor"
            :text="selected"
            :source="selectedSource"
            :rating="selectedRating"
            :anchor="anchor"
            :boundary="anchorBoundary"
            :spotlight="{ enabled: highlighting, setEnabled: setSpotlight }"
            @saved="refresh"
            @close="closeWordCard"
        />
    </main>
</template>
