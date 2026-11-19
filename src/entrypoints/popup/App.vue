<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onMounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import {
    defaultCollectionId,
    defaultTranslationSettings,
    errorMessage,
    sourceLanguageSchema,
    type SelectionTrigger,
    type TranslationLanguages,
    type VocabularyCollection,
    type Word,
} from '../../domain/models'
import {
    sortCollections,
    sourceLanguageOptions,
    targetLanguageFlag,
    targetLanguageOptions,
    wordCollectionId,
} from '../../domain/collections'
import { request } from '../../platform/messages'
import { webHostname } from '../../platform/web-site'
import BrandLogo from '../../components/BrandLogo.vue'
import ShadcnSelect, { type SelectOption } from '../../components/ShadcnSelect.vue'
import { ArrowRight, BookOpen, FileText, Settings2, ArrowUpRight, ScanText, HardDrive } from '@lucide/vue'

const error = ref('')
const wordCount = ref(0)
const allWords = ref<Word[]>([])
const collections = ref<VocabularyCollection[]>([])
const activeCollectionId = ref(defaultCollectionId)
const selectionTrigger = ref<SelectionTrigger>('auto')
const languages = ref<TranslationLanguages>({
    sourceLanguage: 'auto',
    targetLanguage: defaultTranslationSettings.targetLanguage,
})
const currentPdf = ref('')
const siteReading = ref<{ tabId: number; site: string; enabled: boolean }>()
const updating = ref(false)
const savingPrefs = ref(false)

const triggerOptions: readonly { value: SelectionTrigger; label: string }[] = [
    { value: 'auto', label: t('popup.triggerAuto') },
    { value: 'icon', label: t('popup.triggerIcon') },
    { value: 'off', label: t('popup.triggerOff') },
]

const collectionSelectOptions = computed<SelectOption[]>(() => {
    const counts = new Map<string, number>()
    for (const word of allWords.value) {
        const cid = wordCollectionId(word)
        counts.set(cid, (counts.get(cid) ?? 0) + 1)
    }
    return sortCollections(collections.value).map((item) => ({
        value: item.id,
        label: item.name,
        flag: item.language,
        muted: String(counts.get(item.id) ?? 0),
    }))
})

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
    const current = languages.value.targetLanguage.trim()
    if (current && !base.some((option) => option.value === current)) {
        base.unshift({
            value: current,
            label: current,
            flag: targetLanguageFlag(current) ?? null,
        })
    }
    return base
})

async function ensureAttached(tabId: number) {
    const attached = await browser.tabs
        .sendMessage(tabId, { event: 'siteReadingPing' }, { frameId: 0 })
        .catch(() => false)
    if (attached !== true)
        await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/web.js'] })
}

onMounted(async () => {
    try {
        const [words, collectionList, activeId, trigger, translationLangs, [tab]] = await Promise.all([
            request('words'),
            request('collections'),
            request('activeCollection'),
            request('selectionTrigger'),
            request('translationLanguages'),
            browser.tabs.query({ active: true, currentWindow: true }),
        ])
        allWords.value = words
        wordCount.value = words.length
        collections.value = collectionList
        activeCollectionId.value = activeId
        selectionTrigger.value = trigger
        languages.value = translationLangs
        const url = tab?.url && URL.canParse(tab.url) ? new URL(tab.url) : null
        if (url && ['http:', 'https:'].includes(url.protocol) && /\.pdf$/i.test(url.pathname)) {
            currentPdf.value = url.href
            return
        }
        const site = webHostname(tab?.url)
        if (!site || tab?.id === undefined) return
        const { analysis } = await request('siteReading', tab.id)
        siteReading.value = { tabId: tab.id, site, enabled: analysis }
        if (analysis) {
            updating.value = true
            await ensureAttached(tab.id)
        }
    } catch (reason) {
        error.value = t('popup.sitePermission', { error: errorMessage(reason) })
    } finally {
        updating.value = false
    }
})

async function toggleAnalysis() {
    const current = siteReading.value
    if (!current || updating.value) return
    updating.value = true
    error.value = ''
    try {
        const enabled = !current.enabled
        await request('setSiteAnalysis', { tabId: current.tabId, site: current.site, enabled })
        current.enabled = enabled
        if (enabled) await ensureAttached(current.tabId)
    } catch (reason) {
        error.value = t('popup.sitePermission', { error: errorMessage(reason) })
    } finally {
        updating.value = false
    }
}

