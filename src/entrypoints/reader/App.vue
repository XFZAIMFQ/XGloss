<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { browser } from 'wxt/browser'
import { PdfSession } from '../../features/pdf/pdf-session'
import { calculateCoverage } from '../../domain/vocabulary'
import { errorMessage, type Word, type WordSource } from '../../domain/models'
import { onVocabularyChanged, request } from '../../platform/messages'
import ReadingPanel from '../../components/ReadingPanel.vue'
import WordCard from '../../components/WordCard.vue'

const session = new PdfSession()
const pageContainer = ref<HTMLElement>()
const page = ref(1)
const pageCount = ref(0)
const scale = ref(1.25)
const rotation = ref(0)
const title = ref('PDF 阅读器')
const documentId = ref('')
const sourceUrl = ref('')
const url = ref(new URLSearchParams(location.search).get('url') ?? '')
const status = ref('打开文档后按页分析词汇')
const error = ref('')
const loading = ref(false)
const selected = ref('')
const selectedSource = ref<WordSource>({ title: '', url: '', context: '' })
const words = ref<Word[]>([])
const counts = shallowRef(new Map<string, number>())
const coverage = computed(() => calculateCoverage(counts.value, words.value))
const panelVisible = ref(true)
const highlighting = ref(true)
let unsubscribe: (() => void) | undefined
let opening = 0
let rendering = 0
let networkController: AbortController | undefined

