import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { handleMessage } from '../services/background-handler'

export default defineBackground(() => {
    const storageReady = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    browser.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.channel !== 'xgloss') return
        void storageReady
            .then(() => handleMessage(message, sender))
            .then(respond)
            .catch(() => respond({ ok: false, error: '配置存储初始化失败' }))
        return true
    })
    browser.runtime.onInstalled.addListener(() => {
        browser.contextMenus.create({
            id: 'xgloss-reader',
            title: '用 XGloss 打开 PDF',
            contexts: ['link'],
            targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*'],
        })
    })
    browser.contextMenus.onClicked.addListener((info) => {
        if (info.menuItemId === 'xgloss-reader' && info.linkUrl) {
            void browser.tabs.create({
                url: browser.runtime.getURL('/reader.html') + '?url=' + encodeURIComponent(info.linkUrl),
            })
        }
    })
})
