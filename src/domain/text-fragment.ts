const maxDirectFragmentLength = 80
const maxDirectiveLength = 1000
const maxAffixLength = 36
const targetAffixWords = 3
const rangeEdgeWords = 4

const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })

function encodeTextFragmentPart(text: string): string {
    return encodeURIComponent(text).replaceAll('-', '%2D')
}

function normalizeInlineWhitespace(text: string): string {
    return text.replace(/[\t \r\f\v]+/g, ' ')
}

function normalizeFragmentText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

export function stripTextFragment(rawUrl: string): string {
    const trimmed = rawUrl.trim()
    if (!trimmed) return ''
    try {
        const parsed = new URL(trimmed)
        if (!['http:', 'https:'].includes(parsed.protocol)) return trimmed
        const directiveIndex = parsed.hash.indexOf(':~:')
        if (directiveIndex >= 0) {
            parsed.hash = parsed.hash.slice(0, directiveIndex)
        }
        return parsed.hash ? parsed.href : parsed.href.replace(/#$/, '')
    } catch {
        return trimmed
    }
}

export function extractFragmentAffixes(
    fullText: string,
    matchStart: number,
    matchLength: number,
): { prefix?: string; suffix?: string } {
    if (!fullText || matchStart < 0 || matchLength <= 0 || matchStart >= fullText.length) return {}

    const beforeRaw = fullText.slice(0, matchStart)
    const beforeLine = beforeRaw.slice(beforeRaw.lastIndexOf('\n') + 1)
    const before = normalizeInlineWhitespace(beforeLine).trimEnd()

    const afterRaw = fullText.slice(matchStart + matchLength)
    const nextNewline = afterRaw.indexOf('\n')
    const afterLine = nextNewline >= 0 ? afterRaw.slice(0, nextNewline) : afterRaw
    const after = normalizeInlineWhitespace(afterLine).trimStart()

    let prefix: string | undefined
    if (before) {
        const words = [...wordSegmenter.segment(before)].filter((segment) => segment.isWordLike)
        if (words.length) {
            let startIndex = words[words.length - 1]!.index
            let taken = 1
            for (let i = words.length - 2; i >= 0 && taken < targetAffixWords; i--) {
                const candidateStart = words[i]!.index
                if (before.length - candidateStart > maxAffixLength) break
                startIndex = candidateStart
                taken++
            }
            const candidate = before.slice(startIndex).trim()
            if (candidate && candidate.length <= maxAffixLength) prefix = candidate
        }
    }

    let suffix: string | undefined
    if (after) {
        const words = [...wordSegmenter.segment(after)].filter((segment) => segment.isWordLike)
        if (words.length) {
            let endIndex = words[0]!.index + words[0]!.segment.length
            let taken = 1
            for (let i = 1; i < words.length && taken < targetAffixWords; i++) {
                const candidateEnd = words[i]!.index + words[i]!.segment.length
                if (candidateEnd > maxAffixLength) break
                endIndex = candidateEnd
                taken++
            }
            const candidate = after.slice(0, endIndex).trim()
            if (candidate && candidate.length <= maxAffixLength) suffix = candidate
        }
    }

    return { prefix, suffix }
}

export function buildTextFragmentDirective(input: {
    text: string
    prefix?: string
    suffix?: string
}): string | undefined {
    const exact = normalizeFragmentText(input.text)
    if (!exact) return undefined

    let textStart = exact
    let textEnd: string | undefined
    if (exact.length > maxDirectFragmentLength) {
        const words = [...wordSegmenter.segment(exact)].filter((segment) => segment.isWordLike)
        if (words.length >= rangeEdgeWords * 2) {
            const firstEdge = words[rangeEdgeWords - 1]!
            const lastEdge = words[words.length - rangeEdgeWords]!
            textStart = exact.slice(0, firstEdge.index + firstEdge.segment.length).trim()
            textEnd = exact.slice(lastEdge.index).trim()
        } else {
            textStart = exact.slice(0, maxDirectFragmentLength).trim()
        }
    }

    const prefix = input.prefix ? normalizeFragmentText(input.prefix) : undefined
    const suffix = input.suffix ? normalizeFragmentText(input.suffix) : undefined

    const assemble = (withPrefix?: string, withSuffix?: string) => {
        const parts: string[] = []
        if (withPrefix) parts.push(`${encodeTextFragmentPart(withPrefix)}-`)
        parts.push(encodeTextFragmentPart(textStart))
        if (textEnd) parts.push(encodeTextFragmentPart(textEnd))
        if (withSuffix) parts.push(`-${encodeTextFragmentPart(withSuffix)}`)
        return `:~:text=${parts.join(',')}`
    }

    const full = assemble(prefix, suffix)
    if (full.length <= maxDirectiveLength) return full
    const minimal = assemble()
    return minimal.length <= maxDirectiveLength ? minimal : undefined
}

export function buildTextFragmentFromContext(
    context: string,
    selected: string,
    sourceOffset?: number,
): string | undefined {
    const exact = normalizeFragmentText(selected)
    if (!exact) return undefined
    if (context) {
        let index = -1
        let length = selected.length
        if (sourceOffset !== undefined && sourceOffset >= 0 && sourceOffset < context.length) {
            const candidate = context.slice(sourceOffset, sourceOffset + selected.length)
            if (candidate.toLowerCase() === selected.toLowerCase()) {
                index = sourceOffset
            } else {
                const exactIndex = context
                    .toLowerCase()
                    .indexOf(exact.toLowerCase(), Math.max(0, sourceOffset - 4))
                if (exactIndex >= 0 && exactIndex <= sourceOffset + 8) {
                    index = exactIndex
                    length = exact.length
                }
            }
        }
        if (index < 0) {
            const normalizedContext = context
            const direct = normalizedContext.toLowerCase().indexOf(exact.toLowerCase())
            if (direct >= 0) {
                index = direct
                length = exact.length
            }
        }
        if (index >= 0) {
            const matchedText = context.slice(index, index + length)
            const { prefix, suffix } = extractFragmentAffixes(context, index, length)
            return buildTextFragmentDirective({ text: matchedText, prefix, suffix })
        }
    }
    return buildTextFragmentDirective({ text: exact })
}

export function buildEncounterHighlightUrl(
    rawUrl: string,
    wordText: string,
    context: string,
    storedFragment?: string,
): string | undefined {
    const trimmed = rawUrl.trim()
    if (!trimmed) return undefined
    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        return undefined
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined

    const base = stripTextFragment(parsed.href)
    const cleanParsed = new URL(base)
    const directive =
        storedFragment && storedFragment.startsWith(':~:text=')
            ? storedFragment
            : buildTextFragmentFromContext(context, wordText)
    if (!directive) return base
    return cleanParsed.hash ? `${base}${directive}` : `${base}#${directive}`
}
