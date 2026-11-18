<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import { errorMessage } from '../../domain/models'
import { request } from '../../platform/messages'
import { BookOpen, FileText, Settings2, ArrowUpRight, Highlighter, HardDrive } from '@lucide/vue'
const error = ref('')
const wordCount = ref(0)
onMounted(async () => {
    try {
        wordCount.value = (await request('words')).length
    } catch (reason) {
        error.value = errorMessage(reason)
    }
})
async function enable() {
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) throw new Error('当前标签页不可用')
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/web.js'] })
        window.close()
    } catch (reason) {
        error.value = errorMessage(reason) + '。请在普通网页上使用，PDF 可通过阅读器打开。'
    }
}
async function open(page: '/reader.html' | '/library.html' | '/options.html') {
    await browser.tabs.create({ url: browser.runtime.getURL(page) })
    window.close()
}
</script>
<template>
    <main class="popup">
        <div class="popup-heading">
            <a class="popup-brand" @click="open('/library.html')">
                <span>X.</span>
                Gloss
            </a>
            <button class="icon-button" aria-label="翻译设置" @click="open('/options.html')">
                <Settings2 :size="20" />
            </button>
        </div>
        <p class="popup-caption">把正在阅读的单词，变成自己的词汇。</p>
        <button class="primary popup-enable" @click="enable">
            <Highlighter :size="19" />
            开启 / 关闭当前网页
            <ArrowUpRight :size="17" />
        </button>
        <div class="popup-links">
            <button @click="open('/library.html')">
                <BookOpen :size="20" />
                <span>
                    我的词库
                    <small>{{ wordCount }} 个词条</small>
                </span>
                <ArrowUpRight :size="16" />
            </button>
            <button @click="open('/reader.html')">
                <FileText :size="20" />
                <span>
                    PDF 阅读器
                    <small>打开文档，边读边积累</small>
                </span>
                <ArrowUpRight :size="16" />
            </button>
        </div>
        <p v-if="error" class="error small" role="alert">{{ error }}</p>
        <footer>
            <HardDrive :size="13" />
            本地保存 · 按需翻译
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
