<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { browser } from 'wxt/browser'
import {
    defaultTranslationSettings,
    definitionModeSchema,
    errorMessage,
    webAnalysisScopeSchema,
    wordbookProviderTypeSchema,
    type DefinitionMode,
    type GoogleSyncState,
    type TranslationProvider,
    type TranslationProvidersState,
    type WebAnalysisScope,
    type WordbookProfile,
    type WordbookProviderType,
} from '../../domain/models'
import { completionEndpoint, deepSeekPreset } from '../../services/openai-translation'
import { googleApiOrigin } from '../../services/google-drive-sync'
import { wordbookOrigin } from '../../services/wordbook-sync'
import { request } from '../../platform/messages'
import AppShell from '../../components/AppShell.vue'
import ShadcnSelect, { type SelectOption } from '../../components/ShadcnSelect.vue'
import {
    BookMarked,
    Check,
    Cloud,
    Copy,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    SlidersHorizontal,
    Trash2,
    X,
} from '@lucide/vue'

const state = ref<TranslationProvidersState>({
    activeId: '',
    providers: [],
    targetLanguage: defaultTranslationSettings.targetLanguage,
})
const targetLanguage = ref(defaultTranslationSettings.targetLanguage)
const status = ref('')
const error = ref('')
const modalError = ref('')
const ready = ref(false)
const testingId = ref('')
const switchingId = ref('')
const savingProvider = ref(false)
const deletingProvider = ref<TranslationProvider>()
const providerDeleting = ref(false)
const providerModalOpen = ref(false)
const editingProviderId = ref<string>()
const providerForm = reactive({
    name: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: defaultTranslationSettings.timeoutMs,
})
const definitionMode = ref<DefinitionMode>('simple')
const webAnalysisScope = ref<WebAnalysisScope>('main')
const savingMode = ref(false)
const savingScope = ref(false)
const savingTarget = ref(false)
const modeStatus = ref('')
const definitionModeOptions: readonly SelectOption[] = [
    { value: 'simple', label: t('settings.simple') },
    { value: 'detailed', label: t('settings.detailed') },
]
const webScopeOptions: readonly SelectOption[] = [
    { value: 'main', label: t('settings.webScopeMain') },
    { value: 'full', label: t('settings.webScopeFull') },
]
const wordbookTypeOptions: readonly SelectOption[] = [
    { value: 'eudic', label: t('wordbook.eudic') },
    { value: 'maimemo', label: t('wordbook.maimemo') },
]
const providers = computed(() => state.value.providers)

type SettingsSection = 'providers' | 'wordbooks' | 'sync' | 'general'
const validSections: readonly SettingsSection[] = ['providers', 'wordbooks', 'sync', 'general']
const activeSection = ref<SettingsSection>('providers')

