import { t } from '../../i18n'
import {
    AnnotationEditorType,
    AnnotationMode,
    getDocument,
    GlobalWorkerOptions,
    type PDFDocumentLoadingTask,
    type PDFDocumentProxy,
} from 'pdfjs-dist'
import { EventBus, PDFLinkService, PDFViewer, ScrollMode, SpreadMode } from 'pdfjs-dist/web/pdf_viewer.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { browser } from 'wxt/browser'
import {
    contextAround,
    highlightKind,
    highlightKinds,
    normalizeWord,
    tokenize,
} from '../../domain/vocabulary'
import type { Word } from '../../domain/models'

GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfLayout {
    spread: boolean
    continuous: boolean
}
export interface PdfOutlineEntry {
    title: string
    depth: number
    destination: string | unknown[] | null
}
const textBudget = 1_000_000
const highlightBudget = 5_000
const highlightNodeBudget = 5_000

export class PdfSession {
    document: PDFDocumentProxy | undefined
    private loading: PDFDocumentLoadingTask | undefined
    private controller = new AbortController()
    private documentController = new AbortController()
    private readonly events = new EventBus()
    private readonly links = new PDFLinkService({ eventBus: this.events, ignoreDestinationZoom: true })
    private readonly viewer: PDFViewer
    private firstPages = new Map<string, number>()
    private words = new Map<string, Word>()
    private highlighting = true
    private paintFrame = 0
    private canNavigate = false
    private lastWheel = -Infinity
    private textCache = new Map<number, Promise<string>>()

    constructor(
        private readonly container: HTMLDivElement,
        viewer: HTMLDivElement,
        pageChanged: (page: number) => void,
    ) {
        const abortSignal = this.controller.signal
        const options = {
            container,
            viewer,
            eventBus: this.events,
            linkService: this.links,
            annotationMode: AnnotationMode.DISABLE,
            annotationEditorMode: AnnotationEditorType.DISABLE,
            enableAutoLinking: false,
            maxCanvasPixels: 8_000_000,
            abortSignal,
        }
        this.viewer = new PDFViewer(options)
        this.links.setViewer(this.viewer)
        this.events.on(
            'pagechanging',
            ({ pageNumber }: { pageNumber: number }) => {
                if (this.canNavigate) pageChanged(pageNumber)
            },
            { signal: abortSignal },
        )
        this.events.on('textlayerrendered', () => this.scheduleHighlights(), { signal: abortSignal })
        this.events.on('updateviewarea', () => this.scheduleHighlights(), { signal: abortSignal })
    }

    async open(data: Uint8Array): Promise<PDFDocumentProxy> {
        await this.close()
        this.controller.signal.throwIfAborted()
        const signal = this.documentController.signal
        const loading = getDocument({
            data,
            disableAutoFetch: true,
            cMapUrl: new URL('pdf/cmaps/', browser.runtime.getURL('/')).href,
            cMapPacked: true,
            standardFontDataUrl: new URL('pdf/standard_fonts/', browser.runtime.getURL('/')).href,
            wasmUrl: new URL('pdf/wasm/', browser.runtime.getURL('/')).href,
        })
        this.loading = loading
        loading.onPassword = (update: (password: string | Error) => void, reason: number) => {
            const password = window.prompt(
                reason === 2 ? t('pdf.incorrectPassword') : t('pdf.promptPassword'),
            )
            if (password === null) update(new Error(t('pdf.cancelledPassword')))
            else update(password)
        }
        const document = await loading.promise
        signal.throwIfAborted()
        this.document = document
        return document
    }

    async show(page: number, scale: string, layout: PdfLayout): Promise<void> {
        const document = this.document
        if (!document) throw new Error(t('pdf.missingDocument'))
        const controller = this.documentController
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
        const initialized = new Promise<void>((resolve, reject) => {
            const cancel = () => reject(signal.reason)
            signal.addEventListener('abort', cancel, { once: true })
            this.events.on(
                'pagesinit',
                () => {
                    signal.removeEventListener('abort', cancel)
                    resolve()
                },
                { once: true, signal },
            )
        })
        this.links.setDocument(document)
        this.viewer.setDocument(document)
        // Capture the viewer's initialization failure as well as cancellation or timeout.
        void Promise.resolve(this.viewer.pagesPromise).catch((reason: unknown) => controller.abort(reason))
        await initialized
        signal.throwIfAborted()
        this.setLayout(layout)
        this.setScale(scale)
        this.goTo(page)
        this.canNavigate = true
    }

    setLayout({ spread, continuous }: PdfLayout) {
        const page = this.viewer.currentPageNumber
        this.viewer.scrollMode = continuous ? ScrollMode.VERTICAL : ScrollMode.PAGE
        this.viewer.spreadMode = spread ? SpreadMode.ODD : SpreadMode.NONE
        this.container.removeEventListener('wheel', this.wheel)
        if (this.viewer.scrollMode === ScrollMode.PAGE) {
            this.container.addEventListener('wheel', this.wheel, {
                passive: false,
                signal: this.controller.signal,
            })
        }
        this.goTo(page)
    }

    setScale(scale: string) {
        this.viewer.currentScaleValue = scale
    }

    rotate() {
        this.viewer.pagesRotation = (this.viewer.pagesRotation + 90) % 360
    }

    goTo(page: number) {
        this.viewer.scrollPageIntoView({ pageNumber: page })
    }

    step(direction: -1 | 1): boolean {
        return direction > 0 ? this.viewer.nextPage() : this.viewer.previousPage()
    }

