import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'

const legacy = await openDB('xgloss', 1, {
    upgrade(db) {
        db.createObjectStore('words', { keyPath: 'key' })
        db.createObjectStore('encounters', { keyPath: 'id' }).createIndex('wordKey', 'wordKey')
        db.createObjectStore('translations', { keyPath: 'key' })
        db.createObjectStore('progress', { keyPath: 'id' })
    },
})
await legacy.put('words', { key: 'legacy', text: 'Legacy', state: 'learning', updatedAt: 3 })
await legacy.put('encounters', {
    id: 'source',
    wordKey: 'legacy',
    title: 'Source',
    url: '',
    context: '',
    createdAt: 2,
})
await legacy.put('progress', { id: 'pdf:legacy', page: 5, updatedAt: 3 })
legacy.close()

const { database } = await import('../src/data/database')
const {
    deleteCollection,
    deleteWord,
    deleteWords,
    exportVocabulary,
    importVocabulary,
    listCollections,
    loadEncounterMeaning,
    saveCollection,
    saveWord,
    toggleCollectionPin,
    updateWord,
} = await import('../src/data/vocabulary-repository')

it('upgrades a version 1 database without losing words, encounters, or PDF progress', async () => {
    const db = await database
    expect(db.version).toBe(3)
    expect(db.objectStoreNames.contains('collections')).toBe(true)
    expect(await db.get('words', 'legacy')).toMatchObject({ state: 'learning' })
    expect((await db.getFromIndex('encounters', 'wordDate', ['legacy', 2]))?.id).toBe('source')
    expect((await db.get('progress', 'pdf:legacy'))?.page).toBe(5)
    expect(await db.count('activities')).toBe(0)
})

