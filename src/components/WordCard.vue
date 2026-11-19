<script setup lang="ts">
import { t } from '../i18n'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import {
    defaultTranslationSettings,
    errorMessage,
    sourceLanguageSchema,
    type DefinitionMode,
    type DictionaryEntry,
    type SourceLanguage,
    type TranslationLanguages,
    type TranslationResult,
    type WordRating,
    type WordSource,
} from '../domain/models'
import {
    sourceLanguageOptions,
    sourceLanguageShort,
    targetLanguageFlag,
    targetLanguageOptions,
    targetLanguageShort,
} from '../domain/collections'
import { onReadingChanged, request, translateSelection } from '../platform/messages'
import { dictionaryMeanings, isPassageSelection } from '../domain/definitions'
import { ratingLabel } from '../domain/vocabulary'
import ShadcnSelect, { type SelectOption } from './ShadcnSelect.vue'
import WordRatingControls from './WordRatingControls.vue'
import SpotlightButton from './SpotlightButton.vue'
import { ChevronDown, Sparkles, Volume2, X } from '@lucide/vue'

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
const defaultLanguages = ref<TranslationLanguages>({
    sourceLanguage: 'auto',
    targetLanguage: defaultTranslationSettings.targetLanguage,
})
const overrideLanguages = ref<TranslationLanguages>()
const langPopoverOpen = ref(false)
const langCapsuleWrap = ref<HTMLElement>()
let preferredMode: Promise<DefinitionMode> | undefined
let unsubscribeReading: (() => void) | undefined
const effectiveSource = computed<SourceLanguage>(
    () => overrideLanguages.value?.sourceLanguage ?? defaultLanguages.value.sourceLanguage,
)
const effectiveTarget = computed(
    () => overrideLanguages.value?.targetLanguage ?? defaultLanguages.value.targetLanguage,
)
const languagePairLabel = computed(
    () => `${sourceLanguageShort(effectiveSource.value)} → ${targetLanguageShort(effectiveTarget.value)}`,
)
const sourceSelectOptions: readonly SelectOption[] = sourceLanguageOptions.map((option) => ({
    value: option.code,
    label: option.label,
    flag: option.flag,
}))
const targetSelectOptions = computed<SelectOption[]>(() => {
    const base: SelectOption[] = targetLanguageOptions.map((option) => ({
        value: option.value,
        label: option.label,
        flag: option.flag,
    }))
    const current = effectiveTarget.value.trim()
    if (current && !base.some((option) => option.value === current)) {
        base.unshift({
            value: current,
            label: current,
            flag: targetLanguageFlag(current) ?? null,
        })
    }
    return base
})
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
        overrideLanguages.value = undefined
        langPopoverOpen.value = false
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
            overrideLanguages.value
                ? {
                      text: props.text,
                      context: props.source.context,
                      sourceLanguage: overrideLanguages.value.sourceLanguage,
                      targetLanguage: overrideLanguages.value.targetLanguage,
                  }
                : { text: props.text, context: props.source.context },
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
async function loadTranslationLanguages() {
    try {
        defaultLanguages.value = await request('translationLanguages')
    } catch {
        // Keep existing defaults if background is temporarily unavailable.
    }
}
function changeCardSource(next: string) {
    const parsed = sourceLanguageSchema.safeParse(next)
    if (!parsed.success) return
    overrideLanguages.value = {
        sourceLanguage: parsed.data,
        targetLanguage: effectiveTarget.value,
    }
    if (onlineAvailable.value) void translate()
}
function changeCardTarget(next: string) {
    const trimmed = next.trim()
    if (!trimmed) return
    overrideLanguages.value = {
        sourceLanguage: effectiveSource.value,
        targetLanguage: trimmed,
    }
    if (onlineAvailable.value) void translate()
}
function onOutsideLangPointerDown(event: PointerEvent) {
    if (!langPopoverOpen.value || !langCapsuleWrap.value) return
    if (!event.composedPath().includes(langCapsuleWrap.value)) langPopoverOpen.value = false
}
function onLangEscape(event: KeyboardEvent) {
    if (!langPopoverOpen.value || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (langCapsuleWrap.value?.querySelector('[role="listbox"]')) return
    langPopoverOpen.value = false
}
onMounted(() => {
    void loadTranslationLanguages()
    unsubscribeReading = onReadingChanged((change) => {
        if (change === 'translationLanguages') void loadTranslationLanguages()
    })
    document.addEventListener('pointerdown', onOutsideLangPointerDown, { capture: true })
    document.addEventListener('keydown', onLangEscape, { capture: true })
})
onBeforeUnmount(() => {
    generation++
    cancel()
    unsubscribeReading?.()
    document.removeEventListener('pointerdown', onOutsideLangPointerDown, { capture: true })
    document.removeEventListener('keydown', onLangEscape, { capture: true })
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
            <div class="card-footer-right">
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
                <div ref="langCapsuleWrap" class="lang-capsule-wrap">
                    <button
                        type="button"
                        class="lang-capsule-button"
                        :aria-expanded="langPopoverOpen"
                        aria-haspopup="dialog"
                        :aria-label="t('card.languagePair')"
                        @click.stop="langPopoverOpen = !langPopoverOpen"
                    >
                        <span>{{ languagePairLabel }}</span>
                        <ChevronDown :size="11" />
                    </button>
                    <div
                        v-if="langPopoverOpen"
                        class="wordcard-lang-popover"
                        role="dialog"
                        :aria-label="t('card.languagePair')"
                    >
                        <div class="wordcard-lang-field">
                            <span>{{ t('card.sourceLanguage') }}</span>
                            <ShadcnSelect
                                :model-value="effectiveSource"
                                :options="sourceSelectOptions"
                                size="sm"
                                placement="auto"
                                :aria-label="t('card.sourceLanguage')"
                                @update:model-value="changeCardSource"
                            />
                        </div>
                        <div class="wordcard-lang-field">
                            <span>{{ t('card.targetLanguage') }}</span>
                            <ShadcnSelect
                                :model-value="effectiveTarget"
                                :options="targetSelectOptions"
                                size="sm"
                                placement="auto"
                                :aria-label="t('card.targetLanguage')"
                                @update:model-value="changeCardTarget"
                            />
                        </div>
                        <p class="wordcard-lang-hint">{{ t('card.tempLanguageHint') }}</p>
                    </div>
                </div>
            </div>
        </footer>
        <span class="reading-announcement" role="status">{{ status }}</span>
    </section>
</template>