    private wheel = (event: WheelEvent) => {
        if (!this.canNavigate || this.viewer.scrollMode !== ScrollMode.PAGE || event.ctrlKey || event.metaKey)
            return
        if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
        const { scrollTop, scrollHeight, clientHeight } = this.container
        const direction = event.deltaY > 0 ? 1 : -1
        const atEdge = direction > 0 ? scrollHeight - clientHeight - scrollTop <= 2 : scrollTop <= 2
        const time = performance.now()
        if (!atEdge || time - this.lastWheel < 400 || !this.step(direction)) return
        event.preventDefault()
        this.lastWheel = time
        if (direction < 0) this.container.scrollTop = this.container.scrollHeight
    }

    async outline(): Promise<PdfOutlineEntry[]> {
        const document = this.document
        if (!document) return []
        const entries: PdfOutlineEntry[] = []
        const collect = (items: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>, depth: number) => {
            if (depth > 20) return
            for (const item of items ?? []) {
                if (entries.length >= 2_000) break
                entries.push({ title: item.title, depth, destination: item.dest })
                collect(item.items, depth + 1)
            }
        }
        collect(await document.getOutline(), 0)
        return entries
    }

    goToDestination(destination: string | unknown[]) {
        return this.links.goToDestination(destination)
    }

    pageForWord(word: string): number | undefined {
        return this.firstPages.get(normalizeWord(word))
    }

    async contextForWord(word: string, page: number): Promise<string> {
        const document = this.document
        if (!document) return ''
        let pending = this.textCache.get(page)
        if (!pending) {
            if (this.textCache.size >= 4) this.textCache.delete(this.textCache.keys().next().value!)
            const cache = this.textCache
            pending = document
                .getPage(page)
                .then(async (pdfPage) => {
                    const content = await pdfPage.getTextContent()
                    return content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
                })
                .catch((reason: unknown) => {
                    cache.delete(page)
                    throw reason
                })
            this.textCache.set(page, pending)
        }
        return contextAround(await pending, word)
    }

    highlight(words: Word[], enabled: boolean) {
        this.words = new Map(words.map((word) => [word.key, word]))
        this.highlighting = enabled
        this.scheduleHighlights()
    }

    private scheduleHighlights() {
        if (!this.paintFrame && this.document) {
            this.paintFrame = requestAnimationFrame(() => {
                this.paintFrame = 0
                this.paintHighlights()
            })
        }
    }

    private paintHighlights() {
        if (!('highlights' in CSS)) return
        this.clearHighlights()
        if (!this.highlighting) return
        const highlights = new Map(highlightKinds.map((kind) => [kind, new Highlight()]))
        const viewport = this.container.getBoundingClientRect()
        let ranges = 0
        let nodes = 0
        let characters = 0
        pages: for (const view of this.viewer.getCachedPageViews()) {
            const div: HTMLDivElement = view.div
            if (!div.isConnected) continue
            const bounds = div.getBoundingClientRect()
            if (bounds.bottom < viewport.top - 200 || bounds.top > viewport.bottom + 200) continue
            const layer = div.querySelector('.textLayer')
            if (!layer) continue
            const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
            let node: Node | null
            while ((node = walker.nextNode())) {
                if (++nodes > highlightNodeBudget || characters >= textBudget) break pages
                const text = (node.textContent ?? '').slice(0, Math.min(20_000, textBudget - characters))
                characters += text.length
                for (const token of tokenize(text)) {
                    const kind = highlightKind(this.words.get(token.key))
                    if (!kind) continue
                    if (ranges++ >= highlightBudget) break pages
                    const range = new Range()
                    range.setStart(node, token.start)
                    range.setEnd(node, token.end)
                    highlights.get(kind)!.add(range)
                }
            }
        }
        for (const [kind, highlight] of highlights) CSS.highlights.set(`xgloss-${kind}`, highlight)
    }

    async analyze(changed: (counts: Map<string, number>, pages: number, limited: boolean) => void) {
        const document = this.document
        if (!document) return
        const signal = this.documentController.signal
        const counts = new Map<string, number>()
        let characters = 0
        for (let number = 1; number <= document.numPages; number++) {
            if (signal.aborted) return
            const page = await document.getPage(number)
            const content = await page.getTextContent()
            if (signal.aborted) return
            const text = content.items.map((item) => ('str' in item ? item.str + ' ' : '')).join('')
            for (const { key } of tokenize(text.slice(0, textBudget - characters))) {
                if (!counts.has(key)) this.firstPages.set(key, number)
                counts.set(key, (counts.get(key) ?? 0) + 1)
            }
            characters += text.length
            const limited = characters >= textBudget
            if (number === 1 || number % 8 === 0 || number === document.numPages || limited)
                changed(new Map(counts), number, limited)
            if (!Array.from(this.viewer.getCachedPageViews()).some((view) => view.pdfPage === page))
                page.cleanup()
            if (limited) return
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
    }

    private clearHighlights() {
        for (const kind of highlightKinds) CSS.highlights?.delete(`xgloss-${kind}`)
    }

    async close() {
        this.canNavigate = false
        this.container.removeEventListener('wheel', this.wheel)
        this.documentController.abort()
        this.documentController = new AbortController()
        this.viewer.setDocument(null)
        this.links.setDocument(null)
        cancelAnimationFrame(this.paintFrame)
        this.paintFrame = 0
        this.clearHighlights()
        this.firstPages.clear()
        this.textCache = new Map()
        this.document = undefined
        const loading = this.loading
        this.loading = undefined
        await loading?.destroy()
    }

    async destroy() {
        try {
            await this.close()
        } finally {
            this.controller.abort()
        }
    }
}
