import { openDB, type DBSchema } from 'idb'
import type {
    Encounter,
    LearningActivity,
    PdfBookmark,
    ReadingProgress,
    TranslationResult,
    VocabularyCollection,
    Word,
} from '../domain/models'

interface XGlossDatabase extends DBSchema {
    words: { key: string; value: Word }
    collections: { key: string; value: VocabularyCollection }
    encounters: { key: string; value: Encounter; indexes: { wordKey: string; wordDate: [string, number] } }
    activities: { key: string; value: LearningActivity; indexes: { createdAt: number } }
    bookmarks: { key: [string, number]; value: PdfBookmark; indexes: { documentId: string } }
    translations: {
        key: string
        value: { key: string; createdAt: number } & ({ text: string } | { result: TranslationResult })
    }
    progress: { key: string; value: ReadingProgress }
}

export const database = openDB<XGlossDatabase>('xgloss', 3, {
    upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
            db.createObjectStore('words', { keyPath: 'key' })
            const encounters = db.createObjectStore('encounters', { keyPath: 'id' })
            encounters.createIndex('wordKey', 'wordKey')
            db.createObjectStore('translations', { keyPath: 'key' })
            db.createObjectStore('progress', { keyPath: 'id' })
        }
        if (oldVersion < 2) {
            tx.objectStore('encounters').createIndex('wordDate', ['wordKey', 'createdAt'])
            db.createObjectStore('activities', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
            db.createObjectStore('bookmarks', { keyPath: ['documentId', 'page'] }).createIndex(
                'documentId',
                'documentId',
            )
        }
        if (oldVersion < 3) {
            db.createObjectStore('collections', { keyPath: 'id' })
        }
    },
})
