import { contextAround } from '../../domain/vocabulary'

export function selectionContext(
    range: Range,
    selected: string,
    block?: Element | null,
    separator = '',
): string {
    const start = range.startContainer
    if (!(start instanceof Text)) return ''
    return contextAt(start, range.startOffset, selected, block, separator)
}

export function contextAt(
    start: Text,
    offset: number,
    selected: string,
    block = start.parentElement?.closest('p,li,th,td,blockquote,h1,h2,h3,h4,h5,h6'),
    separator = '',
): string {
    if (block) {
        const nodes = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
        let content = ''
        let position: number | undefined
        for (let count = 0; count < 128 && content.length < 6000; count++) {
            const node = nodes.nextNode()
            if (!node) break
            if (content) content += separator
            if (node === start) position = content.length + offset
            content += (node.nodeValue ?? '').slice(0, 6000 - content.length)
        }
        if (position !== undefined && position < content.length)
            return contextAround(content, selected, 1000, position)
    }
    const from = Math.max(0, offset - 500)
    return contextAround(
        start.data.slice(from, offset + selected.length + 500),
        selected,
        1000,
        offset - from,
    )
}
