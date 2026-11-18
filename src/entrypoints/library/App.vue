<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WordCard from '../../components/WordCard.vue'
import AppShell from '../../components/AppShell.vue'
import VocabularyReview from '../../components/VocabularyReview.vue'
import VocabularyStatistics from '../../components/VocabularyStatistics.vue'
import { Plus, Search, Download, Upload, BookOpen, X, ArrowUpRight, Pin } from '@lucide/vue'
import { parseWordCsv } from '../../domain/csv'
import { dictionaryMeanings } from '../../domain/definitions'
import { normalizeWord, ratingLabel } from '../../domain/vocabulary'
import {
    errorMessage,
    learningLevels,
    learningLevelSchema,
    type Encounter,
    type Word,
    type WordRating,
    type WordState,
} from '../../domain/models'
import { onVocabularyChanged, request, type Operations } from '../../platform/messages'
const words = ref<Word[]>([])
const query = ref('')
const newWord = ref('')
const adding = ref(false)
const tab = ref('library')
const inCollection = ref(false)
const known = computed(() => words.value.filter((word) => word.state === 'known').length)
const learning = computed(() => words.value.filter((word) => word.state === 'learning').length)
const ignored = computed(() => words.value.filter((word) => word.state === 'ignored').length)
const progress = computed(() =>
    words.value.length ? Math.round((known.value / words.value.length) * 100) : 0,
)
function updateTab() {
    tab.value = ['#review', '#statistics'].includes(location.hash) ? location.hash.slice(1) : 'library'
    inCollection.value = location.hash === '#collection'
    selected.value = ''
    detailLoading.value = ''
    selectionGeneration++
}
const filter = ref('all')
const selected = ref('')
const selectedWord = computed(() => words.value.find((word) => word.key === selected.value))
const encounters = ref<Encounter[]>([])
const error = ref('')
const status = ref('')
const pageSize = 25
const currentPage = ref(1)
const ratingPending = ref(new Set<string>())
const details = ref(new Map<string, Operations['wordDetails']['output'][number]>())
const detailLoading = ref('')
let selectionGeneration = 0
let refreshGeneration = 0
const filtered = computed(() =>
    words.value
        .filter(
            (word) =>
                word.key.includes(normalizeWord(query.value)) &&
                (filter.value === 'all' || word.state === filter.value || filter.value === ratingValue(word)),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key)),
)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const page = computed(() => Math.min(currentPage.value, pages.value))
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch([query, filter], () => {
    currentPage.value = 1
})
watch([rows, inCollection], async ([items, open], _previous, onCleanup) => {
    let stale = false
    onCleanup(() => {
        stale = true
    })
    if (!items.length || !open) return
    try {
        const result = await request(
            'wordDetails',
            items.map((word) => word.key),
        )
        if (!stale) details.value = new Map(result.map((detail) => [detail.key, detail]))
    } catch (reason) {
        if (!stale) error.value = errorMessage(reason)
    }
})
function ratingValue(word: Word) {
    return word.state === 'learning' ? `level-${word.level ?? 1}` : word.state
}
function meaningFor(word: Word) {
    return (
        word.meaning ??
        dictionaryMeanings(details.value.get(word.key)?.entry ?? null, 'simple')
            .slice(0, 3)
            .join(' / ')
    )
}
let unsubscribe: (() => void) | undefined
async function refresh() {
    const generation = ++refreshGeneration
    try {
        const result = await request('words')
        if (generation === refreshGeneration) words.value = result
    } catch (reason) {
        if (generation === refreshGeneration) error.value = errorMessage(reason)
    }
}
async function choose(word: Word) {
    const generation = ++selectionGeneration
    detailLoading.value = word.key
    try {
        const records = await request('encounters', word.key)
        if (generation !== selectionGeneration) return
        encounters.value = records.sort((a, b) => b.createdAt - a.createdAt)
        selected.value = word.key
    } catch (reason) {
        if (generation === selectionGeneration) error.value = errorMessage(reason)
    } finally {
        if (generation === selectionGeneration) detailLoading.value = ''
    }
}
async function rate(word: Word, event: Event) {
    const select = event.target as HTMLSelectElement
    ratingPending.value.add(word.key)
    error.value = ''
    try {
        const value = select.value
        const rating: WordRating =
            value === 'known' || value === 'ignored'
                ? { state: value }
                : { state: 'learning' as const, level: learningLevelSchema.parse(Number(value.slice(6))) }
        await request('saveWord', { text: word.text, ...rating })
        await refresh()
    } catch (reason) {
        select.value = ratingValue(word)
        error.value = errorMessage(reason)
    } finally {
        ratingPending.value.delete(word.key)
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
        '\uFEFFword,state,level,meaning\r\n' +
            words.value
                .map(
                    (word) =>
                        `${escape(word.text)},${word.state},${word.state === 'learning' ? (word.level ?? 1) : ''},${escape(word.meaning ?? '')}`,
                )
                .join('\r\n'),
        'text/csv;charset=utf-8',
        'xgloss-words.csv',
    )
}
async function restore(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
        if (file.size > 50_000_000) throw new Error(t('library.backupTooLarge'))
        const text = await file.text()
        const count = await request(
            'import',
            file.name.toLowerCase().endsWith('.csv') ? parseWordCsv(text) : JSON.parse(text),
        )
        status.value = t('library.merged', { count })
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
        location.hash = 'collection'
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
    selectionGeneration++
    refreshGeneration++
    unsubscribe?.()
    window.removeEventListener('hashchange', updateTab)
})
</script>
<template>
    <AppShell :active="tab" :known="known">
        <template v-if="tab === 'library'">
            <header class="page-heading">
                <h1>{{ inCollection ? t('library.collection') : t('common.library') }}</h1>
                <a v-if="inCollection" class="button-link" href="#library">{{ t('library.back') }}</a>
                <a v-else class="button-link" href="reader.html">
                    <BookOpen :size="15" />
                    {{ t('library.continueReading') }}
                </a>
            </header>
            <div class="library-toolbar">
                <button class="primary" @click="adding = true">
                    <Plus :size="18" />
                    {{ t('library.addWord') }}
                </button>
                <div v-if="inCollection" class="search-field">
                    <Search :size="20" />
                    <input
                        v-model="query"
                        :placeholder="t('library.searchPlaceholder')"
                        :aria-label="t('library.search')"
                    />
                </div>
            </div>
            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <p v-if="status" class="success" role="status">{{ status }}</p>
            <article v-if="!inCollection" class="collection-card">
                <div class="collection-top">
                    <span class="language-chip">EN</span>
                    <Pin :size="17" class="orange-text" />
                </div>
                <h2>{{ t('library.collection') }}</h2>
                <p>{{ t('library.collectionIntro') }}</p>
                <div class="collection-bottom">
                    <span>
                        <strong>{{ words.length.toLocaleString() }}</strong>
                        {{ t('library.wordCountLabel') }}
                    </span>
                    <span>{{ t('library.knownPercent', { percent: progress }) }}</span>
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
                        {{ t('common.learning') }}
                    </span>
                    <span>
                        <b class="count-known">{{ known }}</b>
                        {{ t('common.known') }}
                    </span>
                    <span>
                        <b class="count-ignored">{{ ignored }}</b>
                        {{ t('common.ignored') }}
                    </span>
                </div>
                <a class="button-link collection-open" href="#collection">
                    {{ t('library.openCollection') }}
                    <ArrowUpRight :size="16" />
                </a>
            </article>
            <section v-else class="panel word-list-panel">
                <div class="word-list-heading">
                    <h2>{{ t('library.words') }}</h2>
                    <select v-model="filter" :aria-label="t('library.filter')">
                        <option value="all">{{ t('library.allStates') }}</option>
                        <option value="learning">{{ t('common.learning') }}</option>
                        <option v-for="level in learningLevels" :key="level" :value="`level-${level}`">
                            {{ t('rating.learningLevel', { level }) }}
                        </option>
                        <option value="known">{{ t('common.known') }}</option>
                        <option value="ignored">{{ t('common.ignored') }}</option>
                    </select>
                </div>
                <div v-if="!words.length" class="empty">
                    <div class="empty-icon"><BookOpen :size="30" /></div>
                    <h2>{{ t('library.firstWord') }}</h2>
                    <p>{{ t('library.getStarted') }}</p>
                    <a class="button-link" href="reader.html">
                        {{ t('library.openPdf') }}
                        <ArrowUpRight :size="16" />
                    </a>
                </div>
                <div v-for="word in rows" :key="word.key" class="word-row collection-word">
                    <div class="collection-term">
                        <button class="quiet" :disabled="detailLoading === word.key" @click="choose(word)">
                            <strong>{{ word.text }}</strong>
                        </button>
                        <p v-if="details.get(word.key)?.encounter?.context" class="muted small">
                            {{ details.get(word.key)?.encounter?.context }}
                        </p>
                    </div>
                    <p v-if="meaningFor(word)" class="collection-meaning">{{ meaningFor(word) }}</p>
                    <select
                        :aria-label="`${word.text} - ${ratingLabel(word)}`"
                        :value="ratingValue(word)"
                        :disabled="ratingPending.has(word.key)"
                        @change="rate(word, $event)"
                    >
                        <option v-for="level in learningLevels" :key="level" :value="`level-${level}`">
                            {{ t('rating.learningLevel', { level }) }}
                        </option>
                        <option value="known">{{ t('common.known') }}</option>
                        <option value="ignored">{{ t('common.ignored') }}</option>
                    </select>
                </div>
                <p v-if="words.length && !filtered.length" class="muted small">
                    {{ t('library.noResults') }}
                </p>
                <nav v-if="pages > 1" class="row collection-pages" :aria-label="t('library.pagination')">
                    <button :disabled="page <= 1" @click="currentPage = page - 1">
                        {{ t('common.previousPage') }}
                    </button>
                    <span>{{ t('library.pageNumber', { page, pages }) }}</span>
                    <button :disabled="page >= pages" @click="currentPage = page + 1">
                        {{ t('common.nextPage') }}
                    </button>
                </nav>
            </section>
            <div class="import-actions">
                <button @click="backup">
                    <Download :size="15" />
                    {{ t('library.jsonBackup') }}
                </button>
                <button @click="csv">
                    <Download :size="15" />
                    {{ t('library.csvWords') }}
                </button>
                <label class="import-button">
                    <input type="file" accept=".json,.csv" style="display: none" @change="restore" />
                    <Upload :size="15" />
                    {{ t('library.import') }}
                </label>
            </div>
        </template>
        <VocabularyReview v-else-if="tab === 'review'" :words="words" @saved="refresh" />
        <VocabularyStatistics v-else :words="words" />
        <div v-if="adding" class="modal-backdrop" @click.self="adding = false">
            <form class="modal" @submit.prevent="addWords('learning')">
                <div class="row between">
                    <h2>{{ t('library.addWord') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('library.closeAddWord')"
                        @click="adding = false"
                    >
                        <X :size="20" />
                    </button>
                </div>
                <label class="field">
                    <span>{{ t('library.wordOrPhrase') }}</span>
                    <input
                        v-model="newWord"
                        required
                        maxlength="200"
                        :placeholder="t('library.exampleWord')"
                        autofocus
                    />
                </label>
                <p v-if="error" class="error" role="alert">{{ error }}</p>
                <div class="row">
                    <button type="button" @click="addWords('known')">{{ t('library.markKnown') }}</button>
                    <button class="primary" type="submit">{{ t('library.addLearning') }}</button>
                </div>
            </form>
        </div>
        <div v-if="selectedWord" class="modal-backdrop" @click.self="selected = ''">
            <div class="word-detail">
                <WordCard
                    :text="selectedWord.text"
                    :rating="selectedWord"
                    :saved-meaning="selectedWord.meaning"
                    :save-source="false"
                    :source="encounters[0] ?? { title: t('common.localLibrary'), url: '', context: '' }"
                    @saved="refresh"
                    @close="selected = ''"
                />
                <div v-if="encounters.length" class="encounter-list">
                    <h3>{{ t('library.encounters') }}</h3>
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
                        <span v-if="encounter.page">
                            {{ t('library.encounterPage', { page: encounter.page }) }}
                        </span>
                        <p v-if="encounter.meaning" class="collection-meaning">{{ encounter.meaning }}</p>
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
.collection-open,
.collection-pages {
    margin-top: 16px;
}
.collection-word {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
    gap: 12px;
}
.collection-word select {
    grid-column: 3;
    width: auto;
}
.collection-term button {
    padding-left: 0;
    text-align: left;
    overflow-wrap: anywhere;
}
.collection-term p {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.collection-meaning {
    overflow-wrap: anywhere;
}
@media (max-width: 600px) {
    .collection-word {
        grid-template-columns: minmax(0, 1fr) auto;
    }
    .collection-meaning {
        grid-row: 2;
    }
    .collection-word select {
        grid-column: 2;
        grid-row: 1;
    }
}
</style>
