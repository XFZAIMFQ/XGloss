<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
    useId,
    watch,
    watchEffect,
} from 'vue'
import { EyeOff, RefreshCw, Volume2, X } from '@lucide/vue'
import { calculateCoverage, ratingLabel, type Frequency } from '../domain/vocabulary'
import { dictionaryMeanings } from '../domain/definitions'
import { errorMessage, type Word, type WordRating, type WordSource } from '../domain/models'
import { onReadingChanged, request } from '../platform/messages'
import WordRatingControls from './WordRatingControls.vue'
import SpotlightButton from './SpotlightButton.vue'

const props = defineProps<{
    sourceId: string
    words: Word[] | undefined
    counts: Map<string, number>
    status: string
    highlighted: boolean
    setSpotlight: (enabled: boolean) => void | Promise<void>
    reloadWords: () => Promise<Word[]>
    sourceForWord: (word: string) => WordSource | Promise<WordSource>
}>()
const emit = defineEmits<{ select: [word: string, anchor: HTMLElement] }>()
const panelId = useId()
const expanded = ref(false)
const trigger = ref<HTMLButtonElement>()
const closeButton = ref<HTMLButtonElement>()
const list = ref<HTMLElement>()
const snapshot = shallowRef<Frequency[]>()
const meanings = shallowRef<Record<string, string>>({})
const recall = ref<boolean>()
const recallSaving = ref(false)
const recallError = ref('')
const revealed = ref(new Set<string>())
let recallGeneration = 0
let unsubscribe: (() => void) | undefined
const saving = ref(new Set<string>())
const confirmed = ref(new Map<string, WordRating>())
const rowErrors = ref(new Map<string, string>())
const refreshing = ref(false)
const refreshError = ref('')
const announcement = ref('')
let scope = 0
let scrollOffset = 0
const coverage = computed(() => calculateCoverage(props.counts, props.words ?? []))
const wordsByKey = computed(() => new Map(props.words?.map((word) => [word.key, word])))
const percent = computed(() =>
    props.words && coverage.value.percent !== null ? `${coverage.value.percent}%` : '—',
)
const newWords = computed(() => `${coverage.value.unknown.toLocaleString()} 个生词`)
const difficulty = computed(() => {
    const value = coverage.value.percent
    if (!props.words || value === null) return '等待覆盖率'
    if (value >= 95) return '轻松阅读'
    if (value >= 85) return '适合你的水平'
    if (value >= 70) return '有些挑战'
    return '生词较多'
})
function ratingFor(word: string) {
    return confirmed.value.get(word) ?? wordsByKey.value.get(word)
}
const gain = computed(() => {
    const { total } = coverage.value
    if (!total) return 0
    const counts = (snapshot.value ?? []).reduce((sum, candidate) => {
        const state = ratingFor(candidate.key)?.state
        return state === 'known' || state === 'ignored' ? sum : sum + (props.counts.get(candidate.key) ?? 0)
    }, 0)
    return (counts / total) * 100
})

watch(
    () => props.sourceId,
    () => {
        scope++
        expanded.value = false
        snapshot.value = undefined
        scrollOffset = 0
        meanings.value = {}
        confirmed.value.clear()
        saving.value.clear()
        rowErrors.value.clear()
        refreshing.value = false
        refreshError.value = ''
        announcement.value = ''
    },
)
watch(
    () => props.words,
    () => confirmed.value.clear(),
)
watchEffect(() => {
    if (expanded.value && !snapshot.value && props.words && (props.counts.size || !props.status))
        snapshot.value = coverage.value.candidates
})
async function lookupMeaning(key: string) {
    const entry = await request('lookup', key)
    return dictionaryMeanings(entry, 'simple').slice(0, 2).join(' · ')
}

watch([snapshot, recall], async ([batch, recalling], _previous, onCleanup) => {
    revealed.value.clear()
    if (!batch?.length || recalling !== false) return
    let current = true
    onCleanup(() => {
        current = false
    })
    const entries = await Promise.all(
        batch.map(async ({ key }) => {
            try {
                return [key, await lookupMeaning(key)] as const
            } catch {
                return [key, ''] as const
            }
        }),
    )
    if (current) meanings.value = Object.fromEntries(entries)
})