describe('persistent vocabulary', () => {
    beforeEach(async () => {
        const db = await database
        await db.clear('words')
        await db.clear('encounters')
        await db.clear('activities')
        await db.clear('collections')
    })
    it('deduplicates repeated encounters and updates state', async () => {
        const source = { title: 'Document', url: 'https://example.com', context: 'hardware register' }
        await saveWord('Register', 'learning', source)
        await saveWord('register', 'known', source)
        const backup = await exportVocabulary()
        expect(backup.words).toHaveLength(1)
        expect(backup.words[0]?.state).toBe('known')
        expect(backup.encounters).toHaveLength(1)
    })
    it('keeps a chosen meaning per encounter and updates it even at the same rating', async () => {
        const first = { title: 'Document', url: 'https://example.com', context: 'Read the register.' }
        const second = { ...first, context: 'Register an account.' }
        await saveWord('register', 'learning', first, { level: 2, meaning: '寄存器' })
        await saveWord('register', 'learning', second, { level: 2, meaning: '登记' })
        const backup = await exportVocabulary()
        expect(backup.activities).toHaveLength(1)
        expect(backup.words[0]?.meaning).toBe('登记')
        expect(await loadEncounterMeaning('Register', first)).toBe('寄存器')
        expect(await loadEncounterMeaning('register', second)).toBe('登记')
        await saveWord('register', 'known', second)
        expect((await exportVocabulary()).words[0]?.meaning).toBe('登记')
        const legacy = {
            version: 1 as const,
            words: [{ key: 'register', text: 'Register', state: 'learning', updatedAt: Date.now() + 1000 }],
            encounters: backup.encounters.map((record) => ({ ...record, meaning: undefined })),
        }
        await importVocabulary(legacy)
        expect((await exportVocabulary()).words[0]?.meaning).toBe('登记')
        expect(await loadEncounterMeaning('register', first)).toBe('寄存器')
    })
    it('validates an entire backup before importing and retains newer state', async () => {
        await saveWord('hello', 'known')
        await expect(
            importVocabulary({ version: 1, words: [{ key: 'bad' }], encounters: [] }),
        ).rejects.toThrow()
        await importVocabulary({
            version: 1,
            words: [{ key: 'hello', text: 'Hello', state: 'learning', updatedAt: 1 }],
            encounters: [],
        })
        expect((await exportVocabulary()).words[0]?.state).toBe('known')
    })
    it('preserves legacy grades and writes history once for each rating or review action', async () => {
        await importVocabulary({
            version: 1,
            words: [{ key: 'hello', text: 'Hello', state: 'learning', updatedAt: 1 }],
            encounters: [],
        })
        expect((await exportVocabulary()).activities).toEqual([])
        const id = crypto.randomUUID()
        await Promise.all([
            saveWord('hello', 'learning', undefined, { level: 4, id }),
            saveWord('hello', 'learning', undefined, { level: 4, id }),
        ])
        await saveWord('hello', 'learning')
        await saveWord('hello', 'learning', undefined, { reviewed: true })
        const backup = await exportVocabulary()
        expect(backup.words[0]).toMatchObject({ state: 'learning', level: 4 })
        expect(backup.activities.map(({ kind }) => kind).sort()).toEqual(['rated', 'reviewed'])
        await importVocabulary(backup)
        expect((await exportVocabulary()).activities).toHaveLength(2)
    })
    it('manages language collections, pinning, and active collection word assignment', async () => {
        const initial = await listCollections()
        expect(initial).toHaveLength(1)
        expect(initial[0]?.id).toBe('en')
        const japanese = await saveCollection({
            language: 'ja',
            name: 'N1 Reading',
            description: 'Japanese novels',
        })
        await saveCollection({
            id: japanese.id,
            language: 'ja',
            name: 'N1 Core',
            description: 'Updated note',
        })
        await toggleCollectionPin('en')
        await toggleCollectionPin(japanese.id)
        const sorted = await listCollections()
        expect(sorted[0]?.id).toBe(japanese.id)
        expect(sorted[0]?.name).toBe('N1 Core')
        expect(sorted[0]?.pinned).toBe(true)
        await saveWord('kotoba', 'learning')
        await saveWord('register', 'learning', undefined, { collectionId: 'en' })
        const backup = await exportVocabulary()
        expect(backup.collections).toHaveLength(2)
        expect(backup.words.find((item) => item.key === 'kotoba')?.collectionId).toBe(japanese.id)
        expect(backup.words.find((item) => item.key === 'register')?.collectionId).toBe('en')
        const db = await database
        await db.clear('words')
        await db.clear('collections')
        await importVocabulary(backup)
        const restored = await listCollections()
        expect(restored.find((item) => item.id === japanese.id)?.name).toBe('N1 Core')
    })
    it('routes new words to preferred defaultCollectionId while keeping existing word collections intact', async () => {
        await listCollections()
        const japanese = await saveCollection({ language: 'ja', name: 'N1 Core', description: '' })
        await saveWord('nihongo', 'learning', undefined, { defaultCollectionId: japanese.id })
        await saveWord('kotoba', 'learning', undefined, { defaultCollectionId: 'missing-id' })
        await saveWord('nihongo', 'known', undefined, { defaultCollectionId: 'en' })
        const db = await database
        expect((await db.get('words', 'nihongo'))?.collectionId).toBe(japanese.id)
        expect((await db.get('words', 'kotoba'))?.collectionId).toBe('en')
    })
    it('edits words, updates or clears meanings, migrates keys atomically, and deletes words', async () => {
        const source = { title: 'Doc', url: 'https://example.com', context: 'Check the register.' }
        await saveWord('register', 'learning', source, { level: 2, meaning: '登记' })
        await saveWord('other', 'known')
        const updatedMeaning = await updateWord({
            originalKey: 'register',
            text: 'register',
            meaning: '寄存器',
            state: 'learning',
            level: 2,
        })
        expect(updatedMeaning.meaning).toBe('寄存器')
        const clearedMeaning = await updateWord({
            originalKey: 'register',
            text: 'register',
            meaning: '',
            state: 'learning',
            level: 2,
        })
        expect(clearedMeaning.meaning).toBeUndefined()
        await expect(
            updateWord({
                originalKey: 'register',
                text: 'other',
                state: 'learning',
                level: 2,
            }),
        ).rejects.toThrow('已存在')
        const renamed = await updateWord({
            originalKey: 'register',
            text: 'Registry',
            meaning: '注册表',
            state: 'known',
        })
        expect(renamed.key).toBe('registry')
        const db = await database
        expect(await db.get('words', 'register')).toBeUndefined()
        expect((await db.getAllFromIndex('encounters', 'wordKey', 'registry')).length).toBe(1)
        const activities = await db.getAll('activities')
        expect(activities.every((item) => item.wordKey === 'registry' || item.wordKey === 'other')).toBe(true)
        await deleteWord('registry')
        expect(await db.get('words', 'registry')).toBeUndefined()
        expect(await db.getAllFromIndex('encounters', 'wordKey', 'registry')).toHaveLength(0)
        expect((await db.getAll('activities')).some((item) => item.wordKey === 'registry')).toBe(false)
    })
    it('deletes collections in move and delete modes while preventing deleting the last collection', async () => {
        await listCollections()
        await expect(deleteCollection({ id: 'en', mode: 'delete' })).rejects.toThrow('至少需要保留一个词库')
        const ja = await saveCollection({ language: 'ja', name: 'Japanese', description: '' })
        const de = await saveCollection({ language: 'de', name: 'German', description: '' })
        const source = { title: 'Doc', url: 'https://example.com', context: 'Sample context.' }
        await saveWord('kotoba', 'learning', source, { collectionId: ja.id })
        await saveWord('wort', 'learning', source, { collectionId: de.id })
        const moved = await deleteCollection({ id: ja.id, mode: 'move', targetCollectionId: 'en' })
        expect(moved.movedWords).toBe(1)
        expect(moved.deletedWords).toBe(0)
        const db = await database
        expect(await db.get('collections', ja.id)).toBeUndefined()
        expect((await db.get('words', 'kotoba'))?.collectionId).toBe('en')
        const deleted = await deleteCollection({ id: de.id, mode: 'delete' })
        expect(deleted.deletedWords).toBe(1)
        expect(await db.get('collections', de.id)).toBeUndefined()
        expect(await db.get('words', 'wort')).toBeUndefined()
        expect(await db.getAllFromIndex('encounters', 'wordKey', 'wort')).toHaveLength(0)
        expect((await db.getAll('activities')).some((item) => item.wordKey === 'wort')).toBe(false)
    })
    it('batch deletes multiple words along with encounters and activities atomically', async () => {
        const source = { title: 'Doc', url: 'https://example.com', context: 'Bulk test.' }
        await saveWord('alpha', 'learning', source)
        await saveWord('beta', 'known', source)
        await saveWord('gamma', 'ignored', source)
        const count = await deleteWords(['alpha', 'beta', 'nonexistent'])
        expect(count).toBe(2)
        const db = await database
        expect((await db.getAll('words')).map((w) => w.key)).toEqual(['gamma'])
        expect((await db.getAll('encounters')).map((e) => e.wordKey)).toEqual(['gamma'])
        expect((await db.getAll('activities')).every((a) => a.wordKey === 'gamma')).toBe(true)
    })
})