function syncSectionFromHash() {
    const hash = location.hash.replace(/^#/, '') as SettingsSection
    activeSection.value = validSections.includes(hash) ? hash : 'providers'
}

function selectSection(section: SettingsSection) {
    activeSection.value = section
    if (location.hash !== `#${section}`) {
        history.replaceState(null, '', `#${section}`)
    }
}

const wordbooks = ref<WordbookProfile[]>([])
const wordbookStatus = ref('')
const wordbookError = ref('')
const wordbookModalOpen = ref(false)
const editingWordbookId = ref<string>()
const wordbookForm = reactive<{ name: string; type: WordbookProviderType; token: string }>({
    name: '',
    type: 'eudic',
    token: '',
})
const savingWordbook = ref(false)
const testingWordbookId = ref('')
const deletingWordbook = ref<WordbookProfile>()
const wordbookDeleting = ref(false)

const googleSync = ref<GoogleSyncState>({
    clientId: '',
    redirectUri: '',
    connected: false,
    accountEmail: '',
    lastSyncedAt: 0,
    lastSyncSummary: '',
})
const googleClientId = ref('')
const googleStatus = ref('')
const googleError = ref('')
const googleBusy = ref(false)

function applyState(next: TranslationProvidersState) {
    state.value = next
    targetLanguage.value = next.targetLanguage
}

function applyGoogleSync(next: GoogleSyncState) {
    googleSync.value = next
    googleClientId.value = next.clientId
}

onMounted(async () => {
    syncSectionFromHash()
    window.addEventListener('hashchange', syncSectionFromHash)
    try {
        const [providerState, mode, scope, profiles, syncState] = await Promise.all([
            request('translationProviders'),
            request('definitionMode'),
            request('webAnalysisScope'),
            request('wordbookProfiles'),
            request('googleSyncState'),
        ])
        applyState(providerState)
        definitionMode.value = mode
        webAnalysisScope.value = scope
        wordbooks.value = profiles
        applyGoogleSync(syncState)
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        ready.value = true
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('hashchange', syncSectionFromHash)
})

function openAddProvider(preset?: 'deepseek') {
    editingProviderId.value = undefined
    providerForm.name = preset === 'deepseek' ? 'DeepSeek' : ''
    providerForm.baseUrl = preset === 'deepseek' ? deepSeekPreset.baseUrl : ''
    providerForm.apiKey = ''
    providerForm.model = preset === 'deepseek' ? deepSeekPreset.model : ''
    providerForm.timeoutMs = defaultTranslationSettings.timeoutMs
    modalError.value = ''
    providerModalOpen.value = true
}

function openEditProvider(provider: TranslationProvider) {
    editingProviderId.value = provider.id
    providerForm.name = provider.name
    providerForm.baseUrl = provider.baseUrl
    providerForm.apiKey = provider.apiKey
    providerForm.model = provider.model
    providerForm.timeoutMs = provider.timeoutMs
    modalError.value = ''
    providerModalOpen.value = true
}

function fillDeepSeekPreset() {
    try {
        if (completionEndpoint(providerForm.baseUrl).origin !== deepSeekPreset.baseUrl) {
            providerForm.apiKey = ''
        }
    } catch {
        providerForm.apiKey = ''
    }
    if (!providerForm.name.trim()) providerForm.name = 'DeepSeek'
    providerForm.baseUrl = deepSeekPreset.baseUrl
    providerForm.model = deepSeekPreset.model
}

async function authorizeAndSaveProvider(activate?: boolean): Promise<TranslationProvider | undefined> {
    modalError.value = ''
    error.value = ''
    status.value = ''
    savingProvider.value = true
    try {
        const name = providerForm.name.trim()
        if (!name) throw new Error(t('settings.providerNameRequired'))
        const endpoint = completionEndpoint(providerForm.baseUrl)
        if (!providerForm.model.trim()) throw new Error(t('settings.modelRequired'))
        const allowed = await browser.permissions.request({ origins: [`${endpoint.origin}/*`] })
        if (!allowed) throw new Error(t('settings.permissionRequired'))
        const result = await request('saveTranslationProvider', {
            id: editingProviderId.value,
            name,
            baseUrl: providerForm.baseUrl.trim(),
            apiKey: providerForm.apiKey,
            model: providerForm.model.trim(),
            timeoutMs: providerForm.timeoutMs,
            activate: activate ?? !editingProviderId.value,
        })
        applyState(result.state)
        editingProviderId.value = result.provider.id
        status.value = t('settings.saved')
        return result.provider
    } catch (reason) {
        modalError.value = errorMessage(reason)
        return undefined
    } finally {
        savingProvider.value = false
    }
}

async function submitProvider() {
    const saved = await authorizeAndSaveProvider()
    if (saved) providerModalOpen.value = false
}

async function runProviderTest(provider: TranslationProvider) {
    error.value = ''
    status.value = ''
    testingId.value = provider.id
    try {
        const endpoint = completionEndpoint(provider.baseUrl)
        const allowed = await browser.permissions.request({ origins: [`${endpoint.origin}/*`] })
        if (!allowed) throw new Error(t('settings.permissionRequired'))
        const result = await request('testTranslationProvider', provider.id)
        status.value =
            result.kind === 'meanings' ? result.meanings.map(({ text }) => text).join(' / ') : result.text
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        testingId.value = ''
    }
}

async function testFromModal() {
    const saved = await authorizeAndSaveProvider()
    if (!saved) return
    providerModalOpen.value = false
    await runProviderTest(saved)
}

async function activateProvider(provider: TranslationProvider) {
    if (state.value.activeId === provider.id || switchingId.value) return
    switchingId.value = provider.id
    error.value = ''
    status.value = ''
    try {
        const next = await request('setActiveTranslationProvider', provider.id)
        applyState(next)
        status.value = t('settings.providerSwitched', { name: provider.name })
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        switchingId.value = ''
    }
}

function openDeleteProvider(provider: TranslationProvider) {
    modalError.value = ''
    deletingProvider.value = provider
}

async function confirmDeleteProvider() {
    const target = deletingProvider.value
    if (!target || providerDeleting.value) return
    providerDeleting.value = true
    modalError.value = ''
    try {
        const next = await request('deleteTranslationProvider', target.id)
        applyState(next)
        deletingProvider.value = undefined
        status.value = t('settings.providerDeleted', { name: target.name })
        error.value = ''
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        providerDeleting.value = false
    }
}

async function saveDefaultTargetLanguage() {
    savingTarget.value = true
    modeStatus.value = ''
    error.value = ''
    try {
        const next = await request('saveTargetLanguage', targetLanguage.value.trim())
        applyState(next)
        modeStatus.value = t('settings.targetLanguageSaved')
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        savingTarget.value = false
    }
}

async function updateDefinitionMode(nextValue: string) {
    savingMode.value = true
    modeStatus.value = ''
    error.value = ''
    try {
        const mode = definitionModeSchema.parse(nextValue)
        await request('saveDefinitionMode', mode)
        definitionMode.value = mode
        modeStatus.value = t('settings.modeSaved')
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        savingMode.value = false
    }
}

async function updateWebAnalysisScope(nextValue: string) {
    savingScope.value = true
    modeStatus.value = ''
    error.value = ''
    try {
        const scope = webAnalysisScopeSchema.parse(nextValue)
        await request('setWebAnalysisScope', scope)
        webAnalysisScope.value = scope
        modeStatus.value = t('settings.webScopeSaved')
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        savingScope.value = false
    }
}

function wordbookTypeLabel(type: WordbookProviderType): string {
    return type === 'maimemo' ? t('wordbook.maimemo') : t('wordbook.eudic')
}

function openAddWordbook() {
    editingWordbookId.value = undefined
    wordbookForm.name = ''
    wordbookForm.type = 'eudic'
    wordbookForm.token = ''
    modalError.value = ''
    wordbookModalOpen.value = true
}

function openEditWordbook(profile: WordbookProfile) {
    editingWordbookId.value = profile.id
    wordbookForm.name = profile.name
    wordbookForm.type = profile.type
    wordbookForm.token = profile.token
    modalError.value = ''
    wordbookModalOpen.value = true
}

function openDeleteWordbook(profile: WordbookProfile) {
    modalError.value = ''
    deletingWordbook.value = profile
}

function updateWordbookType(next: string) {
    wordbookForm.type = wordbookProviderTypeSchema.parse(next)
}

async function submitWordbook() {
    if (savingWordbook.value) return
    modalError.value = ''
    wordbookError.value = ''
    wordbookStatus.value = ''
    savingWordbook.value = true
    try {
        const name = wordbookForm.name.trim()
        const token = wordbookForm.token.trim()
        if (!name) throw new Error(t('wordbook.nameRequired'))
        if (!token) throw new Error(t('wordbook.tokenRequired'))
        const allowed = await browser.permissions.request({
            origins: [`${wordbookOrigin(wordbookForm.type)}/*`],
        })
        if (!allowed) throw new Error(t('wordbook.permissionRequired'))
        const result = await request('saveWordbookProfile', {
            id: editingWordbookId.value,
            name,
            type: wordbookForm.type,
            token,
        })
        wordbooks.value = result.profiles
        wordbookModalOpen.value = false
        wordbookStatus.value = t('wordbook.saved')
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        savingWordbook.value = false
    }
}

async function testWordbook(profile: WordbookProfile) {
    if (testingWordbookId.value) return
    wordbookError.value = ''
    wordbookStatus.value = ''
    testingWordbookId.value = profile.id
    try {
        const allowed = await browser.permissions.request({
            origins: [`${wordbookOrigin(profile.type)}/*`],
        })
        if (!allowed) throw new Error(t('wordbook.permissionRequired'))
        const result = await request('testWordbookProfile', profile.id)
        wordbookStatus.value = t('wordbook.testSuccess', { count: result.count })
    } catch (reason) {
        wordbookError.value = errorMessage(reason)
    } finally {
        testingWordbookId.value = ''
    }
}

async function confirmDeleteWordbook() {
    const target = deletingWordbook.value
    if (!target || wordbookDeleting.value) return
    wordbookDeleting.value = true
    modalError.value = ''
    try {
        wordbooks.value = await request('deleteWordbookProfile', target.id)
        deletingWordbook.value = undefined
        wordbookStatus.value = t('wordbook.deleted', { name: target.name })
        wordbookError.value = ''
    } catch (reason) {
        modalError.value = errorMessage(reason)
    } finally {
        wordbookDeleting.value = false
    }
}

async function saveGoogleClientId() {
    googleBusy.value = true
    googleError.value = ''
    googleStatus.value = ''
    try {
        const next = await request('saveGoogleClientId', googleClientId.value.trim())
        applyGoogleSync(next)
        googleStatus.value = t('sync.clientIdSaved')
    } catch (reason) {
        googleError.value = errorMessage(reason)
    } finally {
        googleBusy.value = false
    }
}

async function copyRedirectUri() {
    if (!googleSync.value.redirectUri) return
    try {
        await navigator.clipboard.writeText(googleSync.value.redirectUri)
        googleStatus.value = t('sync.copiedRedirect')
        googleError.value = ''
    } catch (reason) {
        googleError.value = errorMessage(reason)
    }
}

async function connectGoogle() {
    googleBusy.value = true
    googleError.value = ''
    googleStatus.value = ''
    try {
        const trimmed = googleClientId.value.trim()
        if (!trimmed) throw new Error(t('sync.clientIdRequired'))
        if (trimmed !== googleSync.value.clientId) {
            applyGoogleSync(await request('saveGoogleClientId', trimmed))
        }
        const allowed = await browser.permissions.request({ origins: [`${googleApiOrigin}/*`] })
        if (!allowed) throw new Error(t('sync.permissionRequired'))
        const next = await request('connectGoogleSync')
        applyGoogleSync(next)
        googleStatus.value = next.accountEmail
            ? t('sync.connectedAs', { email: next.accountEmail })
            : t('sync.connectedNoEmail')
    } catch (reason) {
        googleError.value = errorMessage(reason)
    } finally {
        googleBusy.value = false
    }
}

async function disconnectGoogle() {
    googleBusy.value = true
    googleError.value = ''
    googleStatus.value = ''
    try {
        applyGoogleSync(await request('disconnectGoogleSync'))
        googleStatus.value = t('sync.disconnected')
    } catch (reason) {
        googleError.value = errorMessage(reason)
    } finally {
        googleBusy.value = false
    }
}

async function syncGoogleNow() {
    googleBusy.value = true
    googleError.value = ''
    googleStatus.value = ''
    try {
        const trimmed = googleClientId.value.trim()
        if (!trimmed) throw new Error(t('sync.clientIdRequired'))
        if (trimmed !== googleSync.value.clientId) {
            applyGoogleSync(await request('saveGoogleClientId', trimmed))
        }
        const allowed = await browser.permissions.request({ origins: [`${googleApiOrigin}/*`] })
        if (!allowed) throw new Error(t('sync.permissionRequired'))
        const result = await request('runGoogleSync')
        applyGoogleSync(result.state)
        googleStatus.value = result.state.lastSyncSummary
    } catch (reason) {
        googleError.value = errorMessage(reason)
    } finally {
        googleBusy.value = false
    }
}

function formatSyncTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString()
}
</script>

<template>
    <AppShell active="settings">
        <template #header>
            <h1>{{ t('common.settings') }}</h1>
            <span class="header-hint-badge">{{ t('settings.localCredentialsHint') }}</span>
        </template>
        <div class="page-heading">
            <p>{{ t('settings.intro') }}</p>
        </div>
        <p v-if="!ready" role="status">{{ t('settings.loading') }}</p>
        <div v-else class="settings-shell">
            <nav class="settings-subnav" :aria-label="t('settings.navLabel')">
                <button
                    type="button"
                    class="settings-subnav-item"
                    :class="{ active: activeSection === 'providers' }"
                    :aria-current="activeSection === 'providers' ? 'page' : undefined"
                    @click="selectSection('providers')"
                >
                    <span class="settings-subnav-label">
                        <SlidersHorizontal :size="15" />
                        {{ t('settings.navProviders') }}
                    </span>
                    <span class="subnav-count">{{ providers.length }}</span>
                </button>
                <button
                    type="button"
                    class="settings-subnav-item"
                    :class="{ active: activeSection === 'wordbooks' }"
                    :aria-current="activeSection === 'wordbooks' ? 'page' : undefined"
                    @click="selectSection('wordbooks')"
                >
                    <span class="settings-subnav-label">
                        <BookMarked :size="15" />
                        {{ t('settings.navWordbooks') }}
                    </span>
                    <span class="subnav-count">{{ wordbooks.length }}</span>
                </button>
                <button
                    type="button"
                    class="settings-subnav-item"
                    :class="{ active: activeSection === 'sync' }"
                    :aria-current="activeSection === 'sync' ? 'page' : undefined"
                    @click="selectSection('sync')"
                >
                    <span class="settings-subnav-label">
                        <Cloud :size="15" />
                        {{ t('settings.navSync') }}
                    </span>
                    <span v-if="googleSync.connected" class="subnav-dot" />
                </button>
                <button
                    type="button"
                    class="settings-subnav-item"
                    :class="{ active: activeSection === 'general' }"
                    :aria-current="activeSection === 'general' ? 'page' : undefined"
                    @click="selectSection('general')"
                >
                    <span class="settings-subnav-label">
                        <Check :size="15" />
                        {{ t('settings.navGeneral') }}
                    </span>
                </button>
            </nav>

            <div class="settings-pane">
                <section v-if="activeSection === 'providers'" class="settings-pane-section">
                    <div class="settings-pane-header">
                        <div>
                            <h2>{{ t('settings.apiHeading') }}</h2>
                            <p class="muted small">{{ t('settings.compatible') }}</p>
                        </div>
                        <div class="row" style="margin: 0">
                            <button type="button" @click="openAddProvider('deepseek')">
                                {{ t('settings.deepSeekPreset') }}
                            </button>
                            <button type="button" class="primary" @click="openAddProvider()">
                                <Plus :size="15" />
                                {{ t('settings.addProvider') }}
                            </button>
                        </div>
                    </div>

                    <div v-if="!providers.length" class="provider-empty">
                        <strong>{{ t('settings.emptyProviders') }}</strong>
                        <p class="muted small">{{ t('settings.emptyProvidersHint') }}</p>
                    </div>

                    <div v-else class="provider-grid">
                        <article
                            v-for="provider in providers"
                            :key="provider.id"
                            class="provider-card"
                            :class="{ 'is-active': state.activeId === provider.id }"
                        >
                            <div class="provider-card-top">
                                <div class="provider-title-row">
                                    <h3>{{ provider.name }}</h3>
                                    <span v-if="state.activeId === provider.id" class="active-badge">
                                        <Check :size="12" />
                                        {{ t('settings.activeProvider') }}
                                    </span>
                                </div>
                                <div class="card-actions-group">
                                    <button
                                        type="button"
                                        class="icon-button"
                                        :aria-label="t('settings.editProvider')"
                                        :title="t('settings.editProvider')"
                                        @click="openEditProvider(provider)"
                                    >
                                        <Pencil :size="14" />
                                    </button>
                                    <button
                                        type="button"
                                        class="icon-button"
                                        :aria-label="t('settings.deleteProvider')"
                                        :title="t('settings.deleteProvider')"
                                        @click="openDeleteProvider(provider)"
                                    >
                                        <Trash2 :size="14" />
                                    </button>
                                </div>
                            </div>

                            <dl class="provider-meta">
                                <div>
                                    <dt>{{ t('settings.model') }}</dt>
                                    <dd>{{ provider.model }}</dd>
                                </div>
                                <div>
                                    <dt>{{ t('settings.baseUrl') }}</dt>
                                    <dd :title="provider.baseUrl">{{ provider.baseUrl }}</dd>
                                </div>
                            </dl>

                            <div class="provider-card-actions">
                                <button
                                    v-if="state.activeId !== provider.id"
                                    type="button"
                                    class="primary"
                                    :disabled="switchingId === provider.id"
                                    @click="activateProvider(provider)"
                                >
                                    {{ t('settings.setActive') }}
                                </button>
                                <button
                                    type="button"
                                    :disabled="testingId === provider.id"
                                    @click="runProviderTest(provider)"
                                >
                                    <Play :size="13" />
                                    {{
                                        testingId === provider.id ? t('settings.testing') : t('settings.test')
                                    }}
                                </button>
                            </div>
                        </article>
                    </div>

                    <p v-if="status" role="status" class="success definition">{{ status }}</p>
                    <p v-if="error" role="alert" class="error">{{ error }}</p>
                </section>

                <section v-else-if="activeSection === 'wordbooks'" class="settings-pane-section">
                    <div class="settings-pane-header">
                        <div>
                            <h2>{{ t('wordbook.heading') }}</h2>
                            <p class="muted small">{{ t('wordbook.intro') }}</p>
                        </div>
                        <button type="button" class="primary" @click="openAddWordbook">
                            <Plus :size="15" />
                            {{ t('wordbook.addProfile') }}
                        </button>
                    </div>

                    <div v-if="!wordbooks.length" class="provider-empty">
                        <strong>{{ t('wordbook.empty') }}</strong>
                        <p class="muted small">{{ t('wordbook.emptyHint') }}</p>
                    </div>

                    <div v-else class="provider-grid">
                        <article v-for="profile in wordbooks" :key="profile.id" class="provider-card">
                            <div class="provider-card-top">
                                <div class="provider-title-row">
                                    <h3>{{ profile.name }}</h3>
                                    <span class="provider-type-badge">
                                        {{ wordbookTypeLabel(profile.type) }}
                                    </span>
                                </div>
                                <div class="card-actions-group">
                                    <button
                                        type="button"
                                        class="icon-button"
                                        :aria-label="t('wordbook.editProfile')"
                                        :title="t('wordbook.editProfile')"
                                        @click="openEditWordbook(profile)"
                                    >
                                        <Pencil :size="14" />
                                    </button>
                                    <button
                                        type="button"
                                        class="icon-button"
                                        :aria-label="t('wordbook.deleteProfile')"
                                        :title="t('wordbook.deleteProfile')"
                                        @click="openDeleteWordbook(profile)"
                                    >
                                        <Trash2 :size="14" />
                                    </button>
                                </div>
                            </div>

                            <div class="provider-card-actions">
                                <button
                                    type="button"
                                    :disabled="testingWordbookId === profile.id"
                                    @click="testWordbook(profile)"
                                >
                                    <Play :size="13" />
                                    {{
                                        testingWordbookId === profile.id
                                            ? t('wordbook.testing')
                                            : t('wordbook.test')
                                    }}
                                </button>
                            </div>
                        </article>
                    </div>

                    <p v-if="wordbookStatus" role="status" class="success">{{ wordbookStatus }}</p>
                    <p v-if="wordbookError" role="alert" class="error">{{ wordbookError }}</p>
                </section>

                <section v-else-if="activeSection === 'sync'" class="settings-pane-section">
                    <div class="settings-pane-header">
                        <div>
                            <h2>{{ t('sync.heading') }}</h2>
                            <p class="muted small">{{ t('sync.intro') }}</p>
                        </div>
                        <span class="sync-status-badge" :class="{ connected: googleSync.connected }">
                            {{
                                googleSync.connected
                                    ? googleSync.accountEmail
                                        ? t('sync.connectedAs', { email: googleSync.accountEmail })
                                        : t('sync.connectedNoEmail')
                                    : t('sync.notConnected')
                            }}
                        </span>
                    </div>

                    <div class="panel settings-card">
                        <form class="field" style="margin-top: 0" @submit.prevent="saveGoogleClientId">
                            <label for="google-client-id">{{ t('sync.clientId') }}</label>
                            <div class="copy-row">
                                <input
                                    id="google-client-id"
                                    v-model="googleClientId"
                                    :placeholder="t('sync.clientIdPlaceholder')"
                                    maxlength="300"
                                />
                                <button type="submit" :disabled="googleBusy">
                                    {{ t('sync.saveClientId') }}
                                </button>
                            </div>
                            <small class="muted">{{ t('sync.clientIdHelp') }}</small>
                        </form>

                        <div v-if="googleSync.redirectUri" class="field">
                            <span>{{ t('sync.redirectUri') }}</span>
                            <div class="copy-row">
                                <input :value="googleSync.redirectUri" readonly />
                                <button type="button" @click="copyRedirectUri">
                                    <Copy :size="14" />
                                    {{ t('sync.copyRedirect') }}
                                </button>
                            </div>
                        </div>

                        <div class="row between settings-card-footer">
                            <span class="muted small">
                                {{
                                    googleSync.lastSyncedAt
                                        ? t('sync.lastSynced', {
                                              time: formatSyncTime(googleSync.lastSyncedAt),
                                          })
                                        : t('sync.neverSynced')
                                }}
                            </span>
                            <div class="row" style="margin: 0">
                                <button
                                    v-if="!googleSync.connected"
                                    type="button"
                                    class="primary"
                                    :disabled="googleBusy"
                                    @click="connectGoogle"
                                >
                                    {{ googleBusy ? t('sync.connecting') : t('sync.connect') }}
                                </button>
                                <template v-else>
                                    <button type="button" :disabled="googleBusy" @click="disconnectGoogle">
                                        {{ t('sync.disconnect') }}
                                    </button>
                                    <button
                                        type="button"
                                        class="primary"
                                        :disabled="googleBusy"
                                        @click="syncGoogleNow"
                                    >
                                        <RefreshCw :size="14" />
                                        {{ googleBusy ? t('sync.syncing') : t('sync.syncNow') }}
                                    </button>
                                </template>
                            </div>
                        </div>
                    </div>

                    <p v-if="googleStatus" role="status" class="success">{{ googleStatus }}</p>
                    <p v-if="googleError" role="alert" class="error">{{ googleError }}</p>
                </section>

                <section v-else class="settings-pane-section">
                    <div class="settings-pane-header">
                        <div>
                            <h2>{{ t('settings.cardDisplay') }}</h2>
                            <p class="muted small">{{ t('settings.cardDisplayDesc') }}</p>
                        </div>
                    </div>

                    <div class="settings-split-list">
                        <div class="settings-split-row">
                            <div class="settings-split-meta">
                                <h3>{{ t('settings.targetLanguage') }}</h3>
                                <p class="muted small">{{ t('settings.targetLanguageHelp') }}</p>
                            </div>
                            <form
                                class="copy-row settings-split-control"
                                @submit.prevent="saveDefaultTargetLanguage"
                            >
                                <input
                                    v-model="targetLanguage"
                                    :aria-label="t('settings.targetLanguage')"
                                    required
                                    maxlength="100"
                                />
                                <button type="submit" :disabled="savingTarget">
                                    {{ t('settings.saveTargetLanguage') }}
                                </button>
                            </form>
                        </div>

                        <div class="settings-split-row">
                            <div class="settings-split-meta">
                                <h3>{{ t('settings.defaultMode') }}</h3>
                                <p class="muted small">{{ t('settings.defaultModeHelp') }}</p>
                            </div>
                            <div class="settings-split-control compact">
                                <ShadcnSelect
                                    :model-value="definitionMode"
                                    :options="definitionModeOptions"
                                    :disabled="savingMode"
                                    :aria-label="t('settings.defaultMode')"
                                    @update:model-value="updateDefinitionMode"
                                />
                            </div>
                        </div>

                        <div class="settings-split-row">
                            <div class="settings-split-meta">
                                <h3>{{ t('settings.webScope') }}</h3>
                                <p class="muted small">{{ t('settings.webScopeHelp') }}</p>
                            </div>
                            <div class="settings-split-control compact">
                                <ShadcnSelect
                                    :model-value="webAnalysisScope"
                                    :options="webScopeOptions"
                                    :disabled="savingScope"
                                    :aria-label="t('settings.webScope')"
                                    @update:model-value="updateWebAnalysisScope"
                                />
                            </div>
                        </div>
                    </div>

                    <p v-if="modeStatus" class="success" role="status">{{ modeStatus }}</p>
                    <p v-if="error" role="alert" class="error">{{ error }}</p>
                </section>
            </div>
        </div>

        <div v-if="providerModalOpen" class="modal-backdrop" @click.self="providerModalOpen = false">
            <form class="modal" @submit.prevent="submitProvider">
                <div class="row between" style="margin-top: 0">
                    <h2>
                        {{ editingProviderId ? t('settings.editProvider') : t('settings.addProvider') }}
                    </h2>
                    <div class="row" style="margin: 0">
                        <button type="button" @click="fillDeepSeekPreset">
                            {{ t('settings.deepSeekPreset') }}
                        </button>
                        <button
                            class="icon-button"
                            type="button"
                            :aria-label="t('settings.closeProviderModal')"
                            @click="providerModalOpen = false"
                        >
                            <X :size="18" />
                        </button>
                    </div>
                </div>
                <label class="field">
                    <span>{{ t('settings.providerName') }}</span>
                    <input
                        v-model="providerForm.name"
                        :placeholder="t('settings.providerNamePlaceholder')"
                        maxlength="80"
                        required
                        autofocus
                    />
                </label>
                <label class="field">
                    <span>{{ t('settings.baseUrl') }}</span>
                    <input v-model="providerForm.baseUrl" placeholder="https://api.example.com/v1" required />
                    <small class="muted">{{ t('settings.baseUrlHelp') }}</small>
                </label>
                <label class="field">
                    <span>{{ t('settings.apiKey') }}</span>
                    <input
                        v-model="providerForm.apiKey"
                        type="password"
                        autocomplete="off"
                        :placeholder="t('settings.keyPlaceholder')"
                    />
                    <small class="muted">{{ t('settings.keyHelp') }}</small>
                </label>
                <div class="row">
                    <label class="field" style="flex: 2; margin: 0">
                        <span>{{ t('settings.model') }}</span>
                        <input
                            v-model="providerForm.model"
                            :placeholder="t('settings.modelPlaceholder')"
                            required
                        />
                    </label>
                    <label class="field" style="flex: 1; margin: 0">
                        <span>{{ t('settings.timeout') }}</span>
                        <input
                            v-model.number="providerForm.timeoutMs"
                            type="number"
                            min="1000"
                            max="120000"
                            step="1000"
                        />
                    </label>
                </div>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer between">
                    <button type="button" :disabled="savingProvider" @click="testFromModal">
                        {{ t('settings.test') }}
                    </button>
                    <div class="row" style="margin: 0">
                        <button type="button" @click="providerModalOpen = false">
                            {{ t('common.cancel') }}
                        </button>
                        <button class="primary" type="submit" :disabled="savingProvider">
                            {{ t('settings.save') }}
                        </button>
                    </div>
                </div>
            </form>
        </div>

        <div v-if="deletingProvider" class="modal-backdrop" @click.self="deletingProvider = undefined">
            <form class="modal" @submit.prevent="confirmDeleteProvider">
                <div class="row between" style="margin-top: 0">
                    <h2>{{ t('settings.deleteProvider') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('common.cancel')"
                        @click="deletingProvider = undefined"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <p class="muted small" style="margin: 12px 0">
                    {{ t('settings.deleteProviderConfirm', { name: deletingProvider.name }) }}
                </p>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer">
                    <button type="button" @click="deletingProvider = undefined">
                        {{ t('common.cancel') }}
                    </button>
                    <button class="destructive" type="submit" :disabled="providerDeleting">
                        <Trash2 :size="14" />
                        {{ t('settings.deleteProvider') }}
                    </button>
                </div>
            </form>
        </div>

        <div v-if="wordbookModalOpen" class="modal-backdrop" @click.self="wordbookModalOpen = false">
            <form class="modal" @submit.prevent="submitWordbook">
                <div class="row between" style="margin-top: 0">
                    <h2>
                        {{ editingWordbookId ? t('wordbook.editProfile') : t('wordbook.addProfile') }}
                    </h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('wordbook.closeModal')"
                        @click="wordbookModalOpen = false"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <div class="field">
                    <span>{{ t('wordbook.provider') }}</span>
                    <ShadcnSelect
                        :model-value="wordbookForm.type"
                        :options="wordbookTypeOptions"
                        :aria-label="t('wordbook.provider')"
                        @update:model-value="updateWordbookType"
                    />
                </div>
                <label class="field">
                    <span>{{ t('wordbook.name') }}</span>
                    <input
                        v-model="wordbookForm.name"
                        :placeholder="t('wordbook.namePlaceholder')"
                        maxlength="80"
                        required
                        autofocus
                    />
                </label>
                <label class="field">
                    <span>{{ t('wordbook.token') }}</span>
                    <input
                        v-model="wordbookForm.token"
                        type="password"
                        autocomplete="off"
                        :placeholder="t('wordbook.tokenPlaceholder')"
                        maxlength="4000"
                        required
                    />
                    <small class="muted">
                        {{
                            wordbookForm.type === 'maimemo'
                                ? t('wordbook.maimemoTokenHelp')
                                : t('wordbook.eudicTokenHelp')
                        }}
                    </small>
                </label>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer">
                    <button type="button" @click="wordbookModalOpen = false">
                        {{ t('common.cancel') }}
                    </button>
                    <button class="primary" type="submit" :disabled="savingWordbook">
                        {{ t('wordbook.save') }}
                    </button>
                </div>
            </form>
        </div>

        <div v-if="deletingWordbook" class="modal-backdrop" @click.self="deletingWordbook = undefined">
            <form class="modal" @submit.prevent="confirmDeleteWordbook">
                <div class="row between" style="margin-top: 0">
                    <h2>{{ t('wordbook.deleteProfile') }}</h2>
                    <button
                        class="icon-button"
                        type="button"
                        :aria-label="t('common.cancel')"
                        @click="deletingWordbook = undefined"
                    >
                        <X :size="18" />
                    </button>
                </div>
                <p class="muted small" style="margin: 12px 0">
                    {{ t('wordbook.deleteConfirm', { name: deletingWordbook.name }) }}
                </p>
                <p v-if="modalError" class="error small" role="alert">{{ modalError }}</p>
                <div class="modal-footer">
                    <button type="button" @click="deletingWordbook = undefined">
                        {{ t('common.cancel') }}
                    </button>
                    <button class="destructive" type="submit" :disabled="wordbookDeleting">
                        <Trash2 :size="14" />
                        {{ t('wordbook.deleteProfile') }}
                    </button>
                </div>
            </form>
        </div>
    </AppShell>
</template>
