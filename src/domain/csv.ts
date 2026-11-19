import { t } from '../i18n'
import { normalizeWord } from './vocabulary'
import {
    learningLevelSchema,
    savedMeaningSchema,
    wordStateSchema,
    type Backup,
    type Encounter,
    type LearningLevel,
    type WordState,
} from './models'

function parseWordByWordStatus(rawStatus: string): { state: WordState; level?: LearningLevel } {
    const value = rawStatus.trim().toLowerCase()
    if (!value) return { state: 'learning', level: 1 }
    if (value === '5' || value === 'known' || value === 'mastered') return { state: 'known' }
    if (value === '0' || value === '-1' || value === 'ignored') return { state: 'ignored' }
    if (value === '1' || value === '2' || value === '3' || value === '4') {
        return { state: 'learning', level: learningLevelSchema.parse(Number(value)) }
    }
    throw new Error(t('csv.invalidStatus'))
}

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
    const wordColumn = headers.indexOf('word') >= 0 ? headers.indexOf('word') : headers.indexOf('term')
    const stateColumn = headers.indexOf('state')
    const statusColumn = headers.indexOf('status')
    const levelColumn = headers.indexOf('level')
    const meaningColumn = headers.indexOf('meaning')
    const exampleColumn = headers.indexOf('example')
    if (wordColumn < 0) throw new Error(t('csv.missingWordColumn'))
    const words = new Map<string, Backup['words'][number]>()
    const encounters = new Map<string, Encounter>()
    const now = Date.now()
    for (const row of rows) {
        let text = row[wordColumn]?.trim() ?? ''
        if (!text) continue
        // Reverse the spreadsheet formula protection used by our CSV exporter.
        if (/^'[=+@-]/.test(text)) text = text.slice(1)
        if (text.length > 200) throw new Error(t('csv.length'))
        const key = normalizeWord(text)
        let state: WordState
        let level: LearningLevel | undefined
        if (stateColumn >= 0) {
            state = wordStateSchema.parse(row[stateColumn]?.trim() || 'learning')
            const rawLevel = levelColumn >= 0 ? row[levelColumn]?.trim() : ''
            level = rawLevel ? learningLevelSchema.parse(Number(rawLevel)) : undefined
            if (level !== undefined && state !== 'learning') throw new Error(t('rating.invalidLevel'))
        } else if (statusColumn >= 0) {
            const parsed = parseWordByWordStatus(row[statusColumn] ?? '')
            state = parsed.state
            level = parsed.level
        } else {
            state = 'learning'
            const rawLevel = levelColumn >= 0 ? row[levelColumn]?.trim() : ''
            level = rawLevel ? learningLevelSchema.parse(Number(rawLevel)) : undefined
        }
        const rawMeaning =
            meaningColumn >= 0
                ? row[meaningColumn]
                      ?.trim()
                      .replace(/^'(?=[=+@-])/, '')
                      .slice(0, 300)
                : ''
        const meaning = rawMeaning ? savedMeaningSchema.parse(rawMeaning) : undefined
        words.set(key, {
            key,
            text,
            state,
            level,
            meaning,
            ...(collectionId ? { collectionId } : {}),
            updatedAt: now,
        })
        const rawExample = exampleColumn >= 0 ? row[exampleColumn]?.trim().slice(0, 3000) : ''
        if (rawExample) {
            encounters.set(key, {
                id: `csv:${key}`,
                wordKey: key,
                title: t('csv.wordByWordSource'),
                url: '',
                context: rawExample,
                createdAt: now,
                meaning,
            })
        }
    }
    return { version: 1, words: [...words.values()], encounters: [...encounters.values()] }
}
