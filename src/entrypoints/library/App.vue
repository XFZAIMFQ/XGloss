<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import WordCard from '../../components/WordCard.vue'
import AppShell from '../../components/AppShell.vue'
import VocabularyReview from '../../components/VocabularyReview.vue'
import VocabularyStatistics from '../../components/VocabularyStatistics.vue'
import { Plus, Search, Download, Upload, BookOpen, X, ArrowUpRight, Pin } from '@lucide/vue'
import { parseWordCsv } from '../../domain/csv'
import { errorMessage, type Encounter, type Word, type WordState } from '../../domain/models'
import { onVocabularyChanged, request } from '../../platform/messages'
const words = ref<Word[]>([])
const query = ref('')
const newWord = ref('')
const adding = ref(false)
const tab = ref('library')
const known = computed(() => words.value.filter((word) => word.state === 'known').length)
const learning = computed(() => words.value.filter((word) => word.state === 'learning').length)
const ignored = computed(() => words.value.filter((word) => word.state === 'ignored').length)
const progress = computed(() =>
    words.value.length ? Math.round((known.value / words.value.length) * 100) : 0,
)
function updateTab() {
    tab.value = ['#review', '#statistics'].includes(location.hash) ? location.hash.slice(1) : 'library'
}
const filter = ref('all')
const selected = ref('')
const encounters = ref<Encounter[]>([])
const error = ref('')
const status = ref('')
const filtered = computed(() =>
    words.value
        .filter(
            (word) =>
                word.text.toLowerCase().includes(query.value.toLowerCase()) &&
                (filter.value === 'all' || word.state === filter.value),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 300),
)
const labels: Record<WordState, string> = { learning: '学习中', known: '已掌握', ignored: '已忽略' }
let unsubscribe: (() => void) | undefined
async function refresh() {
    try {
        words.value = await request('words')
    } catch (reason) {
        error.value = errorMessage(reason)
    }
}
async function choose(word: Word) {
    try {
        const records = await request('encounters', word.key)
        encounters.value = records
        selected.value = word.text
    } catch (reason) {
        error.value = errorMessage(reason)
    }
}
function download(text: string, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function backup() {
    try {
        download(JSON.stringify(await request('export'), null, 2), 'application/json', 'xgloss-backup.json')
    } catch (reason) {
        error.value = errorMessage(reason)
    }
}
function csv() {
    const escape = (text: string) =>
        '"' + (/^[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
    download(
        '\uFEFFword,state\r\n' + words.value.map((word) => `${escape(word.text)},${word.state}`).join('\r\n'),
        'text/csv;charset=utf-8',
        'xgloss-words.csv',
    )
}
async function restore(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
        if (file.size > 50_000_000) throw new Error('备份文件超过 50 MB')
        const text = await file.text()
        const count = await request(
            'import',
            file.name.toLowerCase().endsWith('.csv') ? parseWordCsv(text) : JSON.parse(text),
        )
        status.value = `已合并 ${count} 个词条`
        error.value = ''
        await refresh()
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        ;(event.target as HTMLInputElement).value = ''
    }
}
async function addWords(state: WordState) {
    const text = newWord.value.trim()
    if (!text) return
    try {
        await request('saveWord', { text, state })
        newWord.value = ''
        adding.value = false
        await refresh()
    } catch (reason) {
        error.value = errorMessage(reason)
    }
}
function safeSource(url: string) {
    try {
        return ['https:', 'http:'].includes(new URL(url).protocol) ? url : undefined
    } catch {
        return undefined
    }
}
onMounted(() => {
    updateTab()
    window.addEventListener('hashchange', updateTab)
    void refresh()
    unsubscribe = onVocabularyChanged(() => void refresh())
})
onBeforeUnmount(() => {
    unsubscribe?.()
    window.removeEventListener('hashchange', updateTab)
})
</script>
<template>
    <AppShell :active="tab" :known="known">
        <template v-if="tab === 'library'">
            <header class="page-heading">
                <h1>我的词库</h1>
                <a class="button-link" href="reader.html">
                    <BookOpen :size="15" />
                    继续阅读
                </a>
            </header>
            <div class="library-toolbar">
                <button class="primary" @click="adding = true">
                    <Plus :size="18" />
                    添加单词
                </button>
                <div class="search-field">
                    <Search :size="20" />
                    <input v-model="query" placeholder="搜索或输入一个新单词" aria-label="搜索词库" />
                </div>
            </div>
            <article class="collection-card">
                <div class="collection-top">
                    <span class="language-chip">EN</span>
                    <Pin :size="17" class="orange-text" />
                </div>
                <h2>我的词库</h2>
                <p>在网页与 PDF 阅读中收藏的单词和原句。</p>
                <div class="collection-bottom">
                    <span>
                        <strong>{{ words.length.toLocaleString() }}</strong>
                        个词条
                    </span>
                    <span>{{ progress }}% 已掌握</span>
                </div>
                <div class="progress-track">
                    <span :style="{ width: progress + '%' }"></span>
                    <span
                        class="progress-learning"
                        :style="{ width: words.length ? (learning / words.length) * 100 + '%' : '0' }"
                    ></span>
                </div>
                <div class="state-counts">
                    <span>
                        <b class="count-learning">{{ learning }}</b>
                        学习中
                    </span>
                    <span>
                        <b class="count-known">{{ known }}</b>
                        已掌握
                    </span>
                    <span>
                        <b class="count-ignored">{{ ignored }}</b>
                        已忽略
                    </span>
                </div>
            </article>
            <section class="panel word-list-panel">
                <div class="word-list-heading">
                    <h2>词条</h2>
                    <select v-model="filter" aria-label="筛选词汇状态">
                        <option value="all">全部状态</option>
                        <option value="learning">学习中</option>
                        <option value="known">已掌握</option>
                        <option value="ignored">已忽略</option>
                    </select>
                </div>
                <p v-if="error" class="error" role="alert">{{ error }}</p>
                <p v-if="status" class="success" role="status">{{ status }}</p>
                <div v-if="!words.length" class="empty">
                    <div class="empty-icon"><BookOpen :size="30" /></div>
                    <h2>收藏阅读中的第一个单词</h2>
                    <p>在网页中开启 XGloss，或打开 PDF 开始阅读。</p>
                    <a class="button-link" href="reader.html">
                        打开 PDF 阅读器
                        <ArrowUpRight :size="16" />
                    </a>
                </div>
                <button v-for="word in filtered" :key="word.key" class="word-row" @click="choose(word)">
                    <strong>{{ word.text }}</strong>
                    <span class="word-state" :class="'count-' + word.state">{{ labels[word.state] }}</span>
                </button>
                <p v-if="words.length && !filtered.length" class="muted small">没有符合条件的词条。</p>
                <p v-if="filtered.length === 300" class="muted small">当前显示前 300 项，可搜索缩小范围。</p>
            </section>
            <div class="import-actions">
                <button @click="backup">
                    <Download :size="15" />
                    JSON 备份
                </button>
                <button @click="csv">
                    <Download :size="15" />
                    CSV 词表
                </button>
                <label class="import-button">
                    <input type="file" accept=".json,.csv" style="display: none" @change="restore" />
                    <Upload :size="15" />
                    导入 JSON / CSV
                </label>
            </div>
        </template>
        <VocabularyReview v-else-if="tab === 'review'" :words="words" @saved="refresh" />
        <VocabularyStatistics v-else :words="words" />
        <div v-if="adding" class="modal-backdrop" @click.self="adding = false">
            <form class="modal" @submit.prevent="addWords('learning')">
                <div class="row between">
                    <h2>添加单词</h2>
                    <button
                        class="icon-button"
                        type="button"
                        aria-label="关闭添加窗口"
                        @click="adding = false"
                    >
                        <X :size="20" />
                    </button>
                </div>
                <label class="field">
                    <span>单词或短语</span>
                    <input v-model="newWord" required maxlength="200" placeholder="例如 register" autofocus />
                </label>
                <p v-if="error" class="error" role="alert">{{ error }}</p>
                <div class="row">
                    <button type="button" @click="addWords('known')">标记熟词</button>
                    <button class="primary" type="submit">加入生词</button>
                </div>
            </form>
        </div>
        <div v-if="selected" class="modal-backdrop" @click.self="selected = ''">
            <div class="word-detail">
                <WordCard
                    :text="selected"
                    :source="encounters[0] ?? { title: '本地词库', url: '', context: '' }"
                    @saved="refresh"
                    @close="selected = ''"
                />
                <div v-if="encounters.length" class="encounter-list">
                    <h3>遇词记录</h3>
                    <div v-for="encounter in encounters" :key="encounter.id">
                        <a
                            v-if="safeSource(encounter.url)"
                            :href="safeSource(encounter.url)"
                            target="_blank"
                            rel="noreferrer"
                        >
                            {{ encounter.title }}
                        </a>
                        <span v-else>{{ encounter.title }}</span>
                        <span v-if="encounter.page">· 第 {{ encounter.page }} 页</span>
                        <blockquote>{{ encounter.context }}</blockquote>
                    </div>
                </div>
            </div>
        </div>
    </AppShell>
</template>
<style scoped>
.word-detail {
    max-width: 480px;
    width: 100%;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    border-radius: 24px;
    background: white;
}
.word-detail :deep(.word-card) {
    border: 0;
    box-shadow: none;
}
.encounter-list {
    padding: 0 24px 20px;
    font-size: 13px;
}
</style>
