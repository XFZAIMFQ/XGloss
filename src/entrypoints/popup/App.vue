<script setup lang="ts">
import { t } from '../../i18n'
import { onMounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import { errorMessage } from '../../domain/models'
import { request } from '../../platform/messages'
import { webHostname } from '../../platform/web-site'
import { BookOpen, FileText, Settings2, ArrowUpRight, ScanText, HardDrive } from '@lucide/vue'
const error = ref('')
const wordCount = ref(0)
const currentPdf = ref('')
const siteReading = ref<{ tabId: number; site: string; enabled: boolean }>()
const updating = ref(false)

async function ensureAttached(tabId: number) {
    const attached = await browser.tabs
        .sendMessage(tabId, { event: 'siteReadingPing' }, { frameId: 0 })
        .catch(() => false)
    if (attached !== true)
        await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/web.js'] })
}

onMounted(async () => {
    try {
        const [words, [tab]] = await Promise.all([
            request('words'),
            browser.tabs.query({ active: true, currentWindow: true }),
        ])
        wordCount.value = words.length
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
        <div class="popup-heading">
            <a class="popup-brand" @click="open('/library.html')">
                <span>X.</span>
                Gloss
            </a>
            <button class="icon-button" :aria-label="t('common.settings')" @click="open('/options.html')">
                <Settings2 :size="20" />
            </button>
        </div>
        <p class="popup-caption">{{ t('popup.caption') }}</p>
        <button
            v-if="siteReading"
            class="popup-enable"
            :class="{ primary: siteReading.enabled }"
            :aria-pressed="siteReading.enabled"
            :disabled="updating"
            @click="toggleAnalysis"
        >
            <ScanText :size="19" />
            <span class="site-label">
                {{ t('popup.analyzeSite') }}
                <small>{{ siteReading.site }}</small>
            </span>
            <span>{{ siteReading.enabled ? t('popup.enabled') : t('popup.disabled') }}</span>
        </button>
        <div class="popup-links">
            <button @click="open('/library.html')">
                <BookOpen :size="20" />
                <span>
                    {{ t('common.library') }}
                    <small>{{ t('common.wordCount', { count: wordCount }) }}</small>
                </span>
                <ArrowUpRight :size="16" />
            </button>
            <button @click="open('/reader.html')">
                <FileText :size="20" />
                <span>
                    {{ currentPdf ? t('popup.openCurrentPdf') : t('common.pdf') }}
                    <small>{{ currentPdf ? t('popup.currentPdfHelp') : t('popup.pdfHelp') }}</small>
                </span>
                <ArrowUpRight :size="16" />
            </button>
        </div>
        <p v-if="error" class="error small" role="alert">{{ error }}</p>
        <footer>
            <HardDrive :size="13" />
            {{ t('popup.footer') }}
        </footer>
    </main>
</template>
<style scoped>
.popup {
    width: 350px;
    padding: 22px;
    background: #fff;
}
.popup-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.popup-brand {
    display: flex;
    gap: 3px;
    align-items: center;
    font-size: 26px;
    font-weight: 800;
    cursor: pointer;
}
.popup-brand > span {
    background: var(--orange);
    color: white;
    border-radius: 11px;
    padding: 0 10px;
    margin-right: 4px;
}
.popup-caption {
    color: var(--muted);
    font-size: 12px;
    margin: 16px 0 22px;
}
.popup-enable {
    width: 100%;
    font-size: 13px;
    padding: 13px;
}
.popup-enable > :last-child {
    margin-left: auto;
}
.site-label {
    min-width: 0;
    text-align: left;
}
.site-label small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
}
.popup-links {
    display: grid;
    gap: 10px;
    margin: 18px 0;
}
.popup-links > button {
    padding: 14px;
    text-align: left;
    justify-content: flex-start;
    background: #f6f5f9;
    border-color: transparent;
}
.popup-links > button > span {
    flex: 1;
    font-weight: 800;
    font-size: 14px;
}
.popup-links small {
    display: block;
    color: var(--muted);
    font-size: 11px;
    font-weight: 400;
    margin-top: 1px;
}
.popup-links > button > svg:last-child {
    color: var(--muted);
}
footer {
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 10px;
    margin-top: 20px;
}
</style>
