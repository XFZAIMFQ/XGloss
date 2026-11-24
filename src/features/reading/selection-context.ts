import { buildTextFragmentFromContext } from '../../domain/text-fragment'
import { contextAround } from '../../domain/vocabulary'

export interface SelectionSnippet {
    context: string
    textFragment?: string
}

export function selectionContext(
    range: Range,
    selected: string,
    block?: Element | null,
    separator = '',
): string {
    return selectionContextWithFragment(range, selected, block, separator).context
}

export function selectionContextWithFragment(
    range: Range,
    selected: string,
    block?: Element | null,
    separator = '',
): SelectionSnippet {
    const start = range.startContainer
    if (!(start instanceof Text)) return { context: '' }
    return contextWithFragmentAt(start, range.startOffset, selected, block, separator)
}

export function contextAt(
    start: Text,
    offset: number,
    selected: string,
    block = start.parentElement?.closest('p,li,th,td,blockquote,h1,h2,h3,h4,h5,h6'),
    separator = '',
): string {
    return contextWithFragmentAt(start, offset, selected, block, separator).context
}

export function contextWithFragmentAt(
    start: Text,
    offset: number,
    selected: string,
    block = start.parentElement?.closest('p,li,th,td,blockquote,h1,h2,h3,h4,h5,h6'),
    separator = '',
): SelectionSnippet {
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
        if (position !== undefined && position < content.length) {
            return {
                context: contextAround(content, selected, 1000, position),
                textFragment: buildTextFragmentFromContext(content, selected, position),
            }
        }
    }
    const from = Math.max(0, offset - 500)
    const slice = start.data.slice(from, offset + selected.length + 500)
    const relativeOffset = offset - from
    return {
        context: contextAround(slice, selected, 1000, relativeOffset),
        textFragment: buildTextFragmentFromContext(slice, selected, relativeOffset),
    }
}
