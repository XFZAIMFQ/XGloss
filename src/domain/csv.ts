import { normalizeWord } from './vocabulary'
import { wordStateSchema, type Backup, type WordState } from './models'

export function parseWordCsv(text: string): Backup {
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
    if (quoted) throw new Error('CSV 引号未闭合')
    if (field || row.length) {
        row.push(field.replace(/\r$/, ''))
        rows.push(row)
    }
    const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) ?? []
    const wordColumn = headers.indexOf('word')
    const stateColumn = headers.indexOf('state')
    if (wordColumn < 0) throw new Error('CSV 需要 word 列，可选 state 列填写 learning、known 或 ignored')
    const words = new Map<string, Backup['words'][number]>()
    for (const row of rows) {
        let text = row[wordColumn]?.trim() ?? ''
        if (!text) continue
        // Reverse the spreadsheet formula protection used by our CSV exporter.
        if (/^'[=+@-]/.test(text)) text = text.slice(1)
        const state: WordState =
            stateColumn >= 0 ? wordStateSchema.parse(row[stateColumn]?.trim() || 'learning') : 'learning'
        if (text.length > 200) throw new Error('CSV 中存在超过 200 字符的词条')
        const key = normalizeWord(text)
        words.set(key, { key, text, state, updatedAt: Date.now() })
    }
    return { version: 1, words: [...words.values()], encounters: [] }
}
