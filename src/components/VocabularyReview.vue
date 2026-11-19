<script setup lang="ts">
import { t } from '../i18n'
import { dictionaryMeanings } from '../domain/definitions'
import { wordCollectionId } from '../domain/collections'
import { computed, onBeforeUnmount, ref } from 'vue'
import { ArrowRight, Play, Keyboard, Layers, Languages, Volume2, X, Check, ChevronDown } from '@lucide/vue'
import type { VocabularyCollection, Word, WordState } from '../domain/models'
import { errorMessage } from '../domain/models'
import { request } from '../platform/messages'

const props = defineProps<{ words: Word[]; collections?: VocabularyCollection[] }>()
const emit = defineEmits<{ saved: [] }>()
type Mode = 'flashcard' | 'typing' | 'translation'
const mode = ref<Mode | null>(null)
const selectedCollection = ref('all')
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
const available = computed(() =>
    props.words.filter(
        (word) =>
            word.state === 'learning' &&
            (selectedCollection.value === 'all' || wordCollectionId(word) === selectedCollection.value),
    ),
)
const modes = [
    {
        id: 'flashcard' as const,
        title: t('review.flashcards'),
        description: t('review.flashcardsHelp'),
        icon: Layers,
    },
    {
        id: 'translation' as const,
        title: t('review.translation'),
        description: t('review.translationHelp'),
        icon: Languages,
    },
    {
        id: 'typing' as const,
        title: t('review.spelling'),
        description: t('review.spellingHelp'),
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
                if (word.meaning) return { word, definition: word.meaning }
                const entry = await request('lookup', word.text)
                return { word, definition: dictionaryMeanings(entry, 'detailed').join('\n') }
            }),
        )
        if (currentGeneration !== generation) return
        deck.value = nextMode === 'translation' ? entries.filter((entry) => entry.definition) : entries
        if (!deck.value.length)
            throw new Error(
                nextMode === 'translation' ? t('review.noDefinitions') : t('review.noLearningWords'),
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
            ? t('review.correct')
            : t('review.correctSpelling', { word: current.value?.word.text ?? '' })
}

async function rate(state: WordState) {
    if (!current.value || rating.value) return
    const currentGeneration = generation
    const word = current.value.word.text
    rating.value = true
    try {
        await request('saveWord', {
            text: word,
            state,
            reviewed: true,
            collectionId: wordCollectionId(current.value.word),
        })
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
    <div class="panel review-filters">
        <div class="review-filter-group">
            <span>{{ t('review.libraryLabel') }}</span>
            <div class="select-wrap" style="width: 100%">
                <select v-model="selectedCollection" :aria-label="t('review.libraryLabel')">
                    <option value="all">{{ t('review.allCollections') }}</option>
                    <option v-for="item in collections" :key="item.id" :value="item.id">
                        {{ item.name }}
                    </option>
                </select>
                <ChevronDown :size="14" class="select-chevron" />
            </div>
        </div>
        <label class="review-limit" for="review-limit">
            {{ t('review.sessionSize') }}
            <div class="select-wrap">
                <select id="review-limit" v-model.number="limit">
                    <option :value="10">10</option>
                    <option :value="20">20</option>
                    <option :value="50">50</option>
                </select>
                <ChevronDown :size="14" class="select-chevron" />
            </div>
        </label>
        <span class="review-meta-count">{{ t('review.learningCount', { count: available.length }) }}</span>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="!mode">
        <p class="section-label">{{ t('review.chooseMode') }}</p>
        <div class="review-grid">
            <article v-for="item in modes" :key="item.id" class="review-mode">
                <component :is="item.icon" class="review-watermark" :size="108" :stroke-width="1.5" />
                <h2>{{ item.title }}</h2>
                <p>{{ item.description }}</p>
                <button type="button" class="primary" :disabled="loading" @click="start(item.id)">
                    <Play :size="15" fill="currentColor" />
                    {{ loading ? t('review.preparing') : t('review.start') }}
                </button>
            </article>
        </div>
    </template>
    <section v-else class="panel review-session">
        <div class="row between">
            <span class="muted">{{ Math.min(index + 1, deck.length) }} / {{ deck.length }}</span>
            <button type="button" class="icon-button" :aria-label="t('review.exit')" @click="mode = null">
                <X :size="18" />
            </button>
        </div>
        <template v-if="current">
            <div class="review-prompt">
                <p class="muted">
                    {{ mode === 'translation' ? t('review.recallTranslation') : t('review.recallMeaning') }}
                </p>
                <h2>{{ mode === 'translation' && !revealed ? current.definition : current.word.text }}</h2>
                <button
                    v-if="mode !== 'translation' || revealed"
                    type="button"
                    class="icon-button"
                    :aria-label="t('review.speakWord')"
                    @click="speak"
                >
                    <Volume2 :size="20" />
                </button>
            </div>
            <form v-if="mode !== 'flashcard'" class="review-answer" @submit.prevent="check">
                <input v-model="answer" :placeholder="t('review.answerPlaceholder')" autocomplete="off" />
                <button class="primary" type="submit">
                    {{ t('review.check') }}
                    <ArrowRight :size="16" />
                </button>
            </form>
            <button v-else-if="!revealed" type="button" class="soft-button" @click="revealed = true">
                {{ t('review.showMeaning') }}
            </button>
            <p v-if="feedback" class="review-feedback">{{ feedback }}</p>
            <p v-if="revealed" class="review-definition">
                {{ current.definition || t('review.offlineMissing') }}
            </p>
            <div v-if="revealed" class="review-rating">
                <button type="button" :disabled="rating" @click="rate('learning')">
                    {{ t('review.continueLearning') }}
                </button>
                <button type="button" class="primary" :disabled="rating" @click="rate('known')">
                    <Check :size="16" />
                    {{ t('common.known') }}
                </button>
            </div>
        </template>
        <div v-else class="review-complete">
            <Check :size="44" class="lime-text" />
            <h2>{{ t('review.finished') }}</h2>
            <button type="button" class="primary" @click="mode = null">{{ t('review.back') }}</button>
        </div>
    </section>
</template>
