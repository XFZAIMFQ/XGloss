<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import FloatingWordCard from '../../components/FloatingWordCard.vue'
import ReadingPanel from '../../components/ReadingPanel.vue'
import SelectionTriggerIcon from '../../components/SelectionTriggerIcon.vue'
import { normalizeWord } from '../../domain/vocabulary'
import { stripTextFragment } from '../../domain/text-fragment'
import { errorMessage, type SelectionTrigger, type Word, type WordSource } from '../../domain/models'
import { onReadingChanged, onVocabularyChanged, request } from '../../platform/messages'
import { PageAnalyzer } from './page-analyzer'
import { selectionAnchor } from '../reading/selection-anchor'
import { selectionContextWithFragment } from '../reading/selection-context'
import { useSpotlight } from '../reading/use-spotlight'

const words = shallowRef<Word[]>()
const counts = shallowRef(new Map<string, number>())
const status = ref(t('web.preparing'))
const selected = ref('')
const source = ref<WordSource>({ title: document.title, url: stripTextFragment(location.href), context: '' })
const anchor = shallowRef<HTMLElement | Range>()
const selectionTrigger = ref<SelectionTrigger>('auto')
const pendingSelection = shallowRef<{
    text: string
    anchor: Range
    context: string
    textFragment?: string
}>()
const sourceId = ref(location.pathname + location.search)
const rating = computed(() => words.value?.find((word) => word.key === normalizeWord(selected.value)))
let analyzer: PageAnalyzer
let unsubscribe: (() => void) | undefined
let unsubscribeReading: (() => void) | undefined
let refreshing = 0
const { highlighting, setSpotlight } = useSpotlight((enabled) => analyzer?.setHighlight(enabled))

async function reloadWords(): Promise<Word[]> {
    const generation = ++refreshing
    const result = await request('words')
    if (generation === refreshing) {
        words.value = result
        analyzer?.setWords(result)
    }
    return result
}
async function refresh() {
    try {
        await reloadWords()
    } catch (reason) {
        status.value = errorMessage(reason)
    }
}
function sourceForWord(word: string): WordSource {
    const snippet = analyzer?.sourceSnippetForWord(word)
    return {
        title: document.title.slice(0, 1000),
        url: stripTextFragment(location.href).slice(0, 8000),
        context: (snippet?.context ?? '').slice(0, 3000),
        textFragment: snippet?.textFragment,
    }
}
async function loadSelectionTrigger() {
    try {
        const next = await request('selectionTrigger')
        selectionTrigger.value = next
        if (next === 'off') pendingSelection.value = undefined
    } catch {
        selectionTrigger.value = 'auto'
    }
}
function select(text: string, position: HTMLElement | Range, context = '', textFragment?: string) {
    pendingSelection.value = undefined
    selected.value = text
    anchor.value = position
    const fallback =
        !context || !textFragment ? analyzer?.sourceSnippetForWord(normalizeWord(text)) : undefined
    source.value = {
        title: document.title.slice(0, 1000),
        url: stripTextFragment(location.href).slice(0, 8000),
        context: (context || fallback?.context || '').slice(0, 3000),
        textFragment: textFragment ?? fallback?.textFragment,
    }
}
function openPendingSelection() {
    const pending = pendingSelection.value
    if (!pending) return
    select(pending.text, pending.anchor, pending.context, pending.textFragment)
}
function selection(event: MouseEvent | KeyboardEvent) {
    if (
        event.composedPath().some((element) => element instanceof HTMLElement && element.id === 'xgloss-root')
    )
        return
    if (selectionTrigger.value === 'off') return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!selection?.rangeCount || !text || text.length > 2000) return
    const range = selection.getRangeAt(0)
    const parent = range.startContainer.parentElement
    if (parent?.closest('input,textarea,[contenteditable="true"]')) return
    const pos = selectionAnchor(selection)
    const snippet = selectionContextWithFragment(range, text)
    if (selectionTrigger.value === 'icon') {
        closeWordCard()
        pendingSelection.value = {
            text,
            anchor: pos,
            context: snippet.context,
            textFragment: snippet.textFragment,
        }
        return
    }
    select(text, pos, snippet.context, snippet.textFragment)
}
function keyboard(event: KeyboardEvent) {
    if (event.key === 'Shift') selection(event)
}
function closeWordCard() {
    pendingSelection.value = undefined
    selected.value = ''
    anchor.value = undefined
}
function onPanelDragStart() {
    if (anchor.value instanceof HTMLElement) closeWordCard()
}
onMounted(() => {
    const root = document.querySelector<HTMLElement>('main, article, [role="main"]') ?? document.body
    analyzer = new PageAnalyzer(root, (snapshot) => {
        const locationKey = location.pathname + location.search
        if (sourceId.value !== locationKey) {
            sourceId.value = locationKey
            closeWordCard()
        }
        counts.value = snapshot.counts
        status.value = snapshot.status
    })
    analyzer.setHighlight(highlighting.value)
    analyzer.start()
    void refresh()
    void loadSelectionTrigger()
    unsubscribe = onVocabularyChanged(() => void refresh())
    unsubscribeReading = onReadingChanged((change) => {
        if (change === 'selectionTrigger') void loadSelectionTrigger()
    })
    document.addEventListener('mouseup', selection)
    document.addEventListener('keyup', keyboard)
})
onBeforeUnmount(() => {
    refreshing++
    analyzer?.destroy()
    unsubscribe?.()
    unsubscribeReading?.()
    document.removeEventListener('mouseup', selection)
    document.removeEventListener('keyup', keyboard)
})
</script>

<template>
    <ReadingPanel
        :source-id="sourceId"
        :source-for-word="sourceForWord"
        :words="words"
        :counts="counts"
        :reload-words="reloadWords"
        :status="status"
        :highlighted="highlighting"
        :set-spotlight="setSpotlight"
        @select="select"
        @drag-start="onPanelDragStart"
    />
    <SelectionTriggerIcon
        v-if="pendingSelection"
        :anchor="pendingSelection.anchor"
        @open="openPendingSelection"
        @close="pendingSelection = undefined"
    />
    <FloatingWordCard
        v-if="selected && anchor"
        :text="selected"
        :source="source"
        :rating="rating"
        :anchor="anchor"
        :boundary="undefined"
        :spotlight="{ enabled: highlighting, setEnabled: setSpotlight }"
        @saved="refresh"
        @close="closeWordCard"
    />
</template>
