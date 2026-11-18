import { createApp } from 'vue'
import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import WebReader from '../features/web/WebReader.vue'
import { onReadingChanged, request } from '../platform/messages'
import { webHostname } from '../platform/web-site'
import styles from '../assets/ui.css?inline'
import highlights from '../assets/highlights.css?inline'

export default defineContentScript({
    matches: ['http://*/*', 'https://*/*'],
    excludeMatches: ['https://chromewebstore.google.com/*', 'https://chrome.google.com/webstore*'],
    runAt: 'document_idle',
    main(ctx) {
        const site = webHostname(location.href)
        if (!site || !['text/html', 'application/xhtml+xml'].includes(document.contentType)) return

        let close: (() => void) | undefined
        let generation = 0
        let suspended = false
        function unmount() {
            generation++
            close?.()
            close = undefined
        }

        function mount() {
            const host = document.createElement('div')
            host.id = 'xgloss-root'
            host.style.cssText = 'position: fixed; z-index: 2147483647;'
            const shadow = host.attachShadow({ mode: 'open' })
            const style = document.createElement('style')
            style.textContent = styles
            const container = document.createElement('div')
            shadow.append(style, container)
            const highlightStyle = document.createElement('style')
            highlightStyle.textContent =
                (styles.match(/@font-face\s*\{[^}]*\}/g)?.join('\n') ?? '') + highlights
            document.head.append(highlightStyle)
            document.documentElement.append(host)
            const app = createApp(WebReader)
            app.mount(container)
            close = () => {
                app.unmount()
                host.remove()
                highlightStyle.remove()
            }
        }

        async function reload() {
            if (suspended) return
            const current = ++generation
            const next = await request('siteReading')
            if (current !== generation) return
            if (next.analysis && !close) mount()
            else if (!next.analysis) unmount()
        }

        function update() {
            void reload().catch(() => undefined)
        }

        function pageHidden() {
            suspended = true
            unmount()
        }

        function pageShown() {
            suspended = false
            update()
        }

        const ping: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
            message,
            _sender,
            reply,
        ) => {
            if (message?.event === 'siteReadingPing') reply(true)
        }
        const unsubscribe = onReadingChanged((change, changedSite) => {
            if (change === 'site' && changedSite === site) update()
        })
        browser.runtime.onMessage.addListener(ping)
        window.addEventListener('pagehide', pageHidden)
        window.addEventListener('pageshow', pageShown)
        ctx.onInvalidated(() => {
            unsubscribe()
            browser.runtime.onMessage.removeListener(ping)
            window.removeEventListener('pagehide', pageHidden)
            window.removeEventListener('pageshow', pageShown)
            pageHidden()
        })
        update()
    },
})
