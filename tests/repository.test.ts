import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { database } from '../src/data/database'
import { exportVocabulary, importVocabulary, saveWord } from '../src/data/vocabulary-repository'

beforeEach(async () => {
    const db = await database
    await db.clear('words')
    await db.clear('encounters')
})
describe('persistent vocabulary', () => {
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
})
