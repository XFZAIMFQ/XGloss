import {
    tokenize,
    countTokens,
    contextAround,
    highlightKind,
    highlightKinds,
    type HighlightKind,
    type Token,
} from '../../domain/vocabulary'
import type { Word } from '../../domain/models'

interface TextBlock {
    node: Text
    parent: Element
    characters: number
    tokens: Token[]
    counts: Map<string, number>
}
export interface AnalysisSnapshot {
    counts: Map<string, number>
    status: string
}
const excluded =
    'script,style,noscript,textarea,input,select,pre,code,nav,footer,header,[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],#xgloss-root'
const maxCharacters = 1_000_000
const maxNodes = 10_000
const maxRanges = 5_000

export class PageAnalyzer {
    private blocks = new Map<Text, TextBlock>()
    private blocksByParent = new Map<Element, Set<TextBlock>>()
    private cleanupIterator: MapIterator<[Text, TextBlock]> | undefined
    private counts = new Map<string, number>()
    private words = new Map<string, Word>()
    private visible = new Set<Element>()
    private observed = new Set<Element>()
    private walkers: TreeWalker[] = []
    private dirty = new Set<Text>()
    private timer: ReturnType<typeof setTimeout> | undefined
    private paintFrame = 0
    private stopped = false
    private characters = 0
    private limited = false
    private enabled = true
    private mutationObserver: MutationObserver
    private intersectionObserver: IntersectionObserver
    private highlights = new Map<HighlightKind, Highlight>()

