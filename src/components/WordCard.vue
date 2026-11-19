<script setup lang="ts">
import { t } from '../i18n'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import {
    errorMessage,
    type DefinitionMode,
    type DictionaryEntry,
    type TranslationResult,
    type WordRating,
    type WordSource,
} from '../domain/models'
import { request, translateSelection } from '../platform/messages'
import { dictionaryMeanings, isPassageSelection } from '../domain/definitions'
import { ratingLabel } from '../domain/vocabulary'
import WordRatingControls from './WordRatingControls.vue'
import SpotlightButton from './SpotlightButton.vue'
import { Sparkles, Volume2, X } from '@lucide/vue'

const props = withDefaults(
    defineProps<{
        text: string
        source: WordSource
        rating: WordRating | undefined
        saveSource?: boolean
        savedMeaning?: string
        spotlight?: { enabled: boolean; setEnabled: (enabled: boolean) => void | Promise<void> }
    }>(),
    { saveSource: true, savedMeaning: undefined, spotlight: undefined },
)
const emit = defineEmits<{ saved: []; close: [] }>()
const entry = ref<DictionaryEntry | null>(null)
const translation = ref<TranslationResult>()
const status = ref('')
const error = ref('')
const translationError = ref('')
const localError = ref('')
const busy = ref(false)
const saving = ref(false)
const localLoading = ref(false)
const onlineAvailable = ref<boolean>()
const mode = ref<DefinitionMode>('simple')
const allMeanings = ref(false)
const savedRating = ref<WordRating>()
const previousMeaning = ref<string>()
const selectedMeaning = ref<string>()
const loadingSavedMeaning = ref(false)
let preferredMode: Promise<DefinitionMode> | undefined
const localDetails = computed(() => dictionaryMeanings(entry.value, 'detailed'))
const onlineMeanings = computed(() =>
    translation.value?.kind === 'meanings' ? translation.value.meanings : [],
)
const contextMatch = computed(() => (props.source.context ? onlineMeanings.value[0]?.text : undefined))
const contextMatchId = useId()
const localMeanings = computed(() => [
    ...new Set(dictionaryMeanings(entry.value, 'simple').map((text) => text.slice(0, 300))),
])
const choices = computed(() => {
    const options: { text: string; partOfSpeech?: string }[] = onlineMeanings.value.length
        ? [...onlineMeanings.value]
        : localMeanings.value.map((text) => ({ text }))
    const saved = previousMeaning.value
    if (saved && !options.some(({ text }) => text === saved)) options.push({ text: saved })
    return options
})
const chosenMeaning = computed(() => selectedMeaning.value ?? previousMeaning.value ?? choices.value[0]?.text)
const previewCount = 4
const hasMore = computed(() => !onlineMeanings.value.length && choices.value.length > previewCount)
const visibleMeanings = computed(() => {
    if (!hasMore.value || allMeanings.value) return choices.value
    const preview = choices.value.slice(0, previewCount)
    if (preview.some(({ text }) => text === chosenMeaning.value)) return preview
    const selected = choices.value.find(({ text }) => text === chosenMeaning.value)
    if (selected) preview[preview.length - 1] = selected
    return preview
})
let generation = 0
let translationRequest: AbortController | undefined
const passage = computed(() => translation.value?.kind === 'text' || isPassageSelection(props.text))
const canSave = computed(() => props.text.length <= 200 && !passage.value)
const lookingUp = computed(() => onlineAvailable.value === undefined || busy.value)
watch(
    () => props.rating,
    () => {
        savedRating.value = undefined
    },
)

