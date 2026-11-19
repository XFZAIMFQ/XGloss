import { t } from '../i18n'
import { z } from 'zod'

export const collectionLanguages = ['en', 'ja', 'ko', 'de', 'fr', 'es', 'ru', 'it'] as const
export const collectionLanguageSchema = z.enum(collectionLanguages)
export type CollectionLanguage = z.infer<typeof collectionLanguageSchema>
export const defaultCollectionId = 'en'
export const collectionIdSchema = z.string().trim().min(1).max(100)
export const vocabularyCollectionSchema = z.object({
    id: collectionIdSchema,
    language: collectionLanguageSchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(''),
    pinned: z.boolean().default(false),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
})
export type VocabularyCollection = z.infer<typeof vocabularyCollectionSchema>

export const wordStateSchema = z.enum(['learning', 'known', 'ignored'])
export type WordState = z.infer<typeof wordStateSchema>
export const learningLevels = [1, 2, 3, 4] as const
export const learningLevelSchema = z.literal(learningLevels)
export type LearningLevel = z.infer<typeof learningLevelSchema>
export const wordRatingSchema = z.object({ state: wordStateSchema, level: learningLevelSchema.optional() })
export type WordRating = z.infer<typeof wordRatingSchema>
export const savedMeaningSchema = z.string().trim().min(1).max(300)
export const wordSchema = wordRatingSchema.extend({
    key: z.string().min(1).max(200),
    text: z.string().min(1).max(200),
    updatedAt: z.number().finite(),
    meaning: savedMeaningSchema.optional(),
    collectionId: collectionIdSchema.optional(),
})
export type Word = z.infer<typeof wordSchema>
export const sourceSchema = z.object({
    title: z.string().max(1000),
    url: z.string().max(8000),
    context: z.string().max(3000),
    page: z.number().int().positive().optional(),
    documentId: z.string().max(500).optional(),
})
export type WordSource = z.infer<typeof sourceSchema>
export const encounterSchema = sourceSchema.extend({
    id: z.string().min(1),
    wordKey: z.string().min(1),
    createdAt: z.number().finite(),
    meaning: savedMeaningSchema.optional(),
})
export type Encounter = z.infer<typeof encounterSchema>
export const activitySchema = z.object({
    id: z.string().uuid(),
    wordKey: z.string().min(1).max(200),
    kind: z.enum(['added', 'rated', 'reviewed']),
    rating: wordRatingSchema,
    createdAt: z.number().finite(),
})
export type LearningActivity = z.infer<typeof activitySchema>
const legacyBackupSchema = z.object({
    version: z.literal(1),
    words: z.array(wordSchema).max(200_000),
    encounters: z.array(encounterSchema).max(500_000),
})
export const backupSchema = z.discriminatedUnion('version', [
    legacyBackupSchema,
    legacyBackupSchema.extend({
        version: z.literal(2),
        activities: z.array(activitySchema).max(500_000),
        collections: z.array(vocabularyCollectionSchema).max(200).optional(),
    }),
])
export type Backup = z.infer<typeof backupSchema>
export const translationSettingsSchema = z.object({
    baseUrl: z.string().max(2000),
    apiKey: z.string().max(4000),
    model: z.string().max(200),
    targetLanguage: z.string().min(1).max(100),
    timeoutMs: z.number().int().min(1000).max(120_000),
})
export type TranslationSettings = z.infer<typeof translationSettingsSchema>
export const defaultTranslationSettings: TranslationSettings = {
    baseUrl: '',
    apiKey: '',
    model: '',
    targetLanguage: t('common.simplifiedChinese'),
    timeoutMs: 30_000,
}
export const translationInputSchema = z.object({
    text: z.string().trim().min(1).max(2000),
    context: z.string().max(3000).default(''),
})
export type TranslationInput = z.infer<typeof translationInputSchema>
export const translationResultSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('meanings'),
        meanings: z
            .array(
                z.object({
                    text: z.string().trim().min(1).max(300),
                    partOfSpeech: z.string().trim().max(40).optional(),
                }),
            )
            .min(1)
            .max(5),
    }),
    z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(8000) }),
])
export type TranslationResult = z.infer<typeof translationResultSchema>
export const definitionModeSchema = z.enum(['simple', 'detailed'])
export type DefinitionMode = z.infer<typeof definitionModeSchema>
export interface DictionaryEntry {
    word: string
    phonetic: string
    translation: string
    definition: string
    exchange: string
}
export interface ReadingProgress {
    id: string
    page: number
    updatedAt: number
}
export const pdfBookmarkSchema = z.object({
    documentId: z.string().min(1).max(500),
    page: z.number().int().positive(),
})
export type PdfBookmark = z.infer<typeof pdfBookmarkSchema>

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : t('common.retryError')
}
