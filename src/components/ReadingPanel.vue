<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { X, Volume2, Bookmark, Check, ChevronDown, ChevronUp, RefreshCw } from '@lucide/vue'
import type { Coverage } from '../domain/vocabulary'
import { errorMessage, type WordSource, type WordState } from '../domain/models'
import { request } from '../platform/messages'
const props = defineProps<{
    coverage: Coverage
    status: string
    sourceForWord?: (word: string) => WordSource
}>()
const emit = defineEmits<{ select: [word: string]; highlight: [enabled: boolean]; close: [] }>()
const expanded = ref(true)
const highlight = ref(true)
const meanings = ref<Record<string, string>>({})
const error = ref('')
let generation = 0
const gain = computed(() =>
    props.coverage.total
        ? (
              (props.coverage.candidates.reduce((sum, word) => sum + word.count, 0) / props.coverage.total) *
              100
          ).toFixed(1)
        : '0',
)
const level = computed(() => {
    const percentage = props.coverage.percent
    if (percentage === null)
        return {
            title: '正在了解你的词汇',
            description: '导入熟词表或标记已掌握的词，建立你的阅读词汇档案。',
        }
    if (percentage >= 95) return { title: '轻松阅读', description: '大部分词汇已经掌握，在阅读中巩固记忆。' }
    if (percentage >= 85) return { title: '适合你的水平', description: '继续阅读，积累少量新词。' }
    if (percentage >= 70) return { title: '有些挑战', description: '先熟悉下面的高频词，再继续阅读。' }
    return { title: '生词较多', description: '从下面的高频词开始，逐步提高词汇覆盖率。' }
})
async function loadMeanings() {
    const current = ++generation
    const entries = await Promise.all(
        props.coverage.candidates.map(async ({ key }) => {
            try {
                const entry = await request('lookup', key)
                return [key, entry?.translation.split('\n')[0] ?? ''] as const
            } catch {
                return [key, ''] as const
            }
        }),
    )
    if (current === generation) meanings.value = Object.fromEntries(entries)
}
watch(
    () => props.coverage.candidates.map((word) => word.key).join('\n'),
    () => void loadMeanings(),
    { immediate: true },
)
async function rate(word: string, state: WordState) {
    try {
        await request('saveWord', { text: word, state, source: props.sourceForWord?.(word) })
        error.value = ''
    } catch (reason) {
        error.value = errorMessage(reason)
    }
}
function speak(word: string) {
    const utterance = new SpeechSynthesisUtterance(word)
    utterance.lang = 'en-US'
    speechSynthesis.cancel()
    speechSynthesis.speak(utterance)
}
onBeforeUnmount(() => {
    generation++
})
</script>
<template>
    <section class="reading-panel">
        <template v-if="expanded">
            <div class="reading-head">
                <button
                    class="coverage-ring quiet"
                    :style="{ '--coverage': coverage.percent ?? 0 }"
                    aria-label="收起面板"
                    @click="expanded = false"
                >
                    <strong>{{ coverage.percent === null ? '—' : coverage.percent + '%' }}</strong>
                </button>
                <div class="reading-intro">
                    <h2>{{ level.title }}</h2>
                    <p>{{ level.description }}</p>
                </div>
                <button class="icon-button close-panel" aria-label="关闭 XGloss" @click="emit('close')">
                    <X :size="19" />
                </button>
            </div>
            <div class="statistics">
                <div>
                    <strong>{{ coverage.total.toLocaleString() }}</strong>
                    <span>有效词次</span>
                </div>
                <div>
                    <strong>{{ coverage.unknown.toLocaleString() }}</strong>
                    <span>待确认词</span>
                </div>
                <div>
                    <strong>{{ coverage.learning.toLocaleString() }}</strong>
                    <span>学习中</span>
                </div>
            </div>
            <div class="reading-list-title">
                <h3>高频待确认词</h3>
                <button class="icon-button" aria-label="刷新生词释义" @click="loadMeanings">
                    <RefreshCw :size="15" />
                </button>
            </div>
            <p v-if="coverage.candidates.length" class="gain-callout">
                掌握这 {{ coverage.candidates.length }} 个词，词汇覆盖率预计提高 {{ gain }} 个百分点
            </p>
            <div class="candidate-list">
                <div v-for="candidate in coverage.candidates" :key="candidate.key" class="candidate-item">
                    <div class="candidate-top">
                        <button
                            class="icon-button"
                            :aria-label="'朗读 ' + candidate.key"
                            @click="speak(candidate.key)"
                        >
                            <Volume2 :size="14" />
                        </button>
                        <button
                            class="candidate"
                            :aria-label="candidate.key + ' ×' + candidate.count"
                            @click="emit('select', candidate.key)"
                        >
                            <strong>{{ candidate.key }}</strong>
                            <span v-if="meanings[candidate.key]" class="candidate-meaning">
                                — {{ meanings[candidate.key] }}
                            </span>
                            <span class="candidate-frequency">×{{ candidate.count }}</span>
                        </button>
                    </div>
                    <div class="candidate-actions">
                        <button :aria-label="'忽略 ' + candidate.key" @click="rate(candidate.key, 'ignored')">
                            <X :size="11" />
                            忽略
                        </button>
                        <button
                            :aria-label="'学习 ' + candidate.key"
                            @click="rate(candidate.key, 'learning')"
                        >
                            <Bookmark :size="11" />
                            学习中
                        </button>
                        <button :aria-label="'掌握 ' + candidate.key" @click="rate(candidate.key, 'known')">
                            <Check :size="11" />
                            已掌握
                        </button>
                    </div>
                </div>
                <p v-if="!coverage.candidates.length" class="muted small">当前内容中没有待确认词。</p>
            </div>
            <div class="reading-footer">
                <label>
                    <input v-model="highlight" type="checkbox" @change="emit('highlight', highlight)" />
                    Spotlight
                </label>
                <button class="icon-button" aria-label="收起面板" @click="expanded = false">
                    <ChevronDown :size="16" />
                </button>
            </div>
            <p class="reading-status">{{ status }}</p>
            <p v-if="error" class="error small" role="alert">{{ error }}</p>
        </template>
        <div v-else class="reading-compact">
            <button class="quiet" aria-label="展开面板" @click="expanded = true">
                {{ coverage.percent === null ? '—' : coverage.percent + '%' }} · {{ level.title }}
                <span class="muted small">{{ coverage.unknown }} 个待确认词</span>
                <ChevronUp :size="16" />
            </button>
            <button class="icon-button" aria-label="关闭 XGloss" @click="emit('close')">
                <X :size="16" />
            </button>
        </div>
    </section>
</template>
