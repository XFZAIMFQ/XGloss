import { mkdir, readFile, writeFile } from 'node:fs/promises'

const revision = '39cfb9672c0906b63569e0453c2e6abfb9ab182a'
const source = `https://raw.githubusercontent.com/skywind3000/ECDICT/${revision}/`

function parseCsv(text) {
    const rows = []
    let row = []
    let field = ''
    let quoted = false
    for (let index = 0; index < text.length; index++) {
        const character = text[index]
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
    if (field || row.length) {
        row.push(field)
        rows.push(row)
    }
    return rows
}

async function download(path) {
    const cache = `.cache/${path === 'ecdict.csv' ? 'ecdict-' + revision.slice(0, 8) + '.csv' : path + '-' + revision}`
    try {
        return await readFile(cache, 'utf8')
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
    }
    const response = await fetch(source + path, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`Download ${path}: HTTP ${response.status}`)
    const text = await response.text()
    await mkdir('.cache', { recursive: true })
    await writeFile(cache, text)
    return text
}

const [csv, license] = await Promise.all([download('ecdict.csv'), download('LICENSE')])
const [headers, ...rows] = parseCsv(csv)
const shards = Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => [letter, {}]))
let count = 0
for (const row of rows) {
    const entry = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
    const word = entry.word.toLowerCase()
    if (!/^[a-z]/.test(word)) continue
    // Bundle the common vocabulary subset; retain dictionary lookup and inflection metadata.
    if (!(Number(entry.frq) > 0 && Number(entry.frq) <= 60000) && !(Number(entry.collins) > 0) && !entry.tag)
        continue
    shards[word[0]][word] = {
        word: entry.word,
        phonetic: entry.phonetic,
        translation: entry.translation.replaceAll('\\n', '\n'),
        definition: entry.definition.replaceAll('\\n', '\n'),
        exchange: entry.exchange,
    }
    count++
}
if (count < 10000) throw new Error('Dictionary source is incomplete')
await mkdir('public/dictionary', { recursive: true })
for (const [letter, shard] of Object.entries(shards))
    await writeFile(`public/dictionary/${letter}.json`, JSON.stringify(shard))
await writeFile('public/dictionary/LICENSE-ECDICT.txt', license)
await writeFile(
    'public/dictionary/source.json',
    JSON.stringify({ source, revision, file: 'ecdict.csv', entries: count }, null, 4),
)
console.log(`Prepared ${count} ECDICT entries at ${revision}`)
