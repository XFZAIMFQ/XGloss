<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { browser } from 'wxt/browser'
import {
    defaultTranslationSettings,
    definitionModeSchema,
    errorMessage,
    type DefinitionMode,
} from '../../domain/models'
import { completionEndpoint } from '../../services/openai-translation'
import { request } from '../../platform/messages'
import AppShell from '../../components/AppShell.vue'
import { SlidersHorizontal } from '@lucide/vue'
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
        modeStatus.value = '词卡显示偏好已保存'
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
        if (!settings.model.trim()) throw new Error('请填写模型名称')
        const allowed = await browser.permissions.request({ origins: [`${endpoint.origin}/*`] })
        if (!allowed) throw new Error('需要服务来源权限才能发送翻译请求')
        await request('saveSettings', { ...settings })
        status.value = '配置已保存在本机'
        return true
    } catch (reason) {
        error.value = errorMessage(reason)
        return false
    }
}
async function test() {
    if (!(await save())) return
    busy.value = true
    try {
        status.value = await request('translate', {
            text: 'register',
            context: 'Write the value to the hardware register.',
        })
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        busy.value = false
    }
}
</script>
<template>
    <AppShell active="settings">
        <header class="page-heading">
            <div>
                <h1>翻译设置</h1>
                <p class="muted">连接你偏好的翻译来源</p>
            </div>
        </header>
        <p v-if="!ready" role="status">正在读取配置…</p>
        <form v-else class="panel settings-panel" @submit.prevent="save">
            <div class="settings-section-heading">
                <span class="settings-icon"><SlidersHorizontal :size="24" /></span>
                <div>
                    <h2>OpenAI-compatible API</h2>
                    <p class="muted small">支持云端服务与本机模型</p>
                </div>
            </div>
            <label class="field">
                <span>Base URL</span>
                <input v-model="settings.baseUrl" placeholder="https://api.example.com/v1" required />
                <small class="muted">
                    填写 API 根路径，程序自动追加 /chat/completions。本机服务可使用 http://localhost。
                </small>
            </label>
            <label class="field">
                <span>API Key</span>
                <input
                    v-model="settings.apiKey"
                    type="password"
                    autocomplete="off"
                    placeholder="本机服务可留空"
                />
                <small class="muted">
                    保存在本机扩展存储。在线查询时，选中文字及语境将发送到所配置的服务。
                </small>
            </label>
            <label class="field">
                <span>模型名称</span>
                <input v-model="settings.model" placeholder="填写服务支持的模型 ID" required />
            </label>
            <div class="row">
                <label class="field">
                    <span>目标语言</span>
                    <input v-model="settings.targetLanguage" required />
                </label>
                <label class="field">
                    <span>超时（毫秒）</span>
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
                <button class="primary" type="submit">保存并授权</button>
                <button type="button" :disabled="busy" @click="test">
                    {{ busy ? '连接中…' : '测试语境翻译' }}
                </button>
            </div>
            <p v-if="status" role="status" class="success definition">{{ status }}</p>
            <p v-if="error" role="alert" class="error">{{ error }}</p>
        </form>
        <section v-if="ready" class="panel settings-panel">
            <h2>词卡显示</h2>
            <label class="field">
                <span>默认释义</span>
                <select :value="definitionMode" :disabled="savingMode" @change="updateDefinitionMode">
                    <option value="simple">简洁</option>
                    <option value="detailed">详细（词性、音标和原句）</option>
                </select>
            </label>
            <p v-if="modeStatus" class="success" role="status">{{ modeStatus }}</p>
        </section>
    </AppShell>
</template>
