<script setup lang="ts">
import { t } from '../../i18n'
import { onMounted, reactive, ref } from 'vue'
import { browser } from 'wxt/browser'
import {
    defaultTranslationSettings,
    definitionModeSchema,
    errorMessage,
    type DefinitionMode,
} from '../../domain/models'
import { completionEndpoint, deepSeekPreset } from '../../services/openai-translation'
import { request } from '../../platform/messages'
import AppShell from '../../components/AppShell.vue'
import { SlidersHorizontal, ChevronDown } from '@lucide/vue'

const settings = reactive({ ...defaultTranslationSettings })
const status = ref('')
const error = ref('')
const busy = ref(false)
const ready = ref(false)
const definitionMode = ref<DefinitionMode>('simple')
const savingMode = ref(false)
const modeStatus = ref('')

onMounted(async () => {
    try {
        const [translation, mode] = await Promise.all([request('settings'), request('definitionMode')])
        Object.assign(settings, translation)
        definitionMode.value = mode
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        ready.value = true
    }
})

async function updateDefinitionMode(event: Event) {
    const select = event.target as HTMLSelectElement
    savingMode.value = true
    modeStatus.value = ''
    error.value = ''
    try {
        const mode = definitionModeSchema.parse(select.value)
        await request('saveDefinitionMode', mode)
        definitionMode.value = mode
        modeStatus.value = t('settings.modeSaved')
    } catch (reason) {
        select.value = definitionMode.value
        error.value = errorMessage(reason)
    } finally {
        savingMode.value = false
    }
}

async function save() {
    error.value = ''
    status.value = ''
    try {
        const endpoint = completionEndpoint(settings.baseUrl)
        if (!settings.model.trim()) throw new Error(t('settings.modelRequired'))
        const allowed = await browser.permissions.request({ origins: [`${endpoint.origin}/*`] })
        if (!allowed) throw new Error(t('settings.permissionRequired'))
        await request('saveSettings', { ...settings })
        status.value = t('settings.saved')
        return true
    } catch (reason) {
        error.value = errorMessage(reason)
        return false
    }
}

function useDeepSeek() {
    try {
        if (completionEndpoint(settings.baseUrl).origin !== deepSeekPreset.baseUrl) settings.apiKey = ''
    } catch {
        settings.apiKey = ''
    }
    Object.assign(settings, deepSeekPreset)
}

async function test() {
    if (!(await save())) return
    busy.value = true
    try {
        const result = await request('translate', {
            text: 'register',
            context: 'Write the value to the hardware register.',
        })
        status.value =
            result.kind === 'meanings' ? result.meanings.map(({ text }) => text).join(' / ') : result.text
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        busy.value = false
    }
}
</script>

<template>
    <AppShell active="settings">
        <template #header>
            <h1>{{ t('common.settings') }}</h1>
        </template>
        <div class="page-heading">
            <p>{{ t('settings.intro') }}</p>
        </div>
        <p v-if="!ready" role="status">{{ t('settings.loading') }}</p>
        <div v-else class="settings-stack">
            <form class="panel settings-panel" @submit.prevent="save">
                <div class="settings-section-heading">
                    <div class="settings-section-title">
                        <span class="settings-icon"><SlidersHorizontal :size="18" /></span>
                        <div>
                            <h2>{{ t('settings.apiHeading') }}</h2>
                            <p class="muted small">{{ t('settings.compatible') }}</p>
                        </div>
                    </div>
                    <button type="button" @click="useDeepSeek">{{ t('settings.deepSeekPreset') }}</button>
                </div>
                <label class="field">
                    <span>{{ t('settings.baseUrl') }}</span>
                    <input v-model="settings.baseUrl" placeholder="https://api.example.com/v1" required />
                    <small class="muted">
                        {{ t('settings.baseUrlHelp') }}
                    </small>
                </label>
                <label class="field">
                    <span>{{ t('settings.apiKey') }}</span>
                    <input
                        v-model="settings.apiKey"
                        type="password"
                        autocomplete="off"
                        :placeholder="t('settings.keyPlaceholder')"
                    />
                    <small class="muted">
                        {{ t('settings.keyHelp') }}
                    </small>
                </label>
                <label class="field">
                    <span>{{ t('settings.model') }}</span>
                    <input v-model="settings.model" :placeholder="t('settings.modelPlaceholder')" required />
                </label>
                <div class="row">
                    <label class="field">
                        <span>{{ t('settings.targetLanguage') }}</span>
                        <input v-model="settings.targetLanguage" required />
                    </label>
                    <label class="field">
                        <span>{{ t('settings.timeout') }}</span>
                        <input
                            v-model.number="settings.timeoutMs"
                            type="number"
                            min="1000"
                            max="120000"
                            step="1000"
                        />
                    </label>
                </div>
                <div class="row">
                    <button class="primary" type="submit">{{ t('settings.save') }}</button>
                    <button type="button" :disabled="busy" @click="test">
                        {{ busy ? t('settings.testing') : t('settings.test') }}
                    </button>
                </div>
                <p v-if="status" role="status" class="success definition">{{ status }}</p>
                <p v-if="error" role="alert" class="error">{{ error }}</p>
            </form>
            <section class="panel settings-panel">
                <h2>{{ t('settings.cardDisplay') }}</h2>
                <label class="field">
                    <span>{{ t('settings.defaultMode') }}</span>
                    <div class="select-wrap">
                        <select :value="definitionMode" :disabled="savingMode" @change="updateDefinitionMode">
                            <option value="simple">{{ t('settings.simple') }}</option>
                            <option value="detailed">{{ t('settings.detailed') }}</option>
                        </select>
                        <ChevronDown :size="14" class="select-chevron" />
                    </div>
                </label>
                <p v-if="modeStatus" class="success" role="status">{{ modeStatus }}</p>
            </section>
        </div>
    </AppShell>
</template>
