import { t } from '../i18n'
import { database } from './database'
import {
    backupSchema,
    defaultCollectionId,
    savedMeaningSchema,
    vocabularyCollectionSchema,
    type Backup,
    type CollectionLanguage,
    type LearningLevel,
    type VocabularyCollection,
    type Word,
    type WordSource,
    type WordState,
} from '../domain/models'
import { activeCollectionId, defaultCollection, sortCollections } from '../domain/collections'
import { normalizeWord } from '../domain/vocabulary'

function encounterId(key: string, source: WordSource): string {
    return JSON.stringify([key, source.documentId ?? source.url, source.page ?? 0, source.context])
}

export async function listCollections(): Promise<VocabularyCollection[]> {
    const db = await database
    const tx = db.transaction('collections', 'readwrite')
    const store = tx.store
    const existing = await store.getAll()
    if (!existing.length) {
        const seeded = defaultCollection(Date.now())
        await store.put(seeded)
        await tx.done
        return [seeded]
    }
    await tx.done
    return sortCollections(existing)
}

export async function saveCollection(input: {
    id?: string
    language: CollectionLanguage
    name: string
    description: string
    pinned?: boolean
}): Promise<VocabularyCollection> {
    const db = await database
    const tx = db.transaction('collections', 'readwrite')
    const store = tx.store
    const now = Date.now()
    let record: VocabularyCollection
    if (input.id) {
        const existing =
            (await store.get(input.id)) ??
            (input.id === defaultCollectionId ? defaultCollection(now) : undefined)
        if (!existing) throw new Error(t('library.collectionNotFound'))
        record = vocabularyCollectionSchema.parse({
            ...existing,
            language: input.language,
            name: input.name,
            description: input.description,
            pinned: input.pinned ?? existing.pinned,
            updatedAt: now,
        })
    } else {
        record = vocabularyCollectionSchema.parse({
            id: crypto.randomUUID(),
            language: input.language,
            name: input.name,
            description: input.description,
            pinned: input.pinned ?? false,
            createdAt: now,
            updatedAt: now,
        })
    }
    await store.put(record)
    await tx.done
    return record
}

export async function toggleCollectionPin(id: string): Promise<VocabularyCollection> {
    const db = await database
    const tx = db.transaction('collections', 'readwrite')
    const store = tx.store
    const now = Date.now()
    const existing =
        (await store.get(id)) ?? (id === defaultCollectionId ? defaultCollection(now) : undefined)
    if (!existing) throw new Error(t('library.collectionNotFound'))
    const updated = { ...existing, pinned: !existing.pinned, updatedAt: now }
    await store.put(updated)
    await tx.done
    return updated
}

export async function loadEncounterMeaning(text: string, source: WordSource) {
    const db = await database
    return (await db.get('encounters', encounterId(normalizeWord(text), source)))?.meaning
}

