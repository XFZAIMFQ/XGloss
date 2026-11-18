<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
    errorMessage,
    type DefinitionMode,
    type DictionaryEntry,
    type WordRating,
    type WordSource,
} from '../domain/models'
import { newRequestId, request } from '../platform/messages'
import { dictionaryMeanings } from '../domain/definitions'
import { ratingLabel } from '../domain/vocabulary'
import WordRatingControls from './WordRatingControls.vue'
import SpotlightButton from './SpotlightButton.vue'
import { X, Volume2, Sparkles } from '@lucide/vue'

const props = withDefaults(
    defineProps<{
        text: string
        source: WordSource
        rating: WordRating | undefined
        saveSource?: boolean
        spotlight?: { enabled: boolean; setEnabled: (enabled: boolean) => void | Promise<void> }
    }>(),
    { saveSource: true, spotlight: undefined },
)
const emit = defineEmits<{ saved: []; close: [] }>()
const entry = ref<DictionaryEntry | null>(null)
const translation = ref('')
const status = ref('')
const error = ref('')
const busy = ref(false)
const saving = ref(false)
const loading = ref(false)
const mode = ref<DefinitionMode>('simple')
const allMeanings = ref(false)
const savedRating = ref<WordRating>()
let preferredMode: Promise<DefinitionMode> | undefined
const meanings = computed(() => dictionaryMeanings(entry.value, mode.value))
const previewCount = 4
const visibleMeanings = computed(() =>
    mode.value === 'simple' && !allMeanings.value ? meanings.value.slice(0, previewCount) : meanings.value,
)
let generation = 0
let translationId = ''
const canSave = computed(() => props.text.length <= 200)
watch(
    () => props.rating,
    () => {
        savedRating.value = undefined
    },
)

function cancel() {
    if (translationId) void request('cancelTranslation', translationId).catch(() => undefined)
    translationId = ''
    busy.value = false
}
watch(
    () => ({ text: props.text, context: props.source.context }),
    async ({ text }) => {
        cancel()
        const current = ++generation
        entry.value = null
        translation.value = ''
        status.value = ''
        error.value = ''
        loading.value = true
        allMeanings.value = false
        savedRating.value = undefined
        try {
            preferredMode ??= request('definitionMode').catch(() => 'simple')
            const [result, preference] = await Promise.all([
                text.length <= 200 ? request('lookup', text) : null,
                preferredMode,
            ])
            if (current === generation) {
                mode.value = preference
                entry.value = result
            }
        } catch (reason) {
            if (current === generation) error.value = errorMessage(reason)
        } finally {
            if (current === generation) loading.value = false
        }
    },
    { immediate: true },
)

async function save(rating: WordRating) {
    if (saving.value) return
    const current = generation
    saving.value = true
    try {
        await request('saveWord', {
            text: props.text,
            ...rating,
            source: props.saveSource ? props.source : undefined,
        })
        emit('saved')
        if (current !== generation) return
        savedRating.value = rating
        status.value = `已保存 · ${ratingLabel(rating)}`
        error.value = ''
    } catch (reason) {
        if (current === generation) error.value = errorMessage(reason)
    } finally {
        saving.value = false
    }
}
function toggleMode() {
    cancel()
    translation.value = ''
    allMeanings.value = false
    mode.value = mode.value === 'simple' ? 'detailed' : 'simple'
}
async function translate() {
    cancel()
    const id = newRequestId()
    translationId = id
    busy.value = true
    error.value = ''
    try {
        const result = await request(
            'translate',
            { text: props.text, context: props.source.context, detail: mode.value },
            id,
        )
        if (translationId === id) translation.value = result
    } catch (reason) {
        if (translationId === id) error.value = errorMessage(reason)
    } finally {
        if (translationId === id) {
            busy.value = false
            translationId = ''
        }
    }
}
function speak() {
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(props.text)
    utterance.lang = 'en-US'
    speechSynthesis.speak(utterance)
}
onBeforeUnmount(() => {
    generation++
    cancel()
})
</script>

<template>
    <section class="word-card" :aria-label="`查词 · ${text}`">
        <header class="card-toolbar">
            <button type="button" class="icon-button" aria-label="朗读" title="朗读" @click="speak">
                <Volume2 :size="16" />
            </button>
            <h2 :title="text">{{ text }}</h2>
            <div class="card-actions">
                <button type="button" class="quiet detail-toggle" :disabled="loading" @click="toggleMode">
                    {{ mode === 'simple' ? '详细释义' : '简洁释义' }}
                </button>
                <SpotlightButton
                    v-if="spotlight"
                    :enabled="spotlight.enabled"
                    :set-enabled="spotlight.setEnabled"
                />
                <button
                    type="button"
                    class="icon-button"
                    aria-label="关闭词卡"
                    title="关闭词卡"
                    @click="emit('close')"
                >
                    <X :size="17" />
                </button>
            </div>
        </header>
        <div class="word-card-content">
            <p v-if="mode === 'detailed' && entry?.phonetic" class="word-pronunciation">
                {{ entry.phonetic }}
            </p>
            <p v-if="loading" class="definition muted" role="status">正在查词…</p>
            <template v-else-if="meanings.length">
                <p v-if="mode === 'simple'" class="definition">
                    {{ visibleMeanings.join(' · ') }}
                    <button
                        v-if="meanings.length > previewCount"
                        type="button"
                        class="quiet more-meanings"
                        :aria-expanded="allMeanings"
                        @click="allMeanings = !allMeanings"
                    >
                        {{ allMeanings ? '收起义项' : `更多 ${meanings.length - previewCount} 项` }}
                    </button>
                </p>
                <p v-else class="definition">{{ visibleMeanings.join('\n') }}</p>
            </template>
            <p v-else class="definition muted">本地词典暂无释义。</p>
            <blockquote v-if="mode === 'detailed' && source.context">{{ source.context }}</blockquote>
            <p v-if="busy" class="definition translation muted" role="status">正在查询语境释义…</p>
            <p v-else-if="translation" class="definition translation">{{ translation }}</p>
            <p v-if="error" role="alert" class="error small">{{ error }}</p>
        </div>
        <footer class="card-footer">
            <WordRatingControls
                v-if="canSave"
                :word="text"
                :rating="savedRating ?? rating"
                :busy="saving"
                @rate="save"
            />
            <button
                v-if="!busy"
                type="button"
                class="quiet online-lookup"
                aria-label="在线语境释义"
                title="在线语境释义"
                @click="translate"
            >
                <Sparkles :size="14" />
                语境
            </button>
            <button v-else type="button" class="quiet online-lookup" aria-label="取消翻译" @click="cancel">
                <X :size="14" />
                取消
            </button>
        </footer>
        <span class="reading-announcement" role="status">{{ status }}</span>
    </section>
</template>
