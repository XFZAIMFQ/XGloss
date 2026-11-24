<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { browser } from 'wxt/browser'
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
    RefreshCw,
} from '@lucide/vue'
import { parseWordCsv } from '../../domain/csv'
import {
    languageInfo,
    languageOptions,
    sortCollections,
    sortWords,
    wordCollectionId,
} from '../../domain/collections'
import { learningLevelLabel, normalizeWord } from '../../domain/vocabulary'
import { buildEncounterHighlightUrl } from '../../domain/text-fragment'
import {
    defaultCollectionId,
    errorMessage,
    learningLevels,
    wordbookMasteredActionSchema,
    type CollectionLanguage,
    type CollectionWordbook,
    type DeleteCollectionMode,
    type Encounter,
    type VocabularyCollection,
    type Word,
    type WordRating,
    type WordSort,
    type WordSource,
    type WordState,
    type WordbookCategory,
    type WordbookMasteredAction,
    type WordbookProfileSummary,
} from '../../domain/models'
import { wordbookOrigin } from '../../services/wordbook-sync'
import { onVocabularyChanged, request, type Operations } from '../../platform/messages'

const words = ref<Word[]>([])
const collections = ref<VocabularyCollection[]>([])
const wordbookProfiles = ref<WordbookProfileSummary[]>([])
const wordbookCategories = ref<WordbookCategory[]>([])
const loadingWordbookCategories = ref(false)
const syncingWordbookId = ref('')
const wordbookSyncPrompt = ref<{
    collectionId: string
    collectionName: string
    categoryName: string
    learningCount: number
}>()
const masteredActionOptions: readonly SelectOption[] = [
    { value: 'keep', label: t('library.wordbookMasteredKeep') },
    { value: 'remove', label: t('library.wordbookMasteredRemove') },
]
const query = ref('')
const filter = ref('all')
const sortBy = ref<WordSort>('updated-desc')
const filterOptions: readonly SelectOption[] = [
    { value: 'all', label: t('library.allStates') },
    { value: 'learning', label: t('common.learning') },
    ...learningLevels.map((level) => ({
        value: `level-${level}`,
        label: learningLevelLabel(level),
    })),
    { value: 'known', label: t('common.known') },
    { value: 'ignored', label: t('common.ignored') },
]
const sortOptions: readonly SelectOption[] = [
    { value: 'updated-desc', label: t('library.sortUpdatedDesc') },
    { value: 'updated-asc', label: t('library.sortUpdatedAsc') },
    { value: 'alpha-asc', label: t('library.sortAlphaAsc') },
    { value: 'alpha-desc', label: t('library.sortAlphaDesc') },
    { value: 'level-asc', label: t('library.sortLevelAsc') },
    { value: 'level-desc', label: t('library.sortLevelDesc') },
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
    wordbookProfileId: string
    wordbookCategoryId: string
    wordbookCategoryName: string
    wordbookAutoSync: boolean
    wordbookOnMastered: WordbookMasteredAction
}>({
    language: 'en',
    name: '',
    description: '',
    pinned: false,
    wordbookProfileId: '',
    wordbookCategoryId: '',
    wordbookCategoryName: '',
    wordbookAutoSync: false,
    wordbookOnMastered: 'keep',
})
const collectionSaving = ref(false)
const pinPending = ref(new Set<string>())
const deletingCollection = ref<VocabularyCollection>()
const deleteCollectionMode = ref<DeleteCollectionMode>('move')
const deleteTargetCollectionId = ref('')
const collectionDeleting = ref(false)
const selectedKeys = ref<Set<string>>(new Set())
const bulkDeleteOpen = ref(false)
const bulkDeleting = ref(false)
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
const deletingCollectionWordCount = computed(() => {
    const target = deletingCollection.value
    if (!target) return 0
    return words.value.filter((word) => wordCollectionId(word) === target.id).length
})
const editingCollection = computed(() =>
    collections.value.find((collection) => collection.id === editingCollectionId.value),
)
const wordbookProfileOptions = computed<SelectOption[]>(() => [
    { value: '', label: t('library.wordbookNone') },
    ...wordbookProfiles.value.map((profile) => ({
        value: profile.id,
        label: `${profile.name} (${profile.type === 'maimemo' ? t('wordbook.maimemo') : t('wordbook.eudic')})`,
    })),
])
const wordbookCategoryOptions = computed<SelectOption[]>(() => {
    const items = wordbookCategories.value.map((category) => ({
        value: category.id,
        label: category.name,
    }))
    if (
        collectionForm.wordbookCategoryId &&
        !items.some((item) => item.value === collectionForm.wordbookCategoryId)
    ) {
        items.unshift({
            value: collectionForm.wordbookCategoryId,
            label: collectionForm.wordbookCategoryName || collectionForm.wordbookCategoryId,
        })
    }
    return items
})
const currentCollectionHasWordbook = computed(() => {
    const binding = currentCollection.value?.wordbook
    if (!binding) return false
    return wordbookProfiles.value.some((profile) => profile.id === binding.profileId)
})
const deleteTargetOptions = computed<SelectOption[]>(() => {
    const deletingId = deletingCollection.value?.id
    return sortedCollections.value
        .filter((collection) => collection.id !== deletingId)
        .map((collection) => ({
            value: collection.id,
            label: `${collection.name} (${languageInfo(collection.language).label})`,
        }))
})

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
const fallbackLibrarySource: WordSource = { title: t('common.localLibrary'), url: '', context: '' }
const selectedSource = computed<WordSource>(() => encounters.value[0] ?? fallbackLibrarySource)
const error = ref('')
const modalError = ref('')
const status = ref('')
const pageSize = 25
const currentPage = ref(1)
const ratingPending = ref(new Set<string>())
const details = ref(new Map<string, Operations['wordDetails']['output'][number]>())
const detailsRevision = ref(0)
const detailLoading = ref('')
let selectionGeneration = 0
let refreshGeneration = 0