    constructor(
        private root: HTMLElement,
        private changed: (snapshot: AnalysisSnapshot) => void,
    ) {
        this.intersectionObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) this.visible.add(entry.target)
                    else this.visible.delete(entry.target)
                }
                this.schedulePaint()
            },
            { rootMargin: '600px' },
        )
        this.mutationObserver = new MutationObserver((records) => {
            for (const record of records) {
                if (record.target instanceof Element && record.target.closest('#xgloss-root')) continue
                if (record.type === 'characterData' && record.target instanceof Text)
                    this.dirty.add(record.target)
                for (const node of record.addedNodes) this.enqueue(node)
                if (record.removedNodes.length) this.cleanupIterator ??= this.blocks.entries()
            }
            this.schedule()
        })
    }

    start() {
        this.enqueue(this.root)
        this.mutationObserver.observe(this.root, { subtree: true, childList: true, characterData: true })
        this.schedule()
    }

    setWords(words: Word[]) {
        this.words = new Map(words.map((word) => [word.key, word]))
        this.schedulePaint()
    }

    setHighlight(enabled: boolean) {
        this.enabled = enabled
        this.schedulePaint()
    }

    contextForWord(word: string): string {
        for (const block of this.blocks.values()) {
            if (block.counts.has(word) && block.node.isConnected)
                return contextAround(block.parent.textContent ?? '', word)
        }
        return ''
    }

    destroy() {
        this.stopped = true
        clearTimeout(this.timer)
        cancelAnimationFrame(this.paintFrame)
        this.mutationObserver.disconnect()
        this.intersectionObserver.disconnect()
        for (const kind of highlightKinds) CSS.highlights?.delete(`xgloss-${kind}`)
        this.highlights.clear()
        this.blocks.clear()
        this.blocksByParent.clear()
        this.cleanupIterator = undefined
        this.observed.clear()
        this.visible.clear()
        this.walkers = []
        this.dirty.clear()
    }

    private enqueue(node: Node) {
        if (node instanceof Text) this.dirty.add(node)
        else if (node instanceof Element && !node.closest(excluded)) {
            // A mutation burst is coalesced into one resumable root traversal.
            if (this.walkers.length >= 100)
                this.walkers = [document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT)]
            else this.walkers.push(document.createTreeWalker(node, NodeFilter.SHOW_TEXT))
        }
    }

    private schedule() {
        if (this.stopped || this.timer) return
        this.timer = setTimeout(
            () => {
                this.timer = undefined
                this.process()
            },
            document.hidden ? 1000 : 16,
        )
    }

    private process() {
        if (this.stopped) return
        const deadline = performance.now() + 6
        while (performance.now() < deadline) {
            if (this.cleanupIterator) {
                const item = this.cleanupIterator.next()
                if (item.done) this.cleanupIterator = undefined
                else if (!item.value[0].isConnected || !this.root.contains(item.value[0]))
                    this.removeBlock(item.value[1])
                continue
            }
            const dirtyNode = this.dirty.values().next().value as Text | undefined
            if (dirtyNode) {
                this.dirty.delete(dirtyNode)
                this.index(dirtyNode)
                continue
            }
            const walker = this.walkers[0]
            if (!walker || this.limited) break
            const node = walker.nextNode()
            if (!node) {
                this.walkers.shift()
                continue
            }
            this.index(node as Text)
        }
        this.changed({
            counts: new Map(this.counts),
            status: this.limited
                ? '达到分析预算，当前结果为部分内容'
                : this.walkers.length || this.dirty.size
                  ? '正在分批分析已加载内容…'
                  : '',
        })
        this.schedulePaint()
        if ((this.walkers.length && !this.limited) || this.dirty.size || this.cleanupIterator) this.schedule()
    }

    private index(node: Text) {
        const parent = node.parentElement
        const old = this.blocks.get(node)
        if (old) this.removeBlock(old)
        if (!parent || !node.isConnected || parent.closest(excluded) || !node.textContent?.trim()) return
        if (!old && (this.characters >= maxCharacters || this.blocks.size >= maxNodes)) {
            this.limited = true
            return
        }
        // Large single text nodes have a bounded initial window.
        const text = node.data.slice(0, Math.min(16_000, maxCharacters - this.characters))
        if (text.length < node.data.length) this.limited = true
        this.characters += text.length
        const tokens = tokenize(text)
        const block = { node, parent, characters: text.length, tokens, counts: countTokens(tokens) }
        this.blocks.set(node, block)
        if (!this.blocksByParent.has(parent)) this.blocksByParent.set(parent, new Set())
        this.blocksByParent.get(parent)!.add(block)
        this.merge(block.counts, 1)
        if (!this.observed.has(parent) && this.observed.size < maxNodes) {
            this.observed.add(parent)
            this.intersectionObserver.observe(parent)
        }
    }

    private removeBlock(block: TextBlock) {
        this.merge(block.counts, -1)
        this.blocks.delete(block.node)
        this.characters -= block.characters
        const siblings = this.blocksByParent.get(block.parent)
        siblings?.delete(block)
        if (!siblings?.size) {
            this.blocksByParent.delete(block.parent)
            this.intersectionObserver.unobserve(block.parent)
            this.observed.delete(block.parent)
            this.visible.delete(block.parent)
        }
    }

    private merge(counts: Map<string, number>, sign: number) {
        for (const [key, count] of counts) {
            const next = (this.counts.get(key) ?? 0) + sign * count
            if (next > 0) this.counts.set(key, next)
            else this.counts.delete(key)
        }
    }

    private schedulePaint() {
        if (this.paintFrame || this.stopped) return
        this.paintFrame = requestAnimationFrame(() => {
            this.paintFrame = 0
            this.paint()
        })
    }

    private paint() {
        if (!('highlights' in CSS)) return
        for (const highlight of this.highlights.values()) highlight.clear()
        if (!this.enabled) return
        for (const kind of highlightKinds) {
            if (!this.highlights.has(kind)) this.highlights.set(kind, new Highlight())
            CSS.highlights.set(`xgloss-${kind}`, this.highlights.get(kind)!)
        }
        let count = 0
        for (const block of [...this.visible].flatMap((parent) => [
            ...(this.blocksByParent.get(parent) ?? []),
        ])) {
            if (!block.node.isConnected) continue
            for (const token of block.tokens) {
                const kind = highlightKind(this.words.get(token.key))
                if (!kind || token.end > block.node.length) continue
                if (++count > maxRanges) return
                const range = new Range()
                range.setStart(block.node, token.start)
                range.setEnd(block.node, token.end)
                this.highlights.get(kind)?.add(range)
            }
        }
    }
}