export async function saveWord(
    text: string,
    state: WordState,
    source?: WordSource,
    options?: {
        level?: LearningLevel
        reviewed?: boolean
        id?: string
        meaning?: string
        collectionId?: string
        defaultCollectionId?: string
    },
): Promise<void> {
    const key = normalizeWord(text)
    if (!key || key.length > 200) throw new Error(t('backup.length'))
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities', 'collections'], 'readwrite')
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
    const collections = await tx.objectStore('collections').getAll()
    const preferredDefault =
        options?.defaultCollectionId && collections.some((item) => item.id === options.defaultCollectionId)
            ? options.defaultCollectionId
            : undefined
    const collectionId =
        options?.collectionId ?? previous?.collectionId ?? preferredDefault ?? activeCollectionId(collections)
    const collectionChanged = options?.collectionId !== undefined && collectionId !== previous?.collectionId
    if (changed || options?.reviewed || meaning !== previous?.meaning || collectionChanged) {
        await words.put({
            key,
            text: previous?.text ?? text.trim(),
            ...rating,
            meaning,
            collectionId,
            updatedAt: now,
        })
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

export async function updateWord(input: {
    originalKey: string
    text: string
    meaning?: string
    state: WordState
    level?: LearningLevel
    collectionId?: string
}): Promise<Word> {
    const newKey = normalizeWord(input.text)
    if (!newKey || newKey.length > 200) throw new Error(t('backup.length'))
    if (input.state !== 'learning' && input.level !== undefined) throw new Error(t('rating.invalidLevel'))
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities'], 'readwrite')
    const words = tx.objectStore('words')
    const previous = await words.get(input.originalKey)
    if (!previous) throw new Error(t('library.wordNotFound'))
    const level = input.state === 'learning' ? (input.level ?? previous.level ?? 1) : undefined
    const meaning =
        input.meaning !== undefined
            ? input.meaning.trim()
                ? savedMeaningSchema.parse(input.meaning)
                : undefined
            : previous.meaning
    const collectionId = input.collectionId ?? previous.collectionId ?? defaultCollectionId
    const now = Date.now()
    const updated: Word = {
        key: newKey,
        text: input.text.trim(),
        state: input.state,
        level,
        meaning,
        collectionId,
        updatedAt: now,
    }
    if (newKey !== input.originalKey) {
        if (await words.get(newKey)) throw new Error(t('library.duplicateWord'))
        await words.delete(input.originalKey)
        await words.put(updated)
        const encounters = tx.objectStore('encounters')
        const matchedEncounters = await encounters.index('wordKey').getAll(input.originalKey)
        for (const encounter of matchedEncounters) {
            await encounters.delete(encounter.id)
            await encounters.put({ ...encounter, id: encounterId(newKey, encounter), wordKey: newKey })
        }
        let cursor = await tx.objectStore('activities').openCursor()
        while (cursor) {
            if (cursor.value.wordKey === input.originalKey) {
                await cursor.update({ ...cursor.value, wordKey: newKey })
            }
            cursor = await cursor.continue()
        }
    } else {
        await words.put(updated)
    }
    if (previous.state !== input.state || (previous.level ?? 1) !== (level ?? 1)) {
        await tx.objectStore('activities').add({
            id: crypto.randomUUID(),
            wordKey: newKey,
            kind: 'rated',
            rating: { state: input.state, level },
            createdAt: now,
        })
    }
    await tx.done
    return updated
}

export async function deleteWord(key: string): Promise<void> {
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities'], 'readwrite')
    await tx.objectStore('words').delete(key)
    let encounterCursor = await tx.objectStore('encounters').index('wordKey').openCursor(key)
    while (encounterCursor) {
        await encounterCursor.delete()
        encounterCursor = await encounterCursor.continue()
    }
    let activityCursor = await tx.objectStore('activities').openCursor()
    while (activityCursor) {
        if (activityCursor.value.wordKey === key) await activityCursor.delete()
        activityCursor = await activityCursor.continue()
    }
    await tx.done
}

export async function exportVocabulary(): Promise<Extract<Backup, { version: 2 }>> {
    const collections = await listCollections()
    const db = await database
    const tx = db.transaction(['words', 'encounters', 'activities'])
    return {
        version: 2,
        collections,
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
    const tx = db.transaction(['words', 'encounters', 'activities', 'collections'], 'readwrite')
    if (backup.version === 2 && backup.collections?.length) {
        const collectionStore = tx.objectStore('collections')
        for (const collection of backup.collections) {
            const existing = await collectionStore.get(collection.id)
            if (!existing || collection.updatedAt > existing.updatedAt) await collectionStore.put(collection)
        }
    }
    for (const word of backup.words) {
        const existing = await tx.objectStore('words').get(word.key)
        if (!existing || word.updatedAt > existing.updatedAt) {
            await tx.objectStore('words').put({
                ...word,
                meaning: word.meaning ?? existing?.meaning,
                collectionId: word.collectionId ?? existing?.collectionId,
            })
        }
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