function cancel() {
    translationRequest?.abort()
    translationRequest = undefined
    busy.value = false
}
watch(
    () => ({ text: props.text, source: props.source }),
    async ({ text, source }) => {
        cancel()
        const current = ++generation
        entry.value = null
        translation.value = undefined
        status.value = ''
        error.value = ''
        translationError.value = ''
        localError.value = ''
        onlineAvailable.value = undefined
        localLoading.value = canSave.value
        allMeanings.value = false
        savedRating.value = undefined
        selectedMeaning.value = undefined
        previousMeaning.value = props.savedMeaning
        loadingSavedMeaning.value = canSave.value && props.saveSource
        if (loadingSavedMeaning.value) {
            void request('encounterMeaning', { text, source })
                .then((saved) => {
                    if (current === generation) previousMeaning.value = saved
                })
                .catch(() => undefined)
                .finally(() => {
                    if (current === generation) loadingSavedMeaning.value = false
                })
        }
        preferredMode ??= request('definitionMode').catch(() => 'simple')
        void preferredMode.then((preference) => {
            if (current === generation) mode.value = preference
        })
        if (canSave.value) {
            void request('lookup', text)
                .then((result) => {
                    if (current === generation) entry.value = result
                })
                .catch((reason: unknown) => {
                    if (current === generation) localError.value = errorMessage(reason)
                })
                .finally(() => {
                    if (current === generation) localLoading.value = false
                })
        }
        try {
            const available = await request('translationAvailable')
            if (current === generation) {
                onlineAvailable.value = available
                if (available) void translate()
            }
        } catch (reason) {
            if (current === generation) {
                onlineAvailable.value = false
                translationError.value = errorMessage(reason)
            }
        }
    },
    { immediate: true },
)

