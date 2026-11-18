import { database } from './database'
import {
    backupSchema,
    type Backup,
    type LearningLevel,
    type WordSource,
    type WordState,
} from '../domain/models'
import { normalizeWord } from '../domain/vocabulary'

export async function saveWord(
    text: string,
    state: WordState,
    source?: WordSource,
    options?: { level?: LearningLevel; reviewed?: boolean; id?: string },
): Promise<void> {
    const key = normalizeWord(text)
    if (!key || key.length > 200) throw new Error('请选择 200 字符以内的单词或短语')
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities'], 'readwrite')
    const words = tx.objectStore('words')
    const activities = tx.objectStore('activities')
    const id = options?.id ?? crypto.randomUUID()
    if (await activities.getKey(id)) {
        await tx.done
        return
    }
    const previous = await words.get(key)
    const now = Date.now()
    const level = state === 'learning' ? (options?.level ?? previous?.level ?? 1) : undefined
    const rating = { state, level }
    const changed = !previous || previous.state !== state || (previous.level ?? 1) !== (level ?? 1)
    if (changed || options?.reviewed) {
        await words.put({ key, text: previous?.text ?? text.trim(), ...rating, updatedAt: now })
        await activities.add({
            id,
            wordKey: key,
            kind: options?.reviewed ? 'reviewed' : previous ? 'rated' : 'added',
            rating,
            createdAt: now,
        })
    }
    if (source) {
        const id = JSON.stringify([key, source.documentId ?? source.url, source.page ?? 0, source.context])
        const previous = await tx.objectStore('encounters').get(id)
        await tx.objectStore('encounters').put({
            ...source,
            id,
            wordKey: key,
            createdAt: previous?.createdAt ?? now,
        })
    }
    await tx.done
}

export async function exportVocabulary(): Promise<Extract<Backup, { version: 2 }>> {
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities'])
    return {
        version: 2,
        words: await tx.objectStore('words').getAll(),
        encounters: await tx.objectStore('encounters').getAll(),
        activities: await tx.objectStore('activities').getAll(),
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
    const activities = backup.version === 2 ? backup.activities : []
    if (activities.some((activity) => !keys.has(activity.wordKey))) {
        throw new Error('备份中存在缺失词条的学习活动')
    }
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities'], 'readwrite')
    for (const word of backup.words) {
        const existing = await tx.objectStore('words').get(word.key)
        if (!existing || word.updatedAt > existing.updatedAt) await tx.objectStore('words').put(word)
    }
    for (const encounter of backup.encounters) await tx.objectStore('encounters').put(encounter)
    const store = tx.objectStore('activities')
    for (const activity of activities) {
        if (!(await store.getKey(activity.id))) await store.add(activity)
    }
    await tx.done
    return backup.words.length
}
