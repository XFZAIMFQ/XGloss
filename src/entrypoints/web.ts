import { createApp } from 'vue'
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script'
import WebReader from '../features/web/WebReader.vue'
import styles from '../assets/ui.css?inline'

export default defineUnlistedScript(() => {
    const existing = document.getElementById('xgloss-root')
    if (existing) {
        existing.dispatchEvent(new Event('xgloss-close'))
        return
    }
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
        (styles.match(/@font-face\s*\{[^}]*\}/g)?.join('\n') ?? '') +
        '::highlight(xgloss-unknown){background-color:#dcecfb;color:inherit}::highlight(xgloss-learning){background-color:#ffe0b8;color:inherit}'
    document.head.append(highlightStyle)
    let closed = false
    const close = () => {
        if (closed) return
        closed = true
        window.removeEventListener('pagehide', close)
        app.unmount()
        host.remove()
        highlightStyle.remove()
    }
    const app = createApp(WebReader, { onClose: close })
    host.addEventListener('xgloss-close', close, { once: true })
    document.documentElement.append(host)
    app.mount(container)
    window.addEventListener('pagehide', close, { once: true })
})
