<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import WordCard from '../../components/WordCard.vue'
import WordRatingControls from '../../components/WordRatingControls.vue'
import LanguageFlag from '../../components/LanguageFlag.vue'
import AppShell from '../../components/AppShell.vue'
import VocabularyReview from '../../components/VocabularyReview.vue'
import VocabularyStatistics from '../../components/VocabularyStatistics.vue'
import ShadcnSelect, { type SelectOption } from '../../components/ShadcnSelect.vue'
import {
    Plus,
    Search,
    Download,
    Upload,
    BookOpen,
    X,
    ArrowUpRight,
    Pin,
    Pencil,
    ChevronLeft,
    Trash2,
} from '@lucide/vue'
import { parseWordCsv } from '../../domain/csv'
import { dictionaryMeanings } from '../../domain/definitions'
import { languageInfo, languageOptions, sortCollections, wordCollectionId } from '../../domain/collections'
import { normalizeWord } from '../../domain/vocabulary'
import {
    defaultCollectionId,
    errorMessage,
    learningLevels,
    type CollectionLanguage,
    type Encounter,
    type VocabularyCollection,
    type Word,
    type WordRating,
    type WordState,
} from '../../domain/models'
import { onVocabularyChanged, request, type Operations } from '../../platform/messages'

const words = ref<Word[]>([])
const collections = ref<VocabularyCollection[]>([])
const query = ref('')
const filter = ref('all')
const filterOptions: readonly SelectOption[] = [
    { value: 'all', label: t('library.allStates') },
    { value: 'learning', label: t('common.learning') },
    ...learningLevels.map((level) => ({
        value: `level-${level}`,
        label: t('rating.learningLevel', { level }),
    })),
    { value: 'known', label: t('common.known') },
    { value: 'ignored', label: t('common.ignored') },
]
const tab = ref('library')
const inCollection = ref(false)
const activeCollection = ref(defaultCollectionId)
const adding = ref(false)
const newWord = ref('')
const newMeaning = ref('')
const collectionModalOpen = ref(false)
const editingCollectionId = ref<string>()
const collectionForm = reactive<{
    language: CollectionLanguage
    name: string
    description: string
    pinned: boolean
}>({
    language: 'en',
    name: '',
    description: '',
    pinned: false,
})
const collectionSaving = ref(false)
const pinPending = ref(new Set<string>())
const editingWord = ref<Word>()
const editText = ref('')
const editMeaning = ref('')
const editRating = ref<WordRating>({ state: 'learning', level: 1 })
const wordSubmitting = ref(false)

const known = computed(() => words.value.filter((word) => word.state === 'known').length)
const sortedCollections = computed(() => sortCollections(collections.value))
const currentCollectionId = computed(() => {
    const id = activeCollection.value
    if (collections.value.some((collection) => collection.id === id)) return id
    return sortedCollections.value[0]?.id ?? defaultCollectionId
})
const currentCollection = computed(() =>
    collections.value.find((collection) => collection.id === currentCollectionId.value),
)
const collectionSummaries = computed(() =>
    sortedCollections.value.map((collection) => {
        const items = words.value.filter((word) => wordCollectionId(word) === collection.id)
        const knownCount = items.filter((word) => word.state === 'known').length
        const learningCount = items.filter((word) => word.state === 'learning').length
        const ignoredCount = items.filter((word) => word.state === 'ignored').length
        const progress = items.length ? Math.round((knownCount / items.length) * 100) : 0
        const learningPercent = items.length ? (learningCount / items.length) * 100 : 0
        return {
            collection,
            language: languageInfo(collection.language),
            words: items,
            known: knownCount,
            learning: learningCount,
            ignored: ignoredCount,
            progress,
            learningPercent,
        }
    }),
)
const collectionWords = computed(() =>
    words.value.filter((word) => wordCollectionId(word) === currentCollectionId.value),
)

