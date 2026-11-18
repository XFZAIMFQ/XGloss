import { openDB, type DBSchema } from 'idb'
import type { Encounter, ReadingProgress, Word } from '../domain/models'

interface XGlossDatabase extends DBSchema {
    words: { key: string; value: Word }
    encounters: { key: string; value: Encounter; indexes: { wordKey: string } }
    translations: { key: string; value: { key: string; text: string; createdAt: number } }
    progress: { key: string; value: ReadingProgress }
}

export const database = openDB<XGlossDatabase>('xgloss', 1, {
    upgrade(db) {
        db.createObjectStore('words', { keyPath: 'key' })
        const encounters = db.createObjectStore('encounters', { keyPath: 'id' })
        encounters.createIndex('wordKey', 'wordKey')
        db.createObjectStore('translations', { keyPath: 'key' })
        db.createObjectStore('progress', { keyPath: 'id' })
    },
})