async function refresh() {
    words.value = await request('words')
    session.highlight(words.value, highlighting.value)
}
async function render() {
    if (!pageContainer.value || !pageCount.value) return
    const current = ++rendering
    try {
        await session.render(pageContainer.value, page.value, scale.value, rotation.value)
        if (current !== rendering) return
        session.highlight(words.value, highlighting.value)
        await request('setProgress', { id: documentId.value, page: page.value, updatedAt: Date.now() })
    } catch (reason) {
        if (current === rendering) error.value = errorMessage(reason)
    }
}
async function open(data: Uint8Array, name: string, source: string) {
    const current = ++opening
    loading.value = true
    error.value = ''
    selected.value = ''
    counts.value = new Map()
    try {
        const document = await session.open(data)
        if (current !== opening) return
        title.value = name
        sourceUrl.value = source
        documentId.value = `pdf:${document.fingerprints[0]}`
        pageCount.value = document.numPages
        const progress = await request('getProgress', documentId.value)
        page.value = Math.min(progress?.page ?? 1, pageCount.value)
        await nextTick()
        await render()
        void session
            .analyze((nextCounts, pages, limited) => {
                if (current !== opening) return
                counts.value = nextCounts
                status.value = `已分析 ${pages} / ${pageCount.value} 页${limited ? ' · 达到文本预算' : ''}`
                if (!nextCounts.size && pages === pageCount.value)
                    status.value = '未提取到文字，扫描文档需要 OCR'
            })
            .catch((reason) => {
                if (current === opening) error.value = errorMessage(reason)
            })
    } catch (reason) {
        if (current === opening) error.value = errorMessage(reason)
    } finally {
        if (current === opening) loading.value = false
    }
}
async function fileChanged(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    networkController?.abort()
    await open(new Uint8Array(await file.arrayBuffer()), file.name, '')
    ;(event.target as HTMLInputElement).value = ''
}
async function openUrl() {
    error.value = ''
    try {
        const parsed = new URL(url.value)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('请输入 HTTP 或 HTTPS PDF 链接')
        if (!(await browser.permissions.request({ origins: [`${parsed.origin}/*`] })))
            throw new Error('需要 PDF 来源权限')
        networkController?.abort()
        const controller = new AbortController()
        networkController = controller
        loading.value = true
        const response = await fetch(parsed, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
            credentials: 'omit',
        })
        if (!response.ok) throw new Error(`PDF 下载失败，HTTP ${response.status}。可下载文件后本地打开。`)
        const data = new Uint8Array(await response.arrayBuffer())
        if (controller.signal.aborted) return
        await open(data, decodeURIComponent(parsed.pathname.split('/').pop() || '在线 PDF'), parsed.href)
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        loading.value = false
    }
}
function sourceForWord(word: string): WordSource {
    return {
        title: title.value,
        url: sourceUrl.value,
        context: session.contextForWord(word),
        page: page.value,
        documentId: documentId.value,
    }
}
function select(text: string, context = '') {
    selected.value = text
    selectedSource.value = {
        title: title.value,
        url: sourceUrl.value,
        context: (session.contextForWord(text) || context).slice(0, 3000),
        page: page.value,
        documentId: documentId.value,
    }
}
function selection() {
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!text || text.length > 2000 || !pageContainer.value?.contains(selection?.anchorNode ?? null)) return
    select(text, selection?.anchorNode?.parentElement?.textContent ?? '')
}
function turn(next: number) {
    page.value = Math.max(1, Math.min(pageCount.value, next))
    void render()
}
function rotate() {
    rotation.value = (rotation.value + 90) % 360
    void render()
}
function zoom(next: number) {
    scale.value = next
    void render()
}
function highlight(enabled: boolean) {
    highlighting.value = enabled
    session.highlight(words.value, enabled)
}
onMounted(() => {
    void refresh().catch((reason) => {
        error.value = errorMessage(reason)
    })
    unsubscribe = onVocabularyChanged(
        () =>
            void refresh().catch((reason) => {
                error.value = errorMessage(reason)
            }),
    )
})
onBeforeUnmount(() => {
    opening++
    rendering++
    networkController?.abort()
    unsubscribe?.()
    void session.destroy()
})
</script>
<template>
    <main>
        <header class="reader-toolbar">
            <a class="brand" href="library.html">XGloss</a>
            <label class="file-button">
                打开本地 PDF
                <input type="file" accept="application/pdf,.pdf" :disabled="loading" @change="fileChanged" />
            </label>
            <input v-model="url" placeholder="在线 PDF 链接" class="url-input" @keydown.enter="openUrl" />
            <button :disabled="loading" @click="openUrl">{{ loading ? '正在打开…' : '打开链接' }}</button>
            <a href="options.html">翻译设置</a>
        </header>
        <div v-if="pageCount" class="page-toolbar">
            <span class="document-title">{{ title }}</span>
            <button @click="turn(page - 1)">上一页</button>
            <input
                v-model.number="page"
                aria-label="页码"
                type="number"
                min="1"
                :max="pageCount"
                style="width: 75px"
                @change="turn(page)"
            />
            <span>/ {{ pageCount }}</span>
            <button @click="turn(page + 1)">下一页</button>
            <select
                :value="scale"
                aria-label="缩放"
                style="width: 105px"
                @change="zoom(Number(($event.target as HTMLSelectElement).value))"
            >
                <option :value="0.75">75%</option>
                <option :value="1">100%</option>
                <option :value="1.25">125%</option>
                <option :value="1.5">150%</option>
                <option :value="2">200%</option>
            </select>
            <button @click="rotate">旋转</button>
            <button @click="panelVisible = !panelVisible">词汇面板</button>
        </div>
        <p v-if="error" class="reader-error error" role="alert">{{ error }}</p>
        <div v-if="!pageCount" class="reader-welcome">
            <h1>让技术文档成为你的词汇来源</h1>
            <p class="muted">打开 PDF，选中陌生单词，收藏原句。词汇状态与网页共享。</p>
            <p class="muted small">支持带文字层的 PDF。本地文件在电脑上解析。</p>
        </div>
        <div class="pdf-scroll"><div ref="pageContainer" class="pdf-page" @mouseup="selection"></div></div>
        <div v-if="pageCount && panelVisible" class="floating">
            <ReadingPanel
                :source-for-word="sourceForWord"
                :coverage="coverage"
                :status="status"
                @select="select"
                @highlight="highlight"
                @close="panelVisible = false"
            />
        </div>
        <div v-if="selected" class="floating-card">
            <WordCard :text="selected" :source="selectedSource" @saved="refresh" @close="selected = ''" />
        </div>
    </main>
</template>