function ratingValue(word: Word) {
    return word.state === 'learning' ? `level-${word.level ?? 1}` : word.state
}

function meaningFor(word: Word) {
    return word.meaning ?? details.value.get(word.key)?.encounter?.meaning ?? ''
}

const filtered = computed(() => {
    const normalizedQuery = normalizeWord(query.value)
    const rawLower = query.value.trim().toLowerCase()
    const matched = collectionWords.value.filter((word) => {
        const matchesQuery =
            !rawLower ||
            word.key.includes(normalizedQuery) ||
            meaningFor(word).toLowerCase().includes(rawLower)
        const matchesState =
            filter.value === 'all' || word.state === filter.value || filter.value === ratingValue(word)
        return matchesQuery && matchesState
    })
    return sortWords(matched, sortBy.value)
})

const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const page = computed(() => Math.min(currentPage.value, pages.value))
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const rowKeysSignature = computed(() => rows.value.map((word) => word.key).join('\0'))
const allPageSelected = computed(
    () => rows.value.length > 0 && rows.value.every((word) => selectedKeys.value.has(word.key)),
)
const somePageSelected = computed(
    () => rows.value.some((word) => selectedKeys.value.has(word.key)) && !allPageSelected.value,
)

watch([query, filter, sortBy, currentCollectionId], () => {
    currentPage.value = 1
})

watch([query, filter, currentCollectionId, inCollection], () => {
    if (selectedKeys.value.size > 0) selectedKeys.value = new Set()
})

watch(currentCollectionId, () => {
    details.value = new Map()
})

watch([rowKeysSignature, inCollection, detailsRevision], async ([signature, open], _previous, onCleanup) => {
    let stale = false
    onCleanup(() => {
        stale = true
    })
    if (!signature || !open) return
    const keys = signature.split('\0')
    try {
        const result = await request('wordDetails', keys)
        if (!stale) {
            const next = new Map(details.value)
            for (const detail of result) next.set(detail.key, detail)
            details.value = next
        }
    } catch (reason) {
        if (!stale) error.value = errorMessage(reason)
    }
})

let unsubscribe: (() => void) | undefined

