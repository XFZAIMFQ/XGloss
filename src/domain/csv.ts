import { t } from '../i18n'
import { normalizeWord } from './vocabulary'
import {
    learningLevelSchema,
    savedMeaningSchema,
    wordStateSchema,
    type Backup,
    type WordState,
} from './models'

export function parseWordCsv(text: string, collectionId?: string): Backup {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    text = text.replace(/^\uFEFF/, '')
    for (let index = 0; index < text.length; index++) {
        const character = text[index]!
        if (character === '"') {
            if (quoted && text[index + 1] === '"') {
                field += '"'
                index++
            } else quoted = !quoted
        } else if (character === ',' && !quoted) {
            row.push(field)
            field = ''
        } else if (character === '\n' && !quoted) {
            row.push(field.replace(/\r$/, ''))
            rows.push(row)
            row = []
            field = ''
        } else field += character
    }
    if (quoted) throw new Error(t('csv.unclosedQuote'))
    if (field || row.length) {
        row.push(field.replace(/\r$/, ''))
        rows.push(row)
    }
    const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) ?? []
    const wordColumn = headers.indexOf('word')
    const stateColumn = headers.indexOf('state')
    const levelColumn = headers.indexOf('level')
    const meaningColumn = headers.indexOf('meaning')
    if (wordColumn < 0) throw new Error(t('csv.missingWordColumn'))
    const words = new Map<string, Backup['words'][number]>()
    for (const row of rows) {
        let text = row[wordColumn]?.trim() ?? ''
        if (!text) continue
        // Reverse the spreadsheet formula protection used by our CSV exporter.
        if (/^'[=+@-]/.test(text)) text = text.slice(1)
        const state: WordState =
            stateColumn >= 0 ? wordStateSchema.parse(row[stateColumn]?.trim() || 'learning') : 'learning'
        if (text.length > 200) throw new Error(t('csv.length'))
        const key = normalizeWord(text)
        const rawLevel = row[levelColumn]?.trim()
        const level = rawLevel ? learningLevelSchema.parse(Number(rawLevel)) : undefined
        if (level !== undefined && state !== 'learning') throw new Error(t('rating.invalidLevel'))
        const rawMeaning = row[meaningColumn]?.trim().replace(/^'(?=[=+@-])/, '')
        const meaning = rawMeaning ? savedMeaningSchema.parse(rawMeaning) : undefined
        words.set(key, {
            key,
            text,
            state,
            level,
            meaning,
            ...(collectionId ? { collectionId } : {}),
            updatedAt: Date.now(),
        })
    }
    return { version: 1, words: [...words.values()], encounters: [] }
}
