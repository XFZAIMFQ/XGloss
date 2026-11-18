import { t } from '../i18n'
import { learningLevels, type Word, type WordRating } from './models'

export const highlightKinds = [
    'unknown',
    ...learningLevels.map((level) => `learning-${level}` as const),
] as const
export type HighlightKind = (typeof highlightKinds)[number]

export function ratingLabel(rating: WordRating): string {
    if (rating.state === 'learning') return t('rating.learningLevel', { level: rating.level ?? 1 })
    return rating.state === 'known' ? t('common.known') : t('common.ignored')
}

export function highlightKind(rating: WordRating | undefined): HighlightKind | undefined {
    if (!rating) return 'unknown'
    if (rating.state === 'learning') return `learning-${rating.level ?? 1}`
}

export interface Token {
    text: string
    key: string
    start: number
    end: number
}
export interface Frequency {
    key: string
    count: number
}
export interface Coverage {
    total: number
    known: number
    learning: number
    unknown: number
    percent: number | null
    candidates: Frequency[]
}

export function normalizeWord(text: string): string {
    return text.normalize('NFKC').trim().replaceAll('\u2019', "'").toLowerCase()
}

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

export function contextAround(text: string, selected: string, limit = 1000, sourceOffset?: number): string {
    const compact = text.replace(/\s+/g, ' ').trim()
    const needle = selected.replace(/\s+/g, ' ').trim().toLowerCase()
    const index =
        sourceOffset === undefined
            ? compact.toLowerCase().indexOf(needle)
            : text.slice(0, sourceOffset).replace(/\s+/g, ' ').trimStart().length
    if (index < 0 || !needle) return ''
    const start = Math.max(0, index - Math.floor(limit / 2))
    const end = index + needle.length + Math.floor(limit / 2)
    const excerpt = compact.slice(start, end)
    const segment = sentenceSegmenter.segment(excerpt).containing(index - start)
    if (segment && index - start + needle.length <= segment.index + segment.segment.length)
        return segment.segment.trim().slice(0, limit)
    return excerpt.slice(0, limit)
}

export function tokenize(text: string): Token[] {
    const tokens: Token[] = []
    const excluded = [
        ...text.matchAll(/(?:https?:\/\/|www\.)\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g),
    ]
    let exclusion = 0
    for (const match of text.matchAll(/\b[A-Za-z]+(?:['\u2019][A-Za-z]+)*(?:-[A-Za-z]+)*\b/g)) {
        const start = match.index
        const end = start + match[0].length
        while (excluded[exclusion] && excluded[exclusion]!.index + excluded[exclusion]![0].length <= start)
            exclusion++
        if (
            excluded[exclusion] &&
            start >= excluded[exclusion]!.index &&
            start < excluded[exclusion]!.index + excluded[exclusion]![0].length
        )
            continue
        // Identifiers, URLs and paths are excluded as complete lexical units.
        const surrounding = text.slice(Math.max(0, start - 1), end + 1)
        if (/[\d_/@\\]/.test(surrounding)) continue
        tokens.push({ text: match[0], key: normalizeWord(match[0]), start, end })
    }
    return tokens
}

export function countTokens(tokens: Token[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const token of tokens) counts.set(token.key, (counts.get(token.key) ?? 0) + 1)
    return counts
}

export function calculateCoverage(counts: Map<string, number>, words: Word[]): Coverage {
    const states = new Map(words.map((word) => [word.key, word.state]))
    let total = 0
    let known = 0
    let learning = 0
    const candidates: Frequency[] = []
    for (const [key, count] of counts) {
        const state = states.get(key)
        if (state === 'ignored') continue
        total += count
        if (state === 'known') known += count
        else if (state === 'learning') learning++
        else candidates.push({ key, count })
    }
    candidates.sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    return {
        total,
        known,
        learning,
        unknown: candidates.length,
        percent: total < 20 ? null : known === total ? 100 : Math.floor((known / total) * 100),
        candidates: candidates.slice(0, 15),
    }
}
