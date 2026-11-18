import {
    getDocument,
    GlobalWorkerOptions,
    TextLayer,
    type PDFDocumentProxy,
    type PDFDocumentLoadingTask,
    type PDFPageProxy,
    type RenderTask,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { browser } from 'wxt/browser'
import { contextAround, countTokens, tokenize } from '../../domain/vocabulary'
import type { Word } from '../../domain/models'

GlobalWorkerOptions.workerSrc = workerUrl

export class PdfSession {
    document: PDFDocumentProxy | undefined
    private loading: PDFDocumentLoadingTask | undefined
    private renderTask: RenderTask | undefined
    private textLayer: TextLayer | undefined
    private currentPage: PDFPageProxy | undefined
    private generation = 0
    private renderGeneration = 0
    private textContainer: HTMLElement | undefined
    private currentText = ''

    async open(data: Uint8Array): Promise<PDFDocumentProxy> {
        await this.destroy()
        const generation = ++this.generation
        this.loading = getDocument({
            data,
            cMapUrl: new URL('pdf/cmaps/', browser.runtime.getURL('/')).href,
            cMapPacked: true,
            standardFontDataUrl: new URL('pdf/standard_fonts/', browser.runtime.getURL('/')).href,
            wasmUrl: new URL('pdf/wasm/', browser.runtime.getURL('/')).href,
        })
        this.loading.onPassword = (update: (password: string) => void, reason: number) => {
            const password = window.prompt(reason === 2 ? '密码不正确，请重新输入' : '请输入 PDF 密码')
            if (password !== null) update(password)
            else void this.loading?.destroy()
        }
        const document = await this.loading.promise
        if (generation !== this.generation) {
            throw new Error('已切换文档')
        }
        this.document = document
        return document
    }

    async render(container: HTMLElement, pageNumber: number, scale: number, rotation: number): Promise<void> {
        const document = this.document
        if (!document) return
        const generation = ++this.renderGeneration
        this.renderTask?.cancel()
        this.textLayer?.cancel()
        this.clearHighlights()
        const oldPage = this.currentPage
        const page = await document.getPage(pageNumber)
        if (generation !== this.renderGeneration) return
        this.currentPage = page
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
        const canvas = window.document.createElement('canvas')
        const ratio = Math.min(
            window.devicePixelRatio || 1,
            2,
            Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        )
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const textContainer = window.document.createElement('div')
        textContainer.className = 'textLayer'
        container.style.width = `${viewport.width}px`
        container.style.height = `${viewport.height}px`
        container.style.setProperty('--scale-factor', String(scale))
        container.style.setProperty('--total-scale-factor', String(scale))
        container.replaceChildren(canvas, textContainer)
        this.textContainer = textContainer
        this.renderTask = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
        try {
            await this.renderTask.promise
        } catch (error) {
            if (generation !== this.renderGeneration) return
            throw error
        }
        if (generation !== this.renderGeneration) return
        const content = await page.getTextContent()
        if (generation !== this.renderGeneration) return
        this.currentText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
        this.textLayer = new TextLayer({ textContentSource: content, container: textContainer, viewport })
        await this.textLayer.render()
        if (oldPage && oldPage !== page) oldPage.cleanup()
    }

    contextForWord(word: string): string {
        return contextAround(this.currentText, word)
    }

    highlight(words: Word[], enabled: boolean) {
        this.clearHighlights()
        if (!enabled || !this.textContainer || !('highlights' in CSS)) return
        const states = new Map(words.map((word) => [word.key, word.state]))
        const unknown = new Highlight()
        const learning = new Highlight()
        const walker = document.createTreeWalker(this.textContainer, NodeFilter.SHOW_TEXT)
        let node: Node | null
        let ranges = 0
        while ((node = walker.nextNode()) && ranges < 5000) {
            for (const token of tokenize(node.textContent ?? '')) {
                const state = states.get(token.key)
                if (state === 'known' || state === 'ignored') continue
                if (++ranges > 5000) break
                const range = new Range()
                range.setStart(node, token.start)
                range.setEnd(node, token.end)
                ;(state === 'learning' ? learning : unknown).add(range)
            }
        }
        CSS.highlights.set('xgloss-pdf-unknown', unknown)
        CSS.highlights.set('xgloss-pdf-learning', learning)
    }

    async analyze(
        changed: (counts: Map<string, number>, pages: number, limited: boolean) => void,
    ): Promise<void> {
        const document = this.document
        const generation = this.generation
        if (!document) return
        const counts = new Map<string, number>()
        let characters = 0
        for (let number = 1; number <= document.numPages; number++) {
            if (generation !== this.generation) return
            const page = await document.getPage(number)
            const content = await page.getTextContent()
            if (generation !== this.generation) return
            const text = content.items
                .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
                .join('')
            const remaining = Math.max(0, 1_000_000 - characters)
            for (const [key, count] of countTokens(tokenize(text.slice(0, remaining))))
                counts.set(key, (counts.get(key) ?? 0) + count)
            characters += text.length
            changed(new Map(counts), number, characters >= 1_000_000)
            if (page !== this.currentPage) page.cleanup()
            if (characters >= 1_000_000) return
            await new Promise((resolve) => setTimeout(resolve, 30))
        }
    }

    private clearHighlights() {
        CSS.highlights?.delete('xgloss-pdf-unknown')
        CSS.highlights?.delete('xgloss-pdf-learning')
    }

    async destroy() {
        this.generation++
        this.renderGeneration++
        this.renderTask?.cancel()
        this.textLayer?.cancel()
        this.clearHighlights()
        this.textContainer = undefined
        this.currentText = ''
        this.currentPage = undefined
        this.document = undefined
        await this.loading?.destroy()
        this.loading = undefined
    }
}