function updateTab() {
    const hash = location.hash
    tab.value = ['#review', '#statistics'].includes(hash) ? hash.slice(1) : 'library'
    if (hash === '#collection' || hash.startsWith('#collection/')) {
        inCollection.value = true
        const targetId = hash.slice('#collection/'.length)
        activeCollection.value = targetId || sortedCollections.value[0]?.id || defaultCollectionId
    } else {
        inCollection.value = false
    }
    selected.value = ''
    detailLoading.value = ''
    selectionGeneration++
}

const selected = ref('')
const selectedWord = computed(() => words.value.find((word) => word.key === selected.value))
const encounters = ref<Encounter[]>([])
const error = ref('')
const modalError = ref('')
const status = ref('')
const pageSize = 25
const currentPage = ref(1)
const ratingPending = ref(new Set<string>())
const details = ref(new Map<string, Operations['wordDetails']['output'][number]>())
const detailLoading = ref('')
let selectionGeneration = 0
let refreshGeneration = 0

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

const filtered = computed(() => {
    const normalizedQuery = normalizeWord(query.value)
    const rawLower = query.value.trim().toLowerCase()
    return collectionWords.value
        .filter((word) => {
            const matchesQuery =
                !rawLower ||
                word.key.includes(normalizedQuery) ||
                meaningFor(word).toLowerCase().includes(rawLower)
            const matchesState =
                filter.value === 'all' || word.state === filter.value || filter.value === ratingValue(word)
            return matchesQuery && matchesState
        })
        .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
})

const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const page = computed(() => Math.min(currentPage.value, pages.value))
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

