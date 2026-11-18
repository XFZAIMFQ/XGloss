<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ArrowRight, Play, Keyboard, Layers, Languages, Volume2, X, Check } from '@lucide/vue'
import type { Word, WordState } from '../domain/models'
import { errorMessage } from '../domain/models'
import { request } from '../platform/messages'
const props = defineProps<{ words: Word[] }>()
const emit = defineEmits<{ saved: [] }>()
type Mode = 'flashcard' | 'typing' | 'translation'
const mode = ref<Mode | null>(null)
const limit = ref(10)
const deck = ref<{ word: Word; definition: string }[]>([])
const index = ref(0)
const revealed = ref(false)
const answer = ref('')
const feedback = ref('')
const error = ref('')
const loading = ref(false)
const rating = ref(false)
let generation = 0
const current = computed(() => deck.value[index.value])
const available = computed(() => props.words.filter((word) => word.state === 'learning'))
const modes = [
    {
        id: 'flashcard' as const,
        title: '单词闪卡',
        description: '先回忆词义，再翻开卡片查看释义。',
        icon: Layers,
    },
    {
        id: 'translation' as const,
        title: '词义 → 单词',
        description: '根据中文释义回忆并输入英文单词。',
        icon: Languages,
    },
    {
        id: 'typing' as const,
        title: '拼写练习',
        description: '看词、朗读，再输入完整的单词。',
        icon: Keyboard,
    },
]
async function start(nextMode: Mode) {
    const currentGeneration = ++generation
    loading.value = true
    error.value = ''
    try {
        const candidates = available.value
            .slice()
            .sort((left, right) => left.updatedAt - right.updatedAt)
            .slice(0, limit.value)
        const entries = await Promise.all(
            candidates.map(async (word) => {
                const entry = await request('lookup', word.text)
                return { word, definition: entry?.translation || entry?.definition || '' }
            }),
        )
        if (currentGeneration !== generation) return
        deck.value = nextMode === 'translation' ? entries.filter((entry) => entry.definition) : entries
        if (!deck.value.length)
            throw new Error(
                nextMode === 'translation'
                    ? '当前学习词条中暂无可用的本地释义。'
                    : '先将阅读中遇到的单词加入生词，再开始复习。',
            )
        mode.value = nextMode
        index.value = 0
        revealed.value = false
        answer.value = ''
        feedback.value = ''
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        loading.value = false
    }
}
function check() {
    revealed.value = true
    feedback.value =
        answer.value.trim().toLowerCase() === current.value?.word.text.toLowerCase()
            ? '拼写正确'
            : `正确拼写为 ${current.value?.word.text}`
}
async function rate(state: WordState) {
    if (!current.value || rating.value) return
    const currentGeneration = generation
    const word = current.value.word.text
    rating.value = true
    try {
        await request('saveWord', { text: word, state })
        emit('saved')
        if (currentGeneration !== generation) return
        index.value++
        revealed.value = false
        answer.value = ''
        feedback.value = ''
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        rating.value = false
    }
}
function speak() {
    const utterance = new SpeechSynthesisUtterance(current.value?.word.text)
    utterance.lang = 'en-US'
    speechSynthesis.cancel()
    speechSynthesis.speak(utterance)
}
onBeforeUnmount(() => {
    generation++
})
</script>

<template>
    <header class="page-heading"><h1>复习训练</h1></header>
    <div class="panel review-filters">
        <div>
            <span class="muted small">词库</span>
            <div class="review-source">
                EN
                <strong>我的词库</strong>
                <span class="muted">{{ available.length }} 个学习中词条</span>
            </div>
        </div>
        <label class="review-limit" for="review-limit">
            每次词数
            <select id="review-limit" v-model.number="limit">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
            </select>
        </label>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="!mode">
        <p class="section-label">选择复习方式</p>
        <div class="review-grid">
            <article v-for="item in modes" :key="item.id" class="review-mode">
                <component :is="item.icon" class="review-watermark" :size="112" :stroke-width="1.5" />
                <h2>{{ item.title }}</h2>
                <p>{{ item.description }}</p>
                <button class="primary" :disabled="loading" @click="start(item.id)">
                    <Play :size="17" fill="currentColor" />
                    {{ loading ? '准备中…' : '开始' }}
                </button>
            </article>
        </div>
    </template>
    <section v-else class="panel review-session">
        <div class="row between">
            <span class="muted">{{ Math.min(index + 1, deck.length) }} / {{ deck.length }}</span>
            <button class="icon-button" aria-label="退出复习" @click="mode = null"><X :size="20" /></button>
        </div>
        <template v-if="current">
            <div class="review-prompt">
                <p class="muted">{{ mode === 'translation' ? '根据释义回忆单词' : '回忆这个词的含义' }}</p>
                <h2>{{ mode === 'translation' && !revealed ? current.definition : current.word.text }}</h2>
                <button
                    v-if="mode !== 'translation' || revealed"
                    class="icon-button"
                    aria-label="朗读单词"
                    @click="speak"
                >
                    <Volume2 :size="24" />
                </button>
            </div>
            <form v-if="mode !== 'flashcard'" class="review-answer" @submit.prevent="check">
                <input v-model="answer" placeholder="输入英文单词" autocomplete="off" />
                <button class="primary" type="submit">
                    检查
                    <ArrowRight :size="18" />
                </button>
            </form>
            <button v-else-if="!revealed" class="soft-button" @click="revealed = true">查看释义</button>
            <p v-if="feedback" class="review-feedback">{{ feedback }}</p>
            <p v-if="revealed" class="review-definition">
                {{ current.definition || '本地词典暂无释义，可在词库中查询在线语境释义。' }}
            </p>
            <div v-if="revealed" class="review-rating">
                <button :disabled="rating" @click="rate('learning')">继续学习</button>
                <button class="primary" :disabled="rating" @click="rate('known')">
                    <Check :size="18" />
                    已掌握
                </button>
            </div>
        </template>
        <div v-else class="review-complete">
            <Check :size="48" class="lime-text" />
            <h2>本轮复习完成</h2>
            <button class="primary" @click="mode = null">返回复习列表</button>
        </div>
    </section>
</template>
