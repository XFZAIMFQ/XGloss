<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { errorMessage, type DictionaryEntry, type WordSource, type WordState } from '../domain/models'
import { request } from '../platform/messages'
import { X, Volume2, BookmarkPlus, Check, EyeOff, Sparkles } from '@lucide/vue'

const props = defineProps<{ text: string; source: WordSource }>()
const emit = defineEmits<{ saved: []; close: [] }>()
const entry = ref<DictionaryEntry | null>(null)
const translation = ref('')
const status = ref('')
const error = ref('')
const busy = ref(false)
let generation = 0
let translationId = ''
const canSave = computed(() => props.text.length <= 200)

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
        try {
            const result = text.length <= 200 ? await request('lookup', text) : null
            if (current === generation) entry.value = result
        } catch (reason) {
            if (current === generation) error.value = errorMessage(reason)
        }
    },
    { immediate: true },
)

async function save(state: WordState) {
    const current = generation
    try {
        await request('saveWord', { text: props.text, state, source: props.source })
        emit('saved')
        if (current !== generation) return
        status.value = state === 'known' ? '已标记掌握' : state === 'ignored' ? '已忽略' : '已加入本地词库'
        error.value = ''
    } catch (reason) {
        if (current === generation) error.value = errorMessage(reason)
    }
}
async function translate() {
    cancel()
    const id = crypto.randomUUID()
    translationId = id
    busy.value = true
    error.value = ''
    try {
        const result = await request('translate', { text: props.text, context: props.source.context }, id)
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
    <section class="word-card">
        <div class="card-toolbar">
            <span>XGloss · 英语 → 中文</span>
            <button class="icon-button" aria-label="关闭词卡" @click="emit('close')"><X :size="18" /></button>
        </div>
        <h2>{{ text }}</h2>
        <div class="word-pronunciation">
            <span>{{ entry?.phonetic }}</span>
            <button class="icon-button" aria-label="朗读" @click="speak"><Volume2 :size="19" /></button>
        </div>
        <p class="definition">
            {{ entry?.translation || entry?.definition || '本地词典暂无此词，可查询在线语境释义。' }}
        </p>
        <blockquote v-if="source.context">{{ source.context }}</blockquote>
        <div v-if="canSave" class="card-state-actions">
            <button class="primary" @click="save('learning')">
                <BookmarkPlus :size="15" />
                加入生词
            </button>
            <button @click="save('known')">
                <Check :size="15" />
                已掌握
            </button>
            <button class="quiet" @click="save('ignored')">
                <EyeOff :size="15" />
                忽略
            </button>
        </div>
        <button v-if="!busy" class="online-lookup" @click="translate">
            <Sparkles :size="15" />
            在线语境释义
        </button>
        <button v-else class="online-lookup" @click="cancel">
            <X :size="15" />
            取消翻译
        </button>
        <p v-if="translation" class="definition translation">{{ translation }}</p>
        <p v-if="status" role="status" class="success small">{{ status }}</p>
        <p v-if="error" role="alert" class="error small">{{ error }}</p>
    </section>
</template>
