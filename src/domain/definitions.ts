import type { DefinitionMode, DictionaryEntry } from './models'

const partOfSpeech =
    /^(?:(?:n|v|vt|vi|a|adj|ad|adv|r|prep|pron|conj|interj|int|num|art|aux|abbr|det|pl|s)\.\s*)+/i

export function dictionaryMeanings(entry: DictionaryEntry | null, mode: DefinitionMode): string[] {
    const text = entry?.translation || entry?.definition
    if (!text) return []
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    if (mode === 'detailed') return lines
    const translations = entry.translation ? /[,，;；、](?![^([（【]*[)\]）】])/ : /[;；]/
    return [
        ...new Set(
            lines
                .flatMap((line) => line.replace(partOfSpeech, '').split(translations))
                .map((meaning) => meaning.trim())
                .filter(Boolean),
        ),
    ]
}
