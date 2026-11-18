import type { Word } from './models'

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
    return text.normalize('NFKC').trim().replaceAll('’', "'").toLowerCase()
}

export function contextAround(text: string, selected: string, limit = 1000): string {
    const compact = text.replace(/\s+/g, ' ').trim()
    const index = compact.toLowerCase().indexOf(selected.toLowerCase())
    const start = Math.max(0, index - Math.floor((limit - selected.length) / 2))
    return compact.slice(start, start + limit)
}

export function tokenize(text: string): Token[] {
    const tokens: Token[] = []
    const excluded = [
        ...text.matchAll(/(?:https?:\/\/|www\.)\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g),
    ]
    let exclusion = 0
    for (const match of text.matchAll(/\b[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*\b/g)) {
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
