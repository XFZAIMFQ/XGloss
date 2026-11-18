<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import FloatingWordCard from '../../components/FloatingWordCard.vue'
import ReadingPanel from '../../components/ReadingPanel.vue'
import { normalizeWord } from '../../domain/vocabulary'
import { errorMessage, type Word, type WordSource } from '../../domain/models'
import { onVocabularyChanged, request } from '../../platform/messages'
import { PageAnalyzer } from './page-analyzer'
import { selectionAnchor } from '../reading/selection-anchor'
import { selectionContext } from '../reading/selection-context'
import { useSpotlight } from '../reading/use-spotlight'

const words = shallowRef<Word[]>()
const counts = shallowRef(new Map<string, number>())
const status = ref(t('web.preparing'))
const selected = ref('')
const source = ref<WordSource>({ title: document.title, url: location.href, context: '' })
const anchor = shallowRef<HTMLElement | Range>()
const sourceId = ref(location.pathname + location.search)
const rating = computed(() => words.value?.find((word) => word.key === normalizeWord(selected.value)))
let analyzer: PageAnalyzer
let unsubscribe: (() => void) | undefined
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
    return {
        title: document.title.slice(0, 1000),
        url: location.href.slice(0, 8000),
        context: analyzer?.contextForWord(word) ?? '',
    }
}
function select(text: string, position: HTMLElement | Range, context = '') {
    selected.value = text
    anchor.value = position
    source.value = {
        title: document.title.slice(0, 1000),
        url: location.href.slice(0, 8000),
        context: (context || analyzer?.contextForWord(text) || '').slice(0, 3000),
    }
}
function selection(event: MouseEvent | KeyboardEvent) {
    if (
        event.composedPath().some((element) => element instanceof HTMLElement && element.id === 'xgloss-root')
    )
        return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!selection?.rangeCount || !text || text.length > 2000) return
    const range = selection.getRangeAt(0)
    const parent = range.startContainer.parentElement
    if (parent?.closest('input,textarea,[contenteditable="true"]')) return
    select(text, selectionAnchor(selection), selectionContext(range, text))
}
function keyboard(event: KeyboardEvent) {
    if (event.key === 'Shift') selection(event)
}
function closeWordCard() {
    selected.value = ''
    anchor.value = undefined
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
    unsubscribe = onVocabularyChanged(() => void refresh())
    document.addEventListener('mouseup', selection)
    document.addEventListener('keyup', keyboard)
})
onBeforeUnmount(() => {
    refreshing++
    analyzer?.destroy()
    unsubscribe?.()
    document.removeEventListener('mouseup', selection)
    document.removeEventListener('keyup', keyboard)
})
</script>

<template>
    <div class="floating">
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
        />
    </div>
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