async function refresh() {
    const generation = ++refreshGeneration
    try {
        const [wordList, collectionList, profileList] = await Promise.all([
            request('words'),
            request('collections'),
            request('wordbookProfileSummaries'),
        ])
        if (generation !== refreshGeneration) return
        words.value = wordList
        collections.value = collectionList
        wordbookProfiles.value = profileList
        detailsRevision.value++
        if (selectedKeys.value.size > 0) {
            const existingKeys = new Set(wordList.map((word) => word.key))
            const next = new Set([...selectedKeys.value].filter((key) => existingKeys.has(key)))
            if (next.size !== selectedKeys.value.size) selectedKeys.value = next
        }
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
    collectionForm.wordbookProfileId = ''
    collectionForm.wordbookCategoryId = ''
    collectionForm.wordbookCategoryName = ''
    collectionForm.wordbookAutoSync = false
    collectionForm.wordbookOnMastered = 'keep'
    wordbookCategories.value = []
    modalError.value = ''
    collectionModalOpen.value = true
}

function openEditCollection(collection: VocabularyCollection) {
    editingCollectionId.value = collection.id
    collectionForm.language = collection.language
    collectionForm.name = collection.name
    collectionForm.description = collection.description
    collectionForm.pinned = collection.pinned
    const validBinding =
        collection.wordbook &&
        wordbookProfiles.value.some((profile) => profile.id === collection.wordbook?.profileId)
            ? collection.wordbook
            : undefined
    collectionForm.wordbookProfileId = validBinding?.profileId ?? ''
    collectionForm.wordbookCategoryId = validBinding?.categoryId ?? ''
    collectionForm.wordbookCategoryName = validBinding?.categoryName ?? ''
    collectionForm.wordbookAutoSync = validBinding?.autoSync ?? false
    collectionForm.wordbookOnMastered = validBinding?.onMastered ?? 'keep'
    wordbookCategories.value = validBinding
        ? [{ id: validBinding.categoryId, name: validBinding.categoryName || validBinding.categoryId }]
        : []
    modalError.value = ''
    collectionModalOpen.value = true
}

async function ensureWordbookPermission(profileId: string): Promise<boolean> {
    const profile = wordbookProfiles.value.find((item) => item.id === profileId)
    if (!profile) throw new Error(t('wordbook.profileNotFound'))
    return browser.permissions.request({ origins: [`${wordbookOrigin(profile.type)}/*`] })
}

async function loadWordbookCategoriesForForm() {
    if (!collectionForm.wordbookProfileId || loadingWordbookCategories.value) return
    loadingWordbookCategories.value = true
    modalError.value = ''
    try {
        const allowed = await ensureWordbookPermission(collectionForm.wordbookProfileId)
        if (!allowed) throw new Error(t('library.wordbookPermissionRequired'))
        const categories = await request('wordbookCategories', {
            profileId: collectionForm.wordbookProfileId,
            language: collectionForm.language,
        })
        wordbookCategories.value = categories
        if (categories.length) {
            const matched = categories.find((item) => item.id === collectionForm.wordbookCategoryId)
            const chosen = matched ?? categories[0]!
            collectionForm.wordbookCategoryId = chosen.id
            collectionForm.wordbookCategoryName = chosen.name
        }
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        loadingWordbookCategories.value = false
    }
}

function handleWordbookProfileChange(profileId: string) {
    collectionForm.wordbookProfileId = profileId
    collectionForm.wordbookCategoryId = ''
    collectionForm.wordbookCategoryName = ''
    wordbookCategories.value = []
    if (profileId) void loadWordbookCategoriesForForm()
}

function handleWordbookCategoryChange(categoryId: string) {
    collectionForm.wordbookCategoryId = categoryId
    const matched = wordbookCategories.value.find((item) => item.id === categoryId)
    collectionForm.wordbookCategoryName = matched?.name ?? categoryId
}

function handleWordbookMasteredChange(next: string) {
    collectionForm.wordbookOnMastered = wordbookMasteredActionSchema.parse(next)
}

async function runManualWordbookSync(collectionId: string) {
    if (syncingWordbookId.value) return
    const collection = collections.value.find((item) => item.id === collectionId)
    const binding = collection?.wordbook
    if (!collection || !binding) return
    syncingWordbookId.value = collectionId
    error.value = ''
    status.value = ''
    try {
        const allowed = await ensureWordbookPermission(binding.profileId)
        if (!allowed) throw new Error(t('library.wordbookPermissionRequired'))
        const result = await request('syncCollectionWordbook', collectionId)
        status.value =
            result.syncedCount > 0
                ? t('library.wordbookSyncDone', {
                      count: result.syncedCount,
                      category: result.categoryName,
                  })
                : t('library.wordbookSyncEmpty')
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        syncingWordbookId.value = ''
    }
}

async function confirmPromptedWordbookSync() {
    const prompt = wordbookSyncPrompt.value
    if (!prompt) return
    wordbookSyncPrompt.value = undefined
    await runManualWordbookSync(prompt.collectionId)
}

async function submitCollection() {
    if (collectionSaving.value) return
    collectionSaving.value = true
    modalError.value = ''
    try {
        const previousBinding = editingCollection.value?.wordbook
        let wordbook: CollectionWordbook | null = null
        if (collectionForm.wordbookProfileId) {
            if (!collectionForm.wordbookCategoryId) {
                throw new Error(t('library.wordbookCategoryRequired'))
            }
            const allowed = await ensureWordbookPermission(collectionForm.wordbookProfileId)
            if (!allowed) throw new Error(t('library.wordbookPermissionRequired'))
            wordbook = {
                profileId: collectionForm.wordbookProfileId,
                categoryId: collectionForm.wordbookCategoryId,
                categoryName: collectionForm.wordbookCategoryName || collectionForm.wordbookCategoryId,
                autoSync: collectionForm.wordbookAutoSync,
                onMastered: collectionForm.wordbookOnMastered,
            }
        }
        const saved = await request('saveCollection', {
            id: editingCollectionId.value,
            language: collectionForm.language,
            name: collectionForm.name,
            description: collectionForm.description,
            pinned: collectionForm.pinned,
            wordbook,
        })
        collectionModalOpen.value = false
        await refresh()
        const bindingChanged =
            Boolean(wordbook) &&
            (previousBinding?.profileId !== wordbook?.profileId ||
                previousBinding?.categoryId !== wordbook?.categoryId)
        if (bindingChanged && wordbook) {
            const learningCount = words.value.filter(
                (word) => wordCollectionId(word) === saved.id && word.state === 'learning',
            ).length
            if (learningCount > 0) {
                wordbookSyncPrompt.value = {
                    collectionId: saved.id,
                    collectionName: saved.name,
                    categoryName: wordbook.categoryName || wordbook.categoryId,
                    learningCount,
                }
            }
        }
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

function openDeleteCollection(collection: VocabularyCollection) {
    if (collections.value.length <= 1) {
        modalError.value = t('library.cannotDeleteLastCollection')
        return
    }
    collectionModalOpen.value = false
    deletingCollection.value = collection
    deleteCollectionMode.value = 'move'
    const fallback = sortedCollections.value.find((item) => item.id !== collection.id)
    deleteTargetCollectionId.value = fallback?.id ?? ''
    modalError.value = ''
}

async function confirmDeleteCollection() {
    const target = deletingCollection.value
    if (!target || collectionDeleting.value) return
    collectionDeleting.value = true
    modalError.value = ''
    try {
        const mode: DeleteCollectionMode =
            deletingCollectionWordCount.value > 0 ? deleteCollectionMode.value : 'delete'
        const result = await request('deleteCollection', {
            id: target.id,
            mode,
            targetCollectionId: mode === 'move' ? deleteTargetCollectionId.value || undefined : undefined,
        })
        deletingCollection.value = undefined
        if (inCollection.value && activeCollection.value === target.id) {
            location.hash = 'library'
        }
        if (mode === 'move' && result.movedWords > 0) {
            status.value = t('library.collectionDeletedMoved', {
                name: target.name,
                count: result.movedWords,
            })
        } else if (mode === 'delete' && result.deletedWords > 0) {
            status.value = t('library.collectionDeletedWithWords', {
                name: target.name,
                count: result.deletedWords,
            })
        } else {
            status.value = t('library.collectionDeleted', { name: target.name })
        }
        error.value = ''
        await refresh()
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        collectionDeleting.value = false
    }
}

function toggleSelectWord(key: string) {
    const next = new Set(selectedKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedKeys.value = next
}

function toggleSelectAllPage() {
    const next = new Set(selectedKeys.value)
    if (allPageSelected.value) {
        for (const word of rows.value) next.delete(word.key)
    } else {
        for (const word of rows.value) next.add(word.key)
    }
    selectedKeys.value = next
}

function clearSelection() {
    selectedKeys.value = new Set()
}

function openBulkDelete() {
    modalError.value = ''
    bulkDeleteOpen.value = true
}

async function confirmBulkDelete() {
    if (!selectedKeys.value.size || bulkDeleting.value) return
    bulkDeleting.value = true
    modalError.value = ''
    try {
        const keys = [...selectedKeys.value]
        const deleted = await request('deleteWords', keys)
        bulkDeleteOpen.value = false
        selectedKeys.value = new Set()
        if (selected.value && keys.includes(selected.value)) selected.value = ''
        status.value = t('library.bulkDeleted', { count: deleted })
        error.value = ''
        await refresh()
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        bulkDeleting.value = false
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

function encounterUrl(encounter: Encounter, wordText: string) {
    return buildEncounterHighlightUrl(encounter.url, wordText, encounter.context, encounter.textFragment)
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
                <div v-else class="row" style="margin: 0">
                    <button type="button" class="primary" @click="openAddWord">
                        <Plus :size="16" />
                        {{ t('library.addWord') }}
                    </button>
                    <button
                        v-if="currentCollectionHasWordbook && currentCollection"
                        type="button"
                        :disabled="syncingWordbookId === currentCollection.id"
                        @click="runManualWordbookSync(currentCollection.id)"
                    >
                        <RefreshCw :size="14" />
                        {{
                            syncingWordbookId === currentCollection.id
                                ? t('library.wordbookSyncing')
                                : t('library.wordbookSyncNow')
                        }}
                    </button>
                </div>

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
                    <ShadcnSelect v-model="sortBy" :options="sortOptions" :aria-label="t('library.sort')" />
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
                    <div v-if="selectedKeys.size > 0" class="bulk-action-bar" role="region">
                        <span>{{ t('library.selectedCount', { count: selectedKeys.size }) }}</span>
                        <div class="bulk-actions">
                            <button type="button" @click="clearSelection">
                                {{ t('library.clearSelection') }}
                            </button>
                            <button type="button" class="destructive" @click="openBulkDelete">
                                <Trash2 :size="14" />
                                {{ t('library.bulkDelete') }}
                            </button>
                        </div>
                    </div>
                    <div class="word-table-scroll">
                        <table class="word-table">
                            <thead>
                                <tr>
                                    <th>{{ t('library.tableTerm') }}</th>
                                    <th>{{ t('library.tableMeaning') }}</th>
                                    <th>{{ t('library.tableRating') }}</th>
                                    <th style="text-align: right">{{ t('library.tableActions') }}</th>
                                    <th class="checkbox-col">
                                        <input
                                            type="checkbox"
                                            class="row-checkbox"
                                            :checked="allPageSelected"
                                            :indeterminate.prop="somePageSelected"
                                            :disabled="!rows.length"
                                            :aria-label="t('library.selectAllPage')"
                                            @change="toggleSelectAllPage"
                                        />
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="word in rows"
                                    :key="word.key"
                                    :class="{ 'is-selected': selectedKeys.has(word.key) }"
                                >
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
                                    <td class="checkbox-col">
                                        <input
                                            type="checkbox"
                                            class="row-checkbox"
                                            :checked="selectedKeys.has(word.key)"
                                            :aria-label="t('library.selectWord', { word: word.text })"
                                            @change="toggleSelectWord(word.key)"
                                        />
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
                <div class="wordbook-config-box">
                    <span class="field-caption">{{ t('library.wordbookHeading') }}</span>
                    <p v-if="!wordbookProfiles.length" class="muted small" style="margin: 4px 0 0">
                        {{ t('library.wordbookConfigureFirst') }}
                    </p>
                    <template v-else>
                        <div class="field" style="margin: 8px 0">
                            <span>{{ t('library.wordbookProfile') }}</span>
                            <ShadcnSelect
                                :model-value="collectionForm.wordbookProfileId"
                                :options="wordbookProfileOptions"
                                :aria-label="t('library.wordbookProfile')"
                                @update:model-value="handleWordbookProfileChange"
                            />
                        </div>
                        <template v-if="collectionForm.wordbookProfileId">
                            <div class="field" style="margin: 8px 0">
                                <span>{{ t('library.wordbookCategory') }}</span>
                                <div class="copy-row">
                                    <ShadcnSelect
                                        v-if="wordbookCategoryOptions.length"
                                        :model-value="collectionForm.wordbookCategoryId"
                                        :options="wordbookCategoryOptions"
                                        :aria-label="t('library.wordbookCategory')"
                                        @update:model-value="handleWordbookCategoryChange"
                                    />
                                    <span v-else class="muted small" style="flex: 1">
                                        {{ t('library.wordbookCategoryEmpty') }}
                                    </span>
                                    <button
                                        type="button"
                                        :disabled="loadingWordbookCategories"
                                        @click="loadWordbookCategoriesForForm"
                                    >
                                        <RefreshCw :size="13" />
                                        {{
                                            loadingWordbookCategories
                                                ? t('library.wordbookLoadingCategories')
                                                : t('library.wordbookLoadCategories')
                                        }}
                                    </button>
                                </div>
                            </div>
                            <label class="checkbox-field">
                                <input
                                    v-model="collectionForm.wordbookAutoSync"
                                    type="checkbox"
                                    class="row-checkbox"
                                />
                                <span>
                                    <strong>{{ t('library.wordbookAutoSync') }}</strong>
                                    <small class="muted">{{ t('library.wordbookAutoSyncHint') }}</small>
                                </span>
                            </label>
                            <div class="field" style="margin: 8px 0">
                                <span>{{ t('library.wordbookMasteredLabel') }}</span>
                                <ShadcnSelect
                                    :model-value="collectionForm.wordbookOnMastered"
                                    :options="masteredActionOptions"
                                    :aria-label="t('library.wordbookMasteredLabel')"
                                    @update:model-value="handleWordbookMasteredChange"
                                />
                            </div>
                            <div
                                v-if="
                                    editingCollection &&
                                    editingCollection.wordbook?.profileId ===
                                        collectionForm.wordbookProfileId &&
                                    editingCollection.wordbook?.categoryId ===
                                        collectionForm.wordbookCategoryId
                                "
                                style="margin-top: 8px"
                            >
                                <button
                                    type="button"
                                    :disabled="syncingWordbookId === editingCollection.id"
                                    @click="runManualWordbookSync(editingCollection.id)"
                                >
                                    <RefreshCw :size="13" />
                                    {{
                                        syncingWordbookId === editingCollection.id
                                            ? t('library.wordbookSyncing')
                                            : t('library.wordbookSyncNow')
                                    }}
                                </button>
                            </div>
                        </template>
                    </template>
                </div>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer" :class="{ between: editingCollection && collections.length > 1 }">
                    <button
                        v-if="editingCollection && collections.length > 1"
                        type="button"
                        class="destructive"
                        :disabled="collectionSaving"
                        @click="openDeleteCollection(editingCollection)"
                    >
                        <Trash2 :size="14" />
                        {{ t('library.deleteCollection') }}
                    </button>
                    <div class="row" style="margin: 0">
                        <button type="button" @click="collectionModalOpen = false">
                            {{ t('common.cancel') }}
                        </button>
                        <button class="primary" type="submit" :disabled="collectionSaving">
                            {{ t('library.saveCollection') }}
                        </button>
                    </div>
                </div>
            </form>
        </div>

        <div v-if="deletingCollection" class="modal-backdrop" @click.self="deletingCollection = undefined">
            <form class="modal" @submit.prevent="confirmDeleteCollection">
                <div class="row between" style="margin-top: 0">
                    <h2>{{ t('library.deleteCollectionTitle') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('library.closeDeleteCollectionModal')"
                        @click="deletingCollection = undefined"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <p class="muted small" style="margin: 12px 0">
                    {{
                        deletingCollectionWordCount > 0
                            ? t('library.collectionDeleteDesc', {
                                  name: deletingCollection.name,
                                  count: deletingCollectionWordCount,
                              })
                            : t('library.collectionDeleteEmptyDesc', { name: deletingCollection.name })
                    }}
                </p>
                <div v-if="deletingCollectionWordCount > 0" class="radio-card-list">
                    <label class="radio-card" :class="{ selected: deleteCollectionMode === 'move' }">
                        <input
                            v-model="deleteCollectionMode"
                            type="radio"
                            name="delete-collection-mode"
                            value="move"
                        />
                        <div class="radio-card-body">
                            <strong>{{ t('library.collectionDeleteModeMove') }}</strong>
                            <span class="muted small">
                                {{
                                    t('library.collectionDeleteModeMoveHint', {
                                        count: deletingCollectionWordCount,
                                    })
                                }}
                            </span>
                            <div v-if="deleteCollectionMode === 'move'" class="radio-card-extra">
                                <ShadcnSelect
                                    v-model="deleteTargetCollectionId"
                                    :options="deleteTargetOptions"
                                    :aria-label="t('library.collectionDeleteTarget')"
                                />
                            </div>
                        </div>
                    </label>
                    <label
                        class="radio-card is-danger"
                        :class="{ selected: deleteCollectionMode === 'delete' }"
                    >
                        <input
                            v-model="deleteCollectionMode"
                            type="radio"
                            name="delete-collection-mode"
                            value="delete"
                        />
                        <div class="radio-card-body">
                            <strong>{{ t('library.collectionDeleteModeDelete') }}</strong>
                            <span class="muted small">
                                {{
                                    t('library.collectionDeleteModeDeleteHint', {
                                        count: deletingCollectionWordCount,
                                    })
                                }}
                            </span>
                        </div>
                    </label>
                </div>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer">
                    <button type="button" @click="deletingCollection = undefined">
                        {{ t('common.cancel') }}
                    </button>
                    <button class="destructive" type="submit" :disabled="collectionDeleting">
                        <Trash2 :size="14" />
                        {{ t('library.confirmDelete') }}
                    </button>
                </div>
            </form>
        </div>

        <div v-if="bulkDeleteOpen" class="modal-backdrop" @click.self="bulkDeleteOpen = false">
            <form class="modal" @submit.prevent="confirmBulkDelete">
                <div class="row between" style="margin-top: 0">
                    <h2>{{ t('library.bulkDeleteTitle') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('common.cancel')"
                        @click="bulkDeleteOpen = false"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <p class="muted small" style="margin: 12px 0">
                    {{ t('library.bulkDeleteConfirm', { count: selectedKeys.size }) }}
                </p>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer">
                    <button type="button" @click="bulkDeleteOpen = false">
                        {{ t('common.cancel') }}
                    </button>
                    <button class="destructive" type="submit" :disabled="bulkDeleting">
                        <Trash2 :size="14" />
                        {{ t('library.confirmDelete') }}
                    </button>
                </div>
            </form>
        </div>

        <div v-if="wordbookSyncPrompt" class="modal-backdrop" @click.self="wordbookSyncPrompt = undefined">
            <div class="modal">
                <div class="row between" style="margin-top: 0">
                    <h2>{{ t('library.wordbookPromptTitle') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('library.wordbookPromptLater')"
                        @click="wordbookSyncPrompt = undefined"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <p class="muted small" style="margin: 12px 0">
                    {{
                        t('library.wordbookPromptMessage', {
                            name: wordbookSyncPrompt.collectionName,
                            category: wordbookSyncPrompt.categoryName,
                            count: wordbookSyncPrompt.learningCount,
                        })
                    }}
                </p>
                <div class="modal-footer">
                    <button type="button" @click="wordbookSyncPrompt = undefined">
                        {{ t('library.wordbookPromptLater') }}
                    </button>
                    <button type="button" class="primary" @click="confirmPromptedWordbookSync">
                        <RefreshCw :size="14" />
                        {{ t('library.wordbookPromptNow') }}
                    </button>
                </div>
            </div>
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
                    :source="selectedSource"
                    @saved="refresh"
                    @close="selected = ''"
                />
                <div v-if="encounters.length" class="encounter-list">
                    <h3>{{ t('library.encounters') }}</h3>
                    <div v-for="encounter in encounters" :key="encounter.id">
                        <a
                            v-if="encounterUrl(encounter, selectedWord.text)"
                            class="encounter-link"
                            :href="encounterUrl(encounter, selectedWord.text)"
                            target="_blank"
                            rel="noopener noreferrer"
                            :title="t('library.locateEncounter')"
                        >
                            <span>{{ encounter.title }}</span>
                            <ArrowUpRight :size="13" />
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
.encounter-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ink);
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: #d4d2e0;
    text-underline-offset: 3px;
}
.encounter-link:hover {
    color: var(--lime);
    text-decoration-color: var(--lime);
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
