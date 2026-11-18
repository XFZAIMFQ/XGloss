<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import WordCard from '../../components/WordCard.vue'
import ReadingPanel from '../../components/ReadingPanel.vue'
import { calculateCoverage, contextAround } from '../../domain/vocabulary'
import { errorMessage, type Word, type WordSource } from '../../domain/models'
import { onVocabularyChanged, request } from '../../platform/messages'
import { PageAnalyzer } from './page-analyzer'

const emit = defineEmits<{ close: [] }>()
const words = ref<Word[]>([])
const counts = shallowRef(new Map<string, number>())
const status = ref('准备分析页面…')
const selected = ref('')
const source = ref<WordSource>({ title: document.title, url: location.href, context: '' })
const coverage = computed(() => calculateCoverage(counts.value, words.value))
let analyzer: PageAnalyzer
let unsubscribe: (() => void) | undefined

async function refresh() {
    try {
        words.value = await request('words')
        analyzer?.setWords(words.value)
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
function select(text: string, context = '') {
    selected.value = text
    source.value = {
        title: document.title.slice(0, 1000),
        url: location.href.slice(0, 8000),
        context: (context || analyzer?.contextForWord(text) || '').slice(0, 3000),
    }
}
function selection(event: MouseEvent) {
    if (
        event.composedPath().some((element) => element instanceof HTMLElement && element.id === 'xgloss-root')
    )
        return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!text || text.length > 2000) return
    const anchor = selection?.anchorNode?.parentElement
    if (anchor?.closest('input,textarea,[contenteditable="true"]')) return
    select(text, contextAround(anchor?.textContent ?? '', text))
}
function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') selected.value = ''
}
onMounted(() => {
    const root = document.querySelector<HTMLElement>('main, article, [role="main"]') ?? document.body
    analyzer = new PageAnalyzer(root, (snapshot) => {
        counts.value = snapshot.counts
        status.value = snapshot.status
    })
    analyzer.start()
    void refresh()
    unsubscribe = onVocabularyChanged(() => void refresh())
    document.addEventListener('mouseup', selection)
    document.addEventListener('keydown', keyboard)
})
onBeforeUnmount(() => {
    analyzer?.destroy()
    unsubscribe?.()
    document.removeEventListener('mouseup', selection)
    document.removeEventListener('keydown', keyboard)
})
</script>

<template>
    <div class="floating">
        <ReadingPanel
            :source-for-word="sourceForWord"
            :coverage="coverage"
            :status="status"
            @select="select"
            @highlight="analyzer.setHighlight($event)"
            @close="emit('close')"
        />
    </div>
    <div v-if="selected" class="floating-card">
        <WordCard :text="selected" :source="source" @saved="refresh" @close="selected = ''" />
    </div>
</template>