async function reloadRecall() {
    const current = ++recallGeneration
    try {
        const enabled = await request('recallCandidateMeanings')
        if (current === recallGeneration) {
            recall.value = enabled
            recallError.value = ''
        }
    } catch (reason) {
        if (current === recallGeneration) recallError.value = errorMessage(reason)
    }
}

async function toggleRecall() {
    if (recallSaving.value) return
    recallSaving.value = true
    recallError.value = ''
    try {
        await request('setRecallCandidateMeanings', recall.value !== true)
        await reloadRecall()
    } catch (reason) {
        recallError.value = errorMessage(reason)
    } finally {
        recallSaving.value = false
    }
}

function hiddenMeaning(word: string) {
    return recall.value === true && !revealed.value.has(word)
}

async function activateCandidate(word: string, anchor: HTMLElement) {
    if (!hiddenMeaning(word)) {
        emit('select', word, anchor)
        return
    }
    revealed.value.add(word)
    if (Object.hasOwn(meanings.value, word)) return
    const batch = snapshot.value
    try {
        const meaning = await lookupMeaning(word)
        if (batch === snapshot.value && revealed.value.has(word))
            meanings.value = { ...meanings.value, [word]: meaning }
    } catch (reason) {
        if (batch === snapshot.value && revealed.value.has(word)) {
            meanings.value = { ...meanings.value, [word]: '' }
            rowErrors.value.set(word, errorMessage(reason))
        }
    }
}

async function expand(event: MouseEvent) {
    expanded.value = true
    await nextTick()
    if (list.value) list.value.scrollTop = scrollOffset
    if (!event.detail) closeButton.value?.focus()
}

async function collapse() {
    scrollOffset = list.value?.scrollTop ?? 0
    expanded.value = false
    await nextTick()
    trigger.value?.focus({ preventScroll: true })
}

async function refreshList() {
    if (refreshing.value || saving.value.size) return
    const current = scope
    refreshing.value = true
    refreshError.value = ''
    try {
        const words = await props.reloadWords()
        if (current !== scope) return
        snapshot.value = calculateCoverage(props.counts, words).candidates
        rowErrors.value.clear()
        scrollOffset = 0
        if (list.value) list.value.scrollTop = 0
        announcement.value = '已刷新高频词表'
    } catch (reason) {
        if (current === scope) refreshError.value = errorMessage(reason)
    } finally {
        if (current === scope) refreshing.value = false
    }
}

async function rate(word: string, rating: WordRating) {
    if (saving.value.has(word) || refreshing.value) return
    const current = scope
    saving.value.add(word)
    rowErrors.value.delete(word)
    try {
        const source = await props.sourceForWord(word)
        if (current !== scope) return
        await request('saveWord', { text: word, ...rating, source })
        if (current !== scope) return
        confirmed.value.set(word, rating)
        announcement.value = `${word} · 已保存 · ${ratingLabel(rating)}`
        try {
            await props.reloadWords()
        } catch {
            if (current === scope) rowErrors.value.set(word, '等级已保存，刷新词表后可更新统计。')
        }
    } catch (reason) {
        if (current === scope) rowErrors.value.set(word, errorMessage(reason))
    } finally {
        if (current === scope) saving.value.delete(word)
    }
}

function speak(word: string) {
    const utterance = new SpeechSynthesisUtterance(word)
    utterance.lang = 'en-US'
    speechSynthesis.cancel()
    speechSynthesis.speak(utterance)
}

onMounted(() => {
    unsubscribe = onReadingChanged((change) => {
        if (change === 'recall') void reloadRecall()
    })
    void reloadRecall()
})
onBeforeUnmount(() => {
    scope++
    recallGeneration++
    unsubscribe?.()
})
</script>