async function changeSelectionTrigger(next: SelectionTrigger) {
    if (selectionTrigger.value === next || savingPrefs.value) return
    const previous = selectionTrigger.value
    selectionTrigger.value = next
    savingPrefs.value = true
    error.value = ''
    try {
        await request('setSelectionTrigger', next)
    } catch (reason) {
        selectionTrigger.value = previous
        error.value = errorMessage(reason)
    } finally {
        savingPrefs.value = false
    }
}

async function changeActiveCollection(next: string) {
    if (next === activeCollectionId.value || savingPrefs.value) return
    savingPrefs.value = true
    error.value = ''
    try {
        const updated = await request('setActiveCollection', next)
        activeCollectionId.value = updated.activeCollectionId
        languages.value = updated.languages
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        savingPrefs.value = false
    }
}

async function changeSourceLanguage(next: string) {
    const parsed = sourceLanguageSchema.safeParse(next)
    if (!parsed.success || parsed.data === languages.value.sourceLanguage || savingPrefs.value) return
    const previous = languages.value
    const payload = { sourceLanguage: parsed.data, targetLanguage: previous.targetLanguage }
    languages.value = payload
    savingPrefs.value = true
    error.value = ''
    try {
        languages.value = await request('setTranslationLanguages', payload)
    } catch (reason) {
        languages.value = previous
        error.value = errorMessage(reason)
    } finally {
        savingPrefs.value = false
    }
}

async function changeTargetLanguage(next: string) {
    const trimmed = next.trim()
    if (!trimmed || trimmed === languages.value.targetLanguage || savingPrefs.value) return
    const previous = languages.value
    const payload = { sourceLanguage: previous.sourceLanguage, targetLanguage: trimmed }
    languages.value = payload
    savingPrefs.value = true
    error.value = ''
    try {
        languages.value = await request('setTranslationLanguages', payload)
    } catch (reason) {
        languages.value = previous
        error.value = errorMessage(reason)
    } finally {
        savingPrefs.value = false
    }
}

async function open(page: '/reader.html' | '/library.html' | '/options.html') {
    try {
        const url = new URL(browser.runtime.getURL(page))
        if (page === '/reader.html' && currentPdf.value) url.searchParams.set('url', currentPdf.value)
        await browser.tabs.create({ url: url.href })
        window.close()
    } catch (reason) {
        error.value = errorMessage(reason)
    }
}
</script>

