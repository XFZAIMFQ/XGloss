<script setup lang="ts">
import { t } from '../i18n'
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
import { EyeOff, GripVertical, RefreshCw, Volume2, X } from '@lucide/vue'
import { calculateCoverage, ratingLabel, type Frequency } from '../domain/vocabulary'
import { errorMessage, type Word, type WordRating, type WordSource } from '../domain/models'
import { useFloatingDrag } from '../features/reading/use-floating-drag'
import { onReadingChanged, request, translateSelection } from '../platform/messages'
import WordRatingControls from './WordRatingControls.vue'
import SpotlightButton from './SpotlightButton.vue'

const props = withDefaults(
    defineProps<{
        sourceId: string
        active?: boolean
        words: Word[] | undefined
        counts: Map<string, number>
        status: string
        highlighted: boolean
        setSpotlight: (enabled: boolean) => void | Promise<void>
        reloadWords: () => Promise<Word[]>
        sourceForWord: (word: string) => WordSource | Promise<WordSource>
    }>(),
    { active: true },
)
const emit = defineEmits<{ select: [word: string, anchor: HTMLElement]; dragStart: [] }>()
const panelId = useId()
const floating = ref<HTMLElement>()
const expanded = ref(false)
const trigger = ref<HTMLButtonElement>()
const closeButton = ref<HTMLButtonElement>()
const list = ref<HTMLElement>()
const { dragging, floatingStyle, onDragPointerDown, consumeSuppressedClick, syncPosition } = useFloatingDrag(
    floating,
    { onDragStart: () => emit('dragStart') },
)
const snapshot = shallowRef<Frequency[]>()
const meanings = ref(new Map<string, string>())
const recall = ref<boolean>()
const recallSaving = ref(false)
const recallError = ref('')
const revealed = ref(new Set<string>())
let recallGeneration = 0
let unsubscribe: (() => void) | undefined
let scheduleMeaning: ((word: string) => void) | undefined
const maxConcurrentMeanings = 5
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
    props.words && coverage.value.percent !== null ? `${coverage.value.percent}%` : '-',
)
const newWords = computed(() => t('reading.unknownCount', { count: coverage.value.unknown.toLocaleString() }))
const difficulty = computed(() => {
    const value = coverage.value.percent
    if (!props.words || value === null) return t('reading.waitingCoverage')
    if (value >= 95) return t('reading.easy')
    if (value >= 85) return t('reading.suitable')
    if (value >= 70) return t('reading.challenging')
    return t('reading.difficult')
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
watch(snapshot, () => {
    meanings.value.clear()
    revealed.value.clear()
})
watch(recall, () => revealed.value.clear())

watch(
    [snapshot, recall, list, () => props.active],
    ([batch, recalling, viewport, active], _previous, onCleanup) => {
        if (!batch?.length || recalling === undefined || !viewport || !active) return
        const controller = new AbortController()
        const { signal } = controller
        const queue = new Set<string>()
        const loading = new Set<string>()
        let available: Promise<boolean> | undefined
        async function lookupMeaning(word: string) {
            try {
                available ??= request('translationAvailable').catch(() => false)
                if (await available) {
                    signal.throwIfAborted()
                    const { context } = await props.sourceForWord(word)
                    const result = await translateSelection({ text: word, context }, signal)
                    if (result.kind === 'meanings') return result.meanings[0]?.text ?? ''
                }
            } catch {
                signal.throwIfAborted()
            }
            return ''
        }
        function drain() {
            while (!signal.aborted && loading.size < maxConcurrentMeanings && queue.size) {
                const word = queue.values().next().value!
                queue.delete(word)
                loading.add(word)
                void lookupMeaning(word)
                    .catch(() => '')
                    .then((meaning) => {
                        if (!signal.aborted) meanings.value.set(word, meaning)
                    })
                    .finally(() => {
                        loading.delete(word)
                        drain()
                    })
            }
        }
        scheduleMeaning = (word) => {
            if (!loading.has(word) && !meanings.value.has(word)) queue.add(word)
            drain()
        }
        const observer = recalling
            ? undefined
            : new IntersectionObserver(
                  (entries) => {
                      if (signal.aborted) return
                      for (const entry of entries) {
                          if (!entry.isIntersecting) continue
                          observer?.unobserve(entry.target)
                          const word = (entry.target as HTMLElement).dataset.word
                          if (word) scheduleMeaning?.(word)
                      }
                  },
                  { root: viewport },
              )
        if (observer) {
            for (const row of viewport.querySelectorAll('[data-word]')) observer.observe(row)
        } else {
            for (const word of revealed.value) scheduleMeaning(word)
        }
        onCleanup(() => {
            scheduleMeaning = undefined
            observer?.disconnect()
            controller.abort()
        })
    },
    { flush: 'post' },
)

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

function activateCandidate(word: string, anchor: HTMLElement) {
    if (!hiddenMeaning(word)) {
        emit('select', word, anchor)
        return
    }
    revealed.value.add(word)
    scheduleMeaning?.(word)
}

async function expand(event: MouseEvent) {
    if (consumeSuppressedClick()) return
    expanded.value = true
    await nextTick()
    syncPosition()
    if (list.value) list.value.scrollTop = scrollOffset
    if (!event.detail) closeButton.value?.focus()
}

async function collapse() {
    scrollOffset = list.value?.scrollTop ?? 0
    expanded.value = false
    await nextTick()
    syncPosition()
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
        announcement.value = t('reading.refreshed')
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
        const meaning =
            !hiddenMeaning(word) && !wordsByKey.value.get(word)?.meaning
                ? meanings.value.get(word)
                : undefined
        await request('saveWord', { text: word, ...rating, source, meaning: meaning || undefined })
        if (current !== scope) return
        confirmed.value.set(word, rating)
        announcement.value = t('reading.rated', { word, rating: ratingLabel(rating) })
        try {
            await props.reloadWords()
        } catch {
            if (current === scope) rowErrors.value.set(word, t('reading.refreshAfterRating'))
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
    <div ref="floating" class="floating" :class="{ 'is-dragging': dragging }" :style="floatingStyle">
        <button
            v-if="!expanded"
            ref="trigger"
            type="button"
            class="reading-trigger"
            :aria-label="t('reading.expand', { percent, difficulty, unknown: newWords })"
            :title="t('reading.dragHandle')"
            aria-expanded="false"
            @pointerdown="onDragPointerDown($event, 'trigger')"
            @click="expand"
        >
            <strong>{{ percent }}</strong>
            <span class="reading-trigger-summary" aria-hidden="true">
                <span>- {{ difficulty }} - {{ newWords }}</span>
            </span>
        </button>
        <section
            v-else
            :id="panelId"
            class="reading-panel"
            :aria-labelledby="`${panelId}-title`"
            @keydown.esc.stop="collapse"
        >
            <header
                class="reading-head"
                :title="t('reading.dragHandle')"
                @pointerdown="onDragPointerDown($event, 'header')"
            >
                <span class="reading-drag-grip" aria-hidden="true">
                    <GripVertical :size="14" />
                </span>
                <div
                    class="coverage-ring"
                    :style="{ '--coverage': coverage.percent ?? 0 }"
                    :aria-label="t('reading.coverage')"
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
                    :aria-label="t('reading.collapse')"
                    :title="t('reading.collapse')"
                    @click="collapse"
                >
                    <X :size="17" />
                </button>
            </div>
        </header>
        <dl class="statistics">
            <div>
                <dt>{{ t('reading.effectiveWords') }}</dt>
                <dd>{{ coverage.total.toLocaleString() }}</dd>
            </div>
            <div>
                <dt>{{ t('reading.unknown') }}</dt>
                <dd>{{ coverage.unknown.toLocaleString() }}</dd>
            </div>
            <div>
                <dt>{{ t('common.learning') }}</dt>
                <dd>{{ coverage.learning.toLocaleString() }}</dd>
            </div>
        </dl>
        <div class="reading-list-title">
            <h3>{{ t('reading.frequentWords') }}</h3>
            <span v-if="recall" class="recall-hint">{{ t('reading.recallHint') }}</span>
            <div class="reading-list-actions">
                <button
                    type="button"
                    class="icon-button recall-button"
                    :aria-label="t('reading.recall')"
                    :title="t('reading.recallHelp')"
                    :aria-pressed="recall === true"
                    :disabled="recallSaving"
                    @click="toggleRecall"
                >
                    <EyeOff :size="15" />
                </button>
                <button
                    type="button"
                    class="icon-button"
                    :aria-label="t('reading.refresh')"
                    :title="t('reading.refresh')"
                    :disabled="refreshing || saving.size > 0 || !words"
                    @click="refreshList"
                >
                    <RefreshCw :size="15" />
                </button>
            </div>
        </div>
        <p v-if="snapshot?.length" class="gain-callout">
            {{ gain ? t('reading.estimatedGain', { points: gain.toFixed(1) }) : t('reading.batchComplete') }}
        </p>
        <p v-if="refreshError" class="error small" role="alert">{{ refreshError }}</p>
        <p v-if="recallError" class="error small" role="alert">{{ recallError }}</p>
        <div ref="list" class="candidate-list" :aria-busy="refreshing">
            <div
                v-for="candidate in snapshot"
                :key="candidate.key"
                :data-word="candidate.key"
                class="candidate-item"
            >
                <div class="candidate-top">
                    <button
                        type="button"
                        class="icon-button"
                        :aria-label="t('reading.playWord', { word: candidate.key })"
                        @click="speak(candidate.key)"
                    >
                        <Volume2 :size="14" />
                    </button>
                    <button
                        type="button"
                        class="candidate"
                        :aria-label="
                            hiddenMeaning(candidate.key)
                                ? t('reading.revealWord', { word: candidate.key })
                                : `${candidate.key} ×${candidate.count}`
                        "
                        :title="hiddenMeaning(candidate.key) ? t('reading.revealHelp') : candidate.key"
                        @click="activateCandidate(candidate.key, $event.currentTarget as HTMLElement)"
                    >
                        <strong>{{ candidate.key }}</strong>
                        <span
                            v-if="recall === false || revealed.has(candidate.key)"
                            class="candidate-meaning"
                            :title="meanings.get(candidate.key)"
                            aria-live="polite"
                        >
                            {{
                                meanings.has(candidate.key)
                                    ? meanings.get(candidate.key) || t('reading.noMeaning')
                                    : t('reading.lookingUp')
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
                {{ snapshot ? t('reading.noUnknown') : t('reading.waitingAnalysis') }}
            </p>
        </div>
        <span class="reading-announcement" role="status">{{ announcement }}</span>
        </section>
    </div>
</template>
