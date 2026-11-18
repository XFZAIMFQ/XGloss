import { t } from '../i18n'
import { database } from './database'
import {
    backupSchema,
    type Backup,
    type LearningLevel,
    type WordSource,
    type WordState,
} from '../domain/models'
import { normalizeWord } from '../domain/vocabulary'

function encounterId(key: string, source: WordSource): string {
    return JSON.stringify([key, source.documentId ?? source.url, source.page ?? 0, source.context])
}

export async function loadEncounterMeaning(text: string, source: WordSource) {
    const db = await database
    return (await db.get('encounters', encounterId(normalizeWord(text), source)))?.meaning
}

export async function saveWord(
    text: string,
    state: WordState,
    source?: WordSource,
    options?: { level?: LearningLevel; reviewed?: boolean; id?: string; meaning?: string },
): Promise<void> {
    const key = normalizeWord(text)
    if (!key || key.length > 200) throw new Error(t('backup.length'))
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
    const meaning = options?.meaning ?? previous?.meaning
    if (changed || options?.reviewed || meaning !== previous?.meaning) {
        await words.put({ key, text: previous?.text ?? text.trim(), ...rating, meaning, updatedAt: now })
    }
    if (changed || options?.reviewed) {
        await activities.add({
            id,
            wordKey: key,
            kind: options?.reviewed ? 'reviewed' : previous ? 'rated' : 'added',
            rating,
            createdAt: now,
        })
    }
    if (source) {
        const id = encounterId(key, source)
        const previous = await tx.objectStore('encounters').get(id)
        await tx.objectStore('encounters').put({
            ...source,
            id,
            wordKey: key,
            createdAt: previous?.createdAt ?? now,
            meaning: options?.meaning ?? previous?.meaning,
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
        throw new Error(t('backup.invalidKey'))
    }
    if (backup.encounters.some((encounter) => !keys.has(encounter.wordKey))) {
        throw new Error(t('backup.missingEncounterWord'))
    }
    const activities = backup.version === 2 ? backup.activities : []
    if (activities.some((activity) => !keys.has(activity.wordKey))) {
        throw new Error(t('backup.missingActivityWord'))
    }
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities'], 'readwrite')
    for (const word of backup.words) {
        const existing = await tx.objectStore('words').get(word.key)
        if (!existing || word.updatedAt > existing.updatedAt)
            await tx.objectStore('words').put({ ...word, meaning: word.meaning ?? existing?.meaning })
    }
    for (const encounter of backup.encounters) {
        const store = tx.objectStore('encounters')
        const existing = encounter.meaning === undefined ? await store.get(encounter.id) : undefined
        await store.put({ ...encounter, meaning: encounter.meaning ?? existing?.meaning })
    }
    const store = tx.objectStore('activities')
    for (const activity of activities) {
        if (!(await store.getKey(activity.id))) await store.add(activity)
    }
    await tx.done
    return backup.words.length
}
