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
const { exportVocabulary, importVocabulary, saveWord } = await import('../src/data/vocabulary-repository')

it('upgrades a version 1 database without losing words, encounters, or PDF progress', async () => {
    const db = await database
    expect(db.version).toBe(2)
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
})