<template>
    <main class="popup">
        <header class="popup-header">
            <div class="popup-brand-block">
                <a class="popup-brand" href="library.html" @click.prevent="open('/library.html')">
                    <BrandLogo :size="26" />
                    <span class="brand-title">XGloss</span>
                </a>
                <p class="popup-caption">{{ t('popup.caption') }}</p>
            </div>
            <button
                type="button"
                class="settings-button"
                :aria-label="t('common.settings')"
                :title="t('common.settings')"
                @click="open('/options.html')"
            >
                <Settings2 :size="15" />
            </button>
        </header>

        <div class="popup-body">
            <button
                v-if="siteReading"
                type="button"
                class="toggle-card"
                :class="{ 'is-off': !siteReading.enabled }"
                :aria-pressed="siteReading.enabled"
                :disabled="updating"
                @click="toggleAnalysis"
            >
                <span class="card-icon" :class="siteReading.enabled ? 'active' : 'soft'">
                    <ScanText :size="16" />
                </span>
                <span class="card-text">
                    <strong>{{ t('popup.analyzeSite') }}</strong>
                    <small>{{ siteReading.site }}</small>
                </span>
                <span class="switch-cluster">
                    <span class="switch-status">
                        {{ siteReading.enabled ? t('popup.enabled') : t('popup.disabled') }}
                    </span>
                    <span class="shadcn-switch" aria-hidden="true">
                        <span class="shadcn-switch-thumb"></span>
                    </span>
                </span>
            </button>

            <div class="popup-trigger-card">
                <span class="popup-setting-label">{{ t('popup.selectionTrigger') }}</span>
                <div class="segmented-control" role="radiogroup" :aria-label="t('popup.selectionTrigger')">
                    <button
                        v-for="option in triggerOptions"
                        :key="option.value"
                        type="button"
                        role="radio"
                        class="segmented-option"
                        :class="{ 'is-active': selectionTrigger === option.value }"
                        :aria-checked="selectionTrigger === option.value"
                        :disabled="savingPrefs"
                        @click="changeSelectionTrigger(option.value)"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>

            <div class="popup-learning-card">
                <div class="popup-setting-row">
                    <span class="popup-setting-label">{{ t('popup.activeCollection') }}</span>
                    <ShadcnSelect
                        size="sm"
                        placement="auto"
                        :model-value="activeCollectionId"
                        :options="collectionSelectOptions"
                        :aria-label="t('popup.activeCollection')"
                        :disabled="savingPrefs"
                        @update:model-value="changeActiveCollection"
                    />
                </div>
                <div class="popup-setting-row direction-row">
                    <span class="popup-setting-label">{{ t('popup.translationDirection') }}</span>
                    <div class="lang-pair-controls">
                        <ShadcnSelect
                            size="sm"
                            placement="auto"
                            :model-value="languages.sourceLanguage"
                            :options="sourceSelectOptions"
                            :aria-label="t('card.sourceLanguage')"
                            :min-menu-width="140"
                            :disabled="savingPrefs"
                            @update:model-value="changeSourceLanguage"
                        />
                        <ArrowRight :size="13" class="lang-pair-arrow" />
                        <ShadcnSelect
                            size="sm"
                            placement="auto"
                            align="right"
                            :model-value="languages.targetLanguage"
                            :options="targetSelectOptions"
                            :aria-label="t('card.targetLanguage')"
                            :min-menu-width="140"
                            :disabled="savingPrefs"
                            @update:model-value="changeTargetLanguage"
                        />
                    </div>
                </div>
            </div>

            <template v-if="currentPdf">
                <button type="button" class="action-card primary-cta" @click="open('/reader.html')">
                    <span class="card-icon">
                        <FileText :size="16" />
                    </span>
                    <span class="card-text">
                        <strong>{{ t('popup.openCurrentPdf') }}</strong>
                        <small>{{ t('popup.currentPdfHelp') }}</small>
                    </span>
                    <ArrowUpRight class="action-arrow" :size="15" />
                </button>
                <button type="button" class="action-card" @click="open('/library.html')">
                    <span class="card-icon soft">
                        <BookOpen :size="16" />
                    </span>
                    <span class="card-text">
                        <strong>{{ t('common.library') }}</strong>
                        <small>{{ t('common.wordCount', { count: wordCount }) }}</small>
                    </span>
                    <ArrowUpRight class="action-arrow" :size="15" />
                </button>
            </template>

            <template v-else>
                <button type="button" class="action-card" @click="open('/library.html')">
                    <span class="card-icon soft">
                        <BookOpen :size="16" />
                    </span>
                    <span class="card-text">
                        <strong>{{ t('common.library') }}</strong>
                        <small>{{ t('common.wordCount', { count: wordCount }) }}</small>
                    </span>
                    <ArrowUpRight class="action-arrow" :size="15" />
                </button>
                <button type="button" class="action-card" @click="open('/reader.html')">
                    <span class="card-icon soft">
                        <FileText :size="16" />
                    </span>
                    <span class="card-text">
                        <strong>{{ t('common.pdf') }}</strong>
                        <small>{{ t('popup.pdfHelp') }}</small>
                    </span>
                    <ArrowUpRight class="action-arrow" :size="15" />
                </button>
            </template>

            <p v-if="error" class="error small popup-error" role="alert">{{ error }}</p>
        </div>

        <footer class="popup-footer">
            <HardDrive :size="13" />
            <span>{{ t('popup.footer') }}</span>
        </footer>
    </main>
</template>

<style scoped>
.popup {
    width: 364px;
    max-width: 100%;
    background: #ffffff;
    color: #09090b;
    font-size: 13px;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
}

.popup-header {
    padding: 14px 16px 12px;
    border-bottom: 1px solid #f4f4f5;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.popup-brand-block {
    min-width: 0;
}

.popup-brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    border-radius: 6px;
    cursor: pointer;
}

.brand-title {
    font-size: 15px;
    font-weight: 700;
    color: #09090b;
    line-height: 1.2;
    letter-spacing: -0.015em;
}

.popup-caption {
    margin: 4px 0 0;
    font-size: 11px;
    color: #71717a;
    line-height: 1.4;
}

.settings-button {
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 6px;
    border: 1px solid #e4e4e7;
    background: #ffffff;
    color: #52525b;
    flex-shrink: 0;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.03);
}

