import type { DefinitionMode, DictionaryEntry } from './models'

const punctuation: Record<string, string> = {
    '\u3002': '.',
    '\u3001': ',',
    '\u300c': '"',
    '\u300d': '"',
    '\u300e': "'",
    '\u300f': "'",
    '\u3010': '[',
    '\u3011': ']',
    '\u300a': '<',
    '\u300b': '>',
    '\u3008': '<',
    '\u3009': '>',
    '\u201c': '"',
    '\u201d': '"',
    '\u2018': "'",
    '\u2019': "'",
    '\u2026': '...',
    '\u2014': '-',
    '\u00b7': '.',
    '\u3000': ' ',
}

export function halfWidthPunctuation(text: string): string {
    return text.replace(
        /[\u3000-\u3002\u3008-\u300f\u3010\u3011\u2018\u2019\u201c\u201d\u2026\u2014\u00b7\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff5e]/g,
        (character) => punctuation[character] ?? String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
}

const partOfSpeech =
    /^(?:(?:n|v|vt|vi|a|adj|ad|adv|r|prep|pron|conj|interj|int|num|art|aux|abbr|det|pl|s)\.\s*)+/i

export function dictionaryMeanings(entry: DictionaryEntry | null, mode: DefinitionMode): string[] {
    const text = entry?.translation || entry?.definition
    if (!text) return []
    const lines = text
        .split(/\r?\n/)
        .map((line) => halfWidthPunctuation(line).trim())
        .filter(Boolean)
    if (mode === 'detailed') return lines
    const translations = entry.translation ? /[,;](?![^([]*[)\]])/ : /;/
    return [
        ...new Set(
            lines
                .flatMap((line) => line.replace(partOfSpeech, '').split(translations))
                .map((meaning) => meaning.trim())
                .filter(Boolean),
        ),
    ]
}

const wordPattern = /^\p{L}+(?:[\p{L}\p{M}]|['\u2019-](?=\p{L}))*$/u

export function isWordSelection(text: string): boolean {
    return wordPattern.test(text)
}

export function isPassageSelection(text: string): boolean {
    if (isWordSelection(text)) return false
    return /[.!?]["')\]]?$|[.!?]\s|[\u3002\uff01\uff1f]/.test(text) || text.split(/\s+/).length >= 9
}