watch([query, filter, currentCollectionId], () => {
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

let unsubscribe: (() => void) | undefined

async function refresh() {
    const generation = ++refreshGeneration
    try {
        const [wordList, collectionList] = await Promise.all([request('words'), request('collections')])
        if (generation !== refreshGeneration) return
        words.value = wordList
        collections.value = collectionList
        if (
            inCollection.value &&
            !collectionList.some((collection) => collection.id === activeCollection.value)
        ) {
            activeCollection.value = collectionList[0]?.id ?? defaultCollectionId
        }
    } catch (reason) {
        if (generation === refreshGeneration) error.value = errorMessage(reason)
    }
}

function openCollection(id: string) {
    activeCollection.value = id
    location.hash = `collection/${id}`
}

function openCreateCollection() {
    editingCollectionId.value = undefined
    collectionForm.language = 'ja'
    collectionForm.name = ''
    collectionForm.description = ''
    collectionForm.pinned = false
    modalError.value = ''
    collectionModalOpen.value = true
}

function openEditCollection(collection: VocabularyCollection) {
    editingCollectionId.value = collection.id
    collectionForm.language = collection.language
    collectionForm.name = collection.name
    collectionForm.description = collection.description
    collectionForm.pinned = collection.pinned
    modalError.value = ''
    collectionModalOpen.value = true
}

async function submitCollection() {
    if (collectionSaving.value) return
    collectionSaving.value = true
    modalError.value = ''
    try {
        await request('saveCollection', {
            id: editingCollectionId.value,
            language: collectionForm.language,
            name: collectionForm.name,
            description: collectionForm.description,
            pinned: collectionForm.pinned,
        })
        collectionModalOpen.value = false
        await refresh()
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        collectionSaving.value = false
    }
}

async function togglePin(collection: VocabularyCollection) {
    if (pinPending.value.has(collection.id)) return
    pinPending.value.add(collection.id)
    error.value = ''
    try {
        await request('toggleCollectionPin', collection.id)
        await refresh()
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        pinPending.value.delete(collection.id)
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

async function rate(word: Word, rating: WordRating) {
    if (ratingPending.value.has(word.key)) return
    ratingPending.value.add(word.key)
    error.value = ''
    try {
        await request('saveWord', {
            text: word.text,
            ...rating,
            collectionId: wordCollectionId(word),
        })
        await refresh()
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        ratingPending.value.delete(word.key)
    }
}

function openAddWord() {
    newWord.value = ''
    newMeaning.value = ''
    modalError.value = ''
    adding.value = true
}

async function addWords(state: WordState) {
    const text = newWord.value.trim()
    if (!text) return
    modalError.value = ''
    try {
        const meaning = newMeaning.value.trim()
        await request('saveWord', {
            text,
            state,
            collectionId: currentCollectionId.value,
            meaning: meaning || undefined,
        })
        newWord.value = ''
        newMeaning.value = ''
        adding.value = false
        location.hash = `collection/${currentCollectionId.value}`
        await refresh()
    } catch (reason) {
        modalError.value = errorMessage(reason)
    }
}

function openEditWord(word: Word) {
    editingWord.value = word
    editText.value = word.text
    editMeaning.value = word.meaning ?? ''
    editRating.value =
        word.state === 'learning' ? { state: 'learning', level: word.level ?? 1 } : { state: word.state }
    modalError.value = ''
}

async function submitEditWord() {
    if (!editingWord.value || wordSubmitting.value) return
    wordSubmitting.value = true
    modalError.value = ''
    try {
        await request('updateWord', {
            originalKey: editingWord.value.key,
            text: editText.value,
            meaning: editMeaning.value.trim(),
            ...editRating.value,
            collectionId: wordCollectionId(editingWord.value),
        })
        editingWord.value = undefined
        await refresh()
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        wordSubmitting.value = false
    }
}

async function removeEditingWord() {
    if (!editingWord.value || wordSubmitting.value) return
    wordSubmitting.value = true
    modalError.value = ''
    try {
        await request('deleteWord', editingWord.value.key)
        editingWord.value = undefined
        await refresh()
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        wordSubmitting.value = false
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
    const sourceWords = inCollection.value ? collectionWords.value : words.value
    download(
        '\uFEFFword,state,level,meaning\r\n' +
            sourceWords
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
        const targetCollection = inCollection.value ? currentCollectionId.value : undefined
        const count = await request(
            'import',
            file.name.toLowerCase().endsWith('.csv')
                ? parseWordCsv(text, targetCollection)
                : JSON.parse(text),
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
        <template #header>
            <template v-if="tab === 'library'">
                <div v-if="inCollection" class="header-breadcrumb">
                    <a href="#library">{{ t('common.library') }}</a>
                    <span>/</span>
                    <span v-if="currentCollection" class="flag-pill compact">
                        <LanguageFlag :language="currentCollection.language" :size="14" />
                        {{ languageInfo(currentCollection.language).label }}
                    </span>
                    <h1>{{ currentCollection?.name ?? t('library.collection') }}</h1>
                </div>
                <div v-else class="header-title-group">
                    <h1>{{ t('common.library') }}</h1>
                </div>
                <a v-if="inCollection" class="button-link" href="#library">
                    <ChevronLeft :size="15" />
                    {{ t('library.back') }}
                </a>
                <a v-else class="button-link" href="reader.html">
                    <BookOpen :size="15" />
                    {{ t('library.continueReading') }}
                </a>
            </template>
            <template v-else-if="tab === 'review'">
                <h1>{{ t('common.review') }}</h1>
            </template>
            <template v-else>
                <h1>{{ t('common.statistics') }}</h1>
            </template>
        </template>

        <template v-if="tab === 'library'">
            <div v-if="!inCollection" class="page-heading">
                <p>{{ t('library.collectionsIntro') }}</p>
            </div>
            <div v-else-if="currentCollection" class="page-heading">
                <p>
                    <template v-if="currentCollection.description">
                        {{ currentCollection.description }} ·
                    </template>
                    {{ t('library.totalItems', { count: collectionWords.length.toLocaleString() }) }}
                </p>
            </div>

            <div class="library-toolbar">
                <button v-if="!inCollection" type="button" class="primary" @click="openCreateCollection">
                    <Plus :size="16" />
                    {{ t('library.addCollection') }}
                </button>
                <button v-else type="button" class="primary" @click="openAddWord">
                    <Plus :size="16" />
                    {{ t('library.addWord') }}
                </button>

                <div v-if="!inCollection" class="toolbar-controls">
                    <button type="button" @click="backup">
                        <Download :size="14" />
                        {{ t('library.jsonBackup') }}
                    </button>
                    <button type="button" @click="csv">
                        <Download :size="14" />
                        {{ t('library.csvWords') }}
                    </button>
                    <label class="import-button">
                        <input type="file" accept=".json,.csv" style="display: none" @change="restore" />
                        <Upload :size="14" />
                        {{ t('library.import') }}
                    </label>
                </div>

                <div v-else class="toolbar-controls">
                    <ShadcnSelect
                        v-model="filter"
                        :options="filterOptions"
                        :aria-label="t('library.filter')"
                    />
                    <div class="search-field">
                        <Search :size="15" />
                        <input
                            v-model="query"
                            :placeholder="t('library.searchPlaceholder')"
                            :aria-label="t('library.search')"
                        />
                    </div>
                </div>
            </div>

            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <p v-if="status" class="success" role="status">{{ status }}</p>

            <div v-if="!inCollection" class="collections-grid">
                <article
                    v-for="item in collectionSummaries"
                    :key="item.collection.id"
                    class="collection-card"
                    :class="{ 'is-pinned': item.collection.pinned }"
                >
                    <button
                        type="button"
                        class="collection-card-hit"
                        :aria-label="t('library.openCollectionCard', { name: item.collection.name })"
                        @click="openCollection(item.collection.id)"
                    />
                    <div class="collection-top">
                        <span class="flag-pill" :title="`${item.language.flagEmoji} ${item.language.label}`">
                            <LanguageFlag :language="item.collection.language" :size="18" />
                            <span>{{ item.language.label }} · {{ item.language.nativeName }}</span>
                        </span>
                        <div class="card-actions-group">
                            <button
                                type="button"
                                class="icon-button"
                                :aria-label="t('library.editCollection')"
                                :title="t('library.editCollection')"
                                @click="openEditCollection(item.collection)"
                            >
                                <Pencil :size="14" />
                            </button>
                            <button
                                type="button"
                                class="icon-button pin-button"
                                :class="{ pinned: item.collection.pinned }"
                                :aria-pressed="item.collection.pinned"
                                :aria-label="
                                    item.collection.pinned
                                        ? t('library.unpinCollection')
                                        : t('library.pinCollection')
                                "
                                :title="
                                    item.collection.pinned
                                        ? t('library.unpinCollection')
                                        : t('library.pinCollection')
                                "
                                :disabled="pinPending.has(item.collection.id)"
                                @click="togglePin(item.collection)"
                            >
                                <Pin :size="14" />
                            </button>
                        </div>
                    </div>

                    <div class="collection-title-block">
                        <h2>{{ item.collection.name }}</h2>
                        <p>{{ item.collection.description || item.language.nativeName }}</p>
                    </div>

                    <div class="collection-progress-block">
                        <div class="collection-bottom">
                            <span>
                                <strong>{{ item.words.length.toLocaleString() }}</strong>
                                {{ t('library.wordCountLabel') }}
                            </span>
                            <span>{{ t('library.knownPercent', { percent: item.progress }) }}</span>
                        </div>
                        <div class="progress-track">
                            <span :style="{ width: item.progress + '%' }"></span>
                            <span
                                class="progress-learning"
                                :style="{ width: item.learningPercent + '%' }"
                            ></span>
                        </div>
                    </div>

                    <div class="state-counts">
                        <span>
                            <i class="status-dot dot-learning"></i>
                            <b>{{ item.learning }}</b>
                            {{ t('common.learning') }}
                        </span>
                        <span>
                            <i class="status-dot dot-known"></i>
                            <b>{{ item.known }}</b>
                            {{ t('common.known') }}
                        </span>
                        <span>
                            <i class="status-dot dot-ignored"></i>
                            <b>{{ item.ignored }}</b>
                            {{ t('common.ignored') }}
                        </span>
                    </div>
                </article>
            </div>

            <section v-else class="word-table-card">
                <div v-if="!collectionWords.length" class="empty">
                    <div class="empty-icon"><BookOpen :size="26" /></div>
                    <h2>{{ t('library.firstWord') }}</h2>
                    <p>{{ t('library.getStarted') }}</p>
                    <a class="button-link" href="reader.html">
                        {{ t('library.openPdf') }}
                        <ArrowUpRight :size="15" />
                    </a>
                </div>
                <template v-else>
                    <div class="word-table-scroll">
                        <table class="word-table">
                            <thead>
                                <tr>
                                    <th>{{ t('library.tableTerm') }}</th>
                                    <th>{{ t('library.tableMeaning') }}</th>
                                    <th>{{ t('library.tableRating') }}</th>
                                    <th style="text-align: right">{{ t('library.tableActions') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="word in rows" :key="word.key">
                                    <td>
                                        <div class="collection-term">
                                            <button
                                                type="button"
                                                class="quiet"
                                                :disabled="detailLoading === word.key"
                                                @click="choose(word)"
                                            >
                                                <strong>{{ word.text }}</strong>
                                            </button>
                                            <p
                                                v-if="details.get(word.key)?.encounter?.context"
                                                class="muted small"
                                            >
                                                {{ details.get(word.key)?.encounter?.context }}
                                            </p>
                                        </div>
                                    </td>
                                    <td>
                                        <p v-if="meaningFor(word)" class="collection-meaning">
                                            {{ meaningFor(word) }}
                                        </p>
                                        <span v-else class="muted small">-</span>
                                    </td>
                                    <td>
                                        <WordRatingControls
                                            :word="word.text"
                                            :rating="word"
                                            :busy="ratingPending.has(word.key)"
                                            @rate="rate(word, $event)"
                                        />
                                    </td>
                                    <td style="text-align: right">
                                        <button
                                            type="button"
                                            class="icon-button"
                                            :aria-label="t('library.editWordLabel', { word: word.text })"
                                            :title="t('library.editWord')"
                                            @click="openEditWord(word)"
                                        >
                                            <Pencil :size="14" />
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p v-if="!filtered.length" class="empty-filter muted small">
                        {{ t('library.noResults') }}
                    </p>
                    <div class="table-footer">
                        <span>
                            {{ t('library.totalItems', { count: filtered.length.toLocaleString() }) }}
                        </span>
                        <nav
                            v-if="pages > 1"
                            class="row collection-pages"
                            :aria-label="t('library.pagination')"
                        >
                            <button type="button" :disabled="page <= 1" @click="currentPage = page - 1">
                                {{ t('common.previousPage') }}
                            </button>
                            <span>{{ t('library.pageNumber', { page, pages }) }}</span>
                            <button type="button" :disabled="page >= pages" @click="currentPage = page + 1">
                                {{ t('common.nextPage') }}
                            </button>
                        </nav>
                    </div>
                </template>
            </section>
        </template>

        <VocabularyReview
            v-else-if="tab === 'review'"
            :words="words"
            :collections="sortedCollections"
            @saved="refresh"
        />
        <VocabularyStatistics v-else :words="words" />

        <div v-if="collectionModalOpen" class="modal-backdrop" @click.self="collectionModalOpen = false">
            <form class="modal" @submit.prevent="submitCollection">
                <div class="row between" style="margin-top: 0">
                    <h2>
                        {{ editingCollectionId ? t('library.editCollection') : t('library.addCollection') }}
                    </h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('library.closeCollectionModal')"
                        @click="collectionModalOpen = false"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <div class="field-block">
                    <span class="field-caption">{{ t('library.collectionLanguage') }}</span>
                    <div class="language-grid">
                        <button
                            v-for="option in languageOptions"
                            :key="option.code"
                            type="button"
                            class="language-option"
                            :class="{ selected: collectionForm.language === option.code }"
                            :aria-pressed="collectionForm.language === option.code"
                            @click="collectionForm.language = option.code"
                        >
                            <LanguageFlag :language="option.code" :size="16" />
                            <span>{{ option.label }}</span>
                        </button>
                    </div>
                </div>
                <label class="field">
                    <span>{{ t('library.collectionName') }}</span>
                    <input
                        v-model="collectionForm.name"
                        required
                        maxlength="80"
                        :placeholder="t('library.collectionNamePlaceholder')"
                        autofocus
                    />
                </label>
                <label class="field">
                    <span>{{ t('library.collectionDescription') }}</span>
                    <input
                        v-model="collectionForm.description"
                        maxlength="300"
                        :placeholder="t('library.collectionDescriptionPlaceholder')"
                    />
                </label>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer">
                    <button type="button" @click="collectionModalOpen = false">
                        {{ t('common.cancel') }}
                    </button>
                    <button class="primary" type="submit" :disabled="collectionSaving">
                        {{ t('library.saveCollection') }}
                    </button>
                </div>
            </form>
        </div>

        <div v-if="adding" class="modal-backdrop" @click.self="adding = false">
            <form class="modal" @submit.prevent="addWords('learning')">
                <div class="row between" style="margin-top: 0">
                    <h2>{{ t('library.addWord') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('library.closeAddWord')"
                        @click="adding = false"
                    >
                        <X :size="18" />
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
                <label class="field">
                    <span>{{ t('library.meaningLabel') }}</span>
                    <input
                        v-model="newMeaning"
                        maxlength="300"
                        :placeholder="t('library.meaningPlaceholder')"
                    />
                </label>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer">
                    <button type="button" @click="addWords('known')">{{ t('library.markKnown') }}</button>
                    <button class="primary" type="submit">{{ t('library.addLearning') }}</button>
                </div>
            </form>
        </div>

        <div v-if="editingWord" class="modal-backdrop" @click.self="editingWord = undefined">
            <form class="modal" @submit.prevent="submitEditWord">
                <div class="row between" style="margin-top: 0">
                    <h2>{{ t('library.editWord') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('library.closeEditWord')"
                        @click="editingWord = undefined"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <label class="field">
                    <span>{{ t('library.wordOrPhrase') }}</span>
                    <input v-model="editText" required maxlength="200" autofocus />
                </label>
                <label class="field">
                    <span>{{ t('library.meaningLabel') }}</span>
                    <input
                        v-model="editMeaning"
                        maxlength="300"
                        :placeholder="t('library.meaningEditPlaceholder')"
                    />
                </label>
                <div class="field-block">
                    <span class="field-caption">{{ t('library.ratingLabel') }}</span>
                    <WordRatingControls
                        :word="editText || editingWord.text"
                        :rating="editRating"
                        :busy="wordSubmitting"
                        @rate="editRating = $event"
                    />
                </div>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer between">
                    <button
                        type="button"
                        class="destructive"
                        :disabled="wordSubmitting"
                        @click="removeEditingWord"
                    >
                        <Trash2 :size="14" />
                        {{ t('library.deleteWord') }}
                    </button>
                    <div class="row" style="margin: 0">
                        <button type="button" @click="editingWord = undefined">
                            {{ t('common.cancel') }}
                        </button>
                        <button class="primary" type="submit" :disabled="wordSubmitting">
                            {{ t('library.saveChanges') }}
                        </button>
                    </div>
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
    border-radius: 12px;
    border: 1px solid var(--line);
    background: #ffffff;
}
.word-detail :deep(.word-card) {
    border: 0;
    box-shadow: none;
}
.encounter-list {
    padding: 0 20px 18px;
    font-size: 13px;
}
.empty-filter {
    padding: 16px;
    margin: 0;
}
.field-block {
    margin: 14px 0;
}
.field-caption {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--ink);
}
</style>