.settings-button:hover {
    background: #f4f4f5;
    border-color: #d4d4d8;
    color: #09090b;
}

.popup-body {
    padding: 12px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.toggle-card,
.action-card {
    width: 100%;
    justify-content: flex-start;
    gap: 10px;
    border-radius: 8px;
    text-align: left;
}

.toggle-card {
    padding: 11px 12px;
    border: 1px solid #d4d4d8;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.03);
}

.toggle-card:hover {
    background: #ffffff;
    border-color: #a1a1aa;
}

.toggle-card.is-off {
    background: #fafafa;
    border-color: #e4e4e7;
    box-shadow: none;
}

.toggle-card.is-off:hover {
    background: #f4f4f5;
    border-color: #d4d4d8;
}

.action-card {
    padding: 10px 12px;
    border: 1px solid #e4e4e7;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.02);
}

.action-card:hover {
    background: #fafafa;
    border-color: #d4d4d8;
}

.action-card.primary-cta {
    background: #18181b;
    border-color: #18181b;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
}

.action-card.primary-cta:hover {
    background: #27272a;
    border-color: #27272a;
}

.card-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition:
        background 0.15s,
        color 0.15s;
}

.card-icon.active {
    background: #18181b;
    color: #fafafa;
}

.card-icon.soft {
    background: #f4f4f5;
    color: #52525b;
}

.action-card.primary-cta .card-icon {
    background: #27272a;
    color: #fafafa;
}

.card-text {
    min-width: 0;
    flex: 1;
}

.card-text strong {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #09090b;
    line-height: 1.3;
}

.card-text small {
    display: block;
    font-size: 11px;
    color: #71717a;
    line-height: 1.35;
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.action-card.primary-cta .card-text strong {
    color: #fafafa;
}

.action-card.primary-cta .card-text small {
    color: #a1a1aa;
}

.switch-cluster {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
}

.switch-status {
    font-size: 11px;
    font-weight: 500;
    color: #09090b;
}

.toggle-card.is-off .switch-status {
    color: #71717a;
}

.shadcn-switch {
    width: 34px;
    height: 20px;
    padding: 2px;
    border-radius: 9999px;
    background: #18181b;
    display: inline-flex;
    align-items: center;
    transition: background 0.15s;
}

.shadcn-switch-thumb {
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
    transform: translateX(14px);
    transition: transform 0.15s;
}

.toggle-card.is-off .shadcn-switch {
    background: #e4e4e7;
}

.toggle-card.is-off .shadcn-switch-thumb {
    transform: translateX(0);
}

.action-arrow {
    color: #a1a1aa;
    flex-shrink: 0;
}

.action-card.primary-cta .action-arrow {
    color: #d4d4d8;
}

.popup-error {
    margin: 2px 0 0;
}

.popup-trigger-card,
.popup-learning-card {
    border: 1px solid #e4e4e7;
    border-radius: 8px;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.02);
}

.popup-trigger-card {
    padding: 8px 11px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.popup-learning-card {
    padding: 9px 11px;
    display: grid;
    gap: 8px;
}

.popup-setting-row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
}

.popup-setting-label {
    font-size: 12px;
    font-weight: 500;
    color: #52525b;
    white-space: nowrap;
}

.segmented-control {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    padding: 2px;
    border-radius: 7px;
    background: #f4f4f5;
    border: 1px solid #e4e4e7;
    gap: 2px;
}

.segmented-option {
    min-width: 44px;
    height: 24px;
    min-height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #71717a;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    box-shadow: none;
    cursor: pointer;
    transition:
        background-color 140ms ease,
        color 140ms ease,
        box-shadow 140ms ease;
}

.segmented-option:hover:not(.is-active):not(:disabled) {
    color: #09090b;
}

.segmented-option.is-active {
    background: #ffffff;
    color: #09090b;
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.lang-pair-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 5px;
}

.lang-pair-arrow {
    color: #71717a;
    flex-shrink: 0;
}

.popup-footer {
    padding: 9px 16px;
    background: #fafafa;
    border-top: 1px solid #f4f4f5;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 11px;
    color: #71717a;
}

.settings-button:focus-visible,
.toggle-card:focus-visible,
.action-card:focus-visible,
.popup-brand:focus-visible,
.segmented-option:focus-visible {
    outline: none;
    border-color: #18181b;
    box-shadow: 0 0 0 2px rgb(24 24 27 / 0.14);
}
</style>