<template>
    <button
        v-if="!expanded"
        ref="trigger"
        type="button"
        class="reading-trigger"
        :aria-label="`展开阅读面板 · ${percent} · ${difficulty} · ${newWords}`"
        aria-expanded="false"
        @click="expand"
    >
        <strong>{{ percent }}</strong>
        <span class="reading-trigger-summary" aria-hidden="true">
            <span>· {{ difficulty }} · {{ newWords }}</span>
        </span>
    </button>
    <section
        v-else
        :id="panelId"
        class="reading-panel"
        :aria-labelledby="`${panelId}-title`"
        @keydown.esc.stop="collapse"
    >
        <header class="reading-head">
            <div
                class="coverage-ring"
                :style="{ '--coverage': coverage.percent ?? 0 }"
                aria-label="阅读覆盖率"
            >
                <strong>{{ percent }}</strong>
            </div>
            <div class="reading-intro">
                <h2 :id="`${panelId}-title`">{{ difficulty }}</h2>
                <p v-if="status" role="status">{{ status }}</p>
            </div>
            <div class="reading-actions">
                <SpotlightButton :enabled="highlighted" :set-enabled="setSpotlight" />
                <button
                    ref="closeButton"
                    type="button"
                    class="icon-button"
                    aria-label="收起面板"
                    title="收起面板"
                    @click="collapse"
                >
                    <X :size="17" />
                </button>
            </div>
        </header>
        <dl class="statistics">
            <div>
                <dt>有效词次</dt>
                <dd>{{ coverage.total.toLocaleString() }}</dd>
            </div>
            <div>
                <dt>生词</dt>
                <dd>{{ coverage.unknown.toLocaleString() }}</dd>
            </div>
            <div>
                <dt>学习中</dt>
                <dd>{{ coverage.learning.toLocaleString() }}</dd>
            </div>
        </dl>
        <div class="reading-list-title">
            <h3>高频生词</h3>
            <span v-if="recall" class="recall-hint">先回想，再点单词</span>
            <div class="reading-list-actions">
                <button
                    type="button"
                    class="icon-button recall-button"
                    aria-label="回想模式"
                    title="回想模式 · 点击单词或按 Enter 显示释义"
                    :aria-pressed="recall === true"
                    :disabled="recallSaving"
                    @click="toggleRecall"
                >
                    <EyeOff :size="15" />
                </button>
                <button
                    type="button"
                    class="icon-button"
                    aria-label="刷新词表"
                    title="刷新词表"
                    :disabled="refreshing || saving.size > 0 || !words"
                    @click="refreshList"
                >
                    <RefreshCw :size="15" />
                </button>
            </div>
        </div>
        <p v-if="snapshot?.length" class="gain-callout">
            {{ gain ? `学会余下词条预计提升 ${gain.toFixed(1)} 个百分点` : '这一批词已处理，可以刷新词表。' }}
        </p>
        <p v-if="refreshError" class="error small" role="alert">{{ refreshError }}</p>
        <p v-if="recallError" class="error small" role="alert">{{ recallError }}</p>
        <div ref="list" class="candidate-list" :aria-busy="refreshing">
            <div v-for="candidate in snapshot" :key="candidate.key" class="candidate-item">
                <div class="candidate-top">
                    <button
                        type="button"
                        class="icon-button"
                        :aria-label="'朗读 ' + candidate.key"
                        @click="speak(candidate.key)"
                    >
                        <Volume2 :size="14" />
                    </button>
                    <button
                        type="button"
                        class="candidate"
                        :aria-label="
                            hiddenMeaning(candidate.key)
                                ? `显示 ${candidate.key} 的释义`
                                : `${candidate.key} ×${candidate.count}`
                        "
                        :title="hiddenMeaning(candidate.key) ? '点击或按 Enter 显示释义' : candidate.key"
                        @click="activateCandidate(candidate.key, $event.currentTarget as HTMLElement)"
                    >
                        <strong>{{ candidate.key }}</strong>
                        <span
                            v-if="
                                (recall === false &&
                                    Object.hasOwn(meanings, candidate.key) &&
                                    meanings[candidate.key]) ||
                                revealed.has(candidate.key)
                            "
                            class="candidate-meaning"
                            aria-live="polite"
                        >
                            {{
                                Object.hasOwn(meanings, candidate.key)
                                    ? meanings[candidate.key] || '暂无本地释义'
                                    : '正在查词…'
                            }}
                        </span>
                        <span class="candidate-frequency">×{{ candidate.count }}</span>
                    </button>
                </div>
                <WordRatingControls
                    :word="candidate.key"
                    :rating="ratingFor(candidate.key)"
                    :busy="saving.has(candidate.key) || refreshing"
                    @rate="rate(candidate.key, $event)"
                />
                <p v-if="rowErrors.has(candidate.key)" class="error small" role="alert">
                    {{ rowErrors.get(candidate.key) }}
                </p>
            </div>
            <p v-if="!snapshot?.length" class="reading-empty">
                {{ snapshot ? '当前内容中没有生词。' : '等待词汇分析结果…' }}
            </p>
        </div>
        <span class="reading-announcement" role="status">{{ announcement }}</span>
    </section>
</template>
