import { database } from './database'
import { backupSchema, type Backup, type WordSource, type WordState } from '../domain/models'
import { normalizeWord } from '../domain/vocabulary'

export async function saveWord(text: string, state: WordState, source?: WordSource): Promise<void> {
    const key = normalizeWord(text)
    if (!key || key.length > 200) throw new Error('请选择 200 字符以内的单词或短语')
    const db = await database
    const tx = db.transaction(['words', 'encounters'], 'readwrite')
    await tx.objectStore('words').put({ key, text: text.trim(), state, updatedAt: Date.now() })
    if (source) {
        const id = JSON.stringify([key, source.documentId ?? source.url, source.page ?? 0, source.context])
        const previous = await tx.objectStore('encounters').get(id)
        await tx.objectStore('encounters').put({
            ...source,
            id,
            wordKey: key,
            createdAt: previous?.createdAt ?? Date.now(),
        })
    }
    await tx.done
}

export async function exportVocabulary(): Promise<Backup> {
    const db = await database
    const tx = db.transaction(['words', 'encounters'])
    return {
        version: 1,
        words: await tx.objectStore('words').getAll(),
        encounters: await tx.objectStore('encounters').getAll(),
    }
}

export async function importVocabulary(input: unknown): Promise<number> {
    const backup = backupSchema.parse(input)
    const keys = new Set(backup.words.map((word) => word.key))
    if (backup.words.some((word) => normalizeWord(word.text) !== word.key)) {
        throw new Error('词条键与单词不匹配')
    }
    if (backup.encounters.some((encounter) => !keys.has(encounter.wordKey))) {
        throw new Error('备份中存在缺失词条的遇词记录')
    }
    const db = await database
    const tx = db.transaction(['words', 'encounters'], 'readwrite')
    for (const word of backup.words) {
        const existing = await tx.objectStore('words').get(word.key)
        if (!existing || word.updatedAt > existing.updatedAt) await tx.objectStore('words').put(word)
    }
    for (const encounter of backup.encounters) await tx.objectStore('encounters').put(encounter)
    await tx.done
    return backup.words.length
}