async function save(rating: WordRating) {
    if (saving.value) return
    const current = generation
    const meaning = chosenMeaning.value
    saving.value = true
    try {
        await request('saveWord', {
            text: props.text,
            ...rating,
            source: props.saveSource ? props.source : undefined,
            meaning,
        })
        emit('saved')
        if (current !== generation) return
        savedRating.value = rating
        previousMeaning.value = meaning
        status.value = t('card.saved', { rating: ratingLabel(rating) })
        error.value = ''
    } catch (reason) {
        if (current === generation) error.value = errorMessage(reason)
    } finally {
        saving.value = false
    }
}
function toggleMode() {
    mode.value = mode.value === 'simple' ? 'detailed' : 'simple'
}
async function translate() {
    cancel()
    const controller = new AbortController()
    translationRequest = controller
    busy.value = true
    translationError.value = ''
    try {
        const result = await translateSelection(
            { text: props.text, context: props.source.context },
            controller.signal,
        )
        if (translationRequest === controller) {
            translation.value = result
            if (
                result.kind === 'meanings' &&
                !result.meanings.some(({ text }) => text === selectedMeaning.value)
            )
                selectedMeaning.value = undefined
        }
    } catch (reason) {
        if (translationRequest === controller) translationError.value = errorMessage(reason)
    } finally {
        if (translationRequest === controller) {
            busy.value = false
            translationRequest = undefined
        }
    }
}
function cancelByUser() {
    cancel()
    status.value = t('translation.cancelled')
}
async function openSettings() {
    try {
        await request('openTranslationSettings')
    } catch (reason) {
        error.value = errorMessage(reason)
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
    <section class="word-card" :aria-label="passage ? t('card.passageLabel') : t('card.label', { text })">
        <header class="card-toolbar">
            <button
                type="button"
                class="icon-button"
                :aria-label="t('card.speak')"
                :title="t('card.speak')"
                @click="speak"
            >
                <Volume2 :size="16" />
            </button>
            <h2 :title="text">{{ text }}</h2>
            <div class="card-actions">
                <button v-if="!passage" type="button" class="quiet detail-toggle" @click="toggleMode">
                    {{ mode === 'simple' ? t('card.detailed') : t('card.simple') }}
                </button>
                <SpotlightButton
                    v-if="spotlight"
                    :enabled="spotlight.enabled"
                    :set-enabled="spotlight.setEnabled"
                />
                <button
                    type="button"
                    class="icon-button"
                    :aria-label="t('card.close')"
                    :title="t('card.close')"
                    @click="emit('close')"
                >
                    <X :size="17" />
                </button>
            </div>
        </header>
        <div class="word-card-content" aria-live="polite">
            <p v-if="!passage && mode === 'detailed' && entry?.phonetic" class="word-pronunciation">
                {{ entry.phonetic }}
            </p>
            <p v-if="lookingUp" class="definition muted" role="status">
                {{ passage ? t('card.translating') : t('card.lookingUp') }}
            </p>
            <p v-else-if="translation?.kind === 'text'" class="definition translation">
                {{ translation.text }}
            </p>
            <p v-else-if="localLoading && !onlineMeanings.length" class="definition muted" role="status">
                {{ t('card.localLoading') }}
            </p>
            <template v-else-if="choices.length">
                <p v-if="!onlineMeanings.length && localMeanings.length" class="muted small">
                    {{ t('card.localDictionary') }}
                </p>
                <div class="meaning-options" role="group" :aria-label="t('card.choices')">
                    <span v-if="contextMatch" :id="contextMatchId" hidden>{{ t('card.bestMatch') }}</span>
                    <button
                        v-for="meaning in visibleMeanings"
                        :key="meaning.text"
                        type="button"
                        class="meaning-option"
                        :aria-pressed="meaning.text === chosenMeaning"
                        :aria-describedby="meaning.text === contextMatch ? contextMatchId : undefined"
                        :disabled="saving || loadingSavedMeaning"
                        @click="selectedMeaning = meaning.text"
                    >
                        <span>{{ meaning.text }}</span>
                        <small v-if="mode === 'detailed' && meaning.partOfSpeech" class="muted">
                            {{ meaning.partOfSpeech }}
                        </small>
                        <span
                            v-if="meaning.text === contextMatch"
                            class="context-match"
                            :title="t('card.bestMatch')"
                            aria-hidden="true"
                        >
                            <Sparkles :size="13" />
                        </span>
                    </button>
                    <button
                        v-if="hasMore"
                        type="button"
                        class="quiet more-meanings"
                        :aria-expanded="allMeanings"
                        @click="allMeanings = !allMeanings"
                    >
                        {{
                            allMeanings
                                ? t('card.showLess')
                                : t('card.showMore', { count: choices.length - previewCount })
                        }}
                    </button>
                </div>
                <p
                    v-if="mode === 'detailed' && !onlineMeanings.length && localDetails.length"
                    class="definition muted small"
                >
                    {{ localDetails.join('\n') }}
                </p>
            </template>
            <p v-else-if="!onlineAvailable && passage" class="muted">{{ t('card.configureForPassage') }}</p>
            <p v-else-if="!passage" class="definition muted">{{ localError || t('card.localMissing') }}</p>
            <blockquote v-if="!passage && mode === 'detailed' && source.context">
                {{ source.context }}
            </blockquote>
            <p v-if="translationError" role="alert" class="error small">{{ translationError }}</p>
            <p v-if="error" role="alert" class="error small">{{ error }}</p>
        </div>
        <footer class="card-footer">
            <WordRatingControls
                v-if="canSave"
                :word="text"
                :rating="savedRating ?? rating"
                :busy="saving || lookingUp || loadingSavedMeaning || (localLoading && !onlineMeanings.length)"
                @rate="save"
            />
            <button
                v-if="busy"
                type="button"
                class="quiet online-lookup"
                :aria-label="t('card.cancelTranslation')"
                @click="cancelByUser"
            >
                {{ t('common.cancel') }}
            </button>
            <button
                v-else-if="onlineAvailable === false"
                type="button"
                class="quiet online-lookup"
                @click="openSettings"
            >
                {{ t('common.settings') }}
            </button>
            <button
                v-else-if="onlineAvailable && !translation"
                type="button"
                class="quiet online-lookup"
                @click="translate"
            >
                {{ t('card.retry') }}
            </button>
        </footer>
        <span class="reading-announcement" role="status">{{ status }}</span>
    </section>
</template>
