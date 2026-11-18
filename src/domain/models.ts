import { z } from 'zod'

export const wordStateSchema = z.enum(['learning', 'known', 'ignored'])
export type WordState = z.infer<typeof wordStateSchema>
export const wordSchema = z.object({
    key: z.string().min(1).max(200),
    text: z.string().min(1).max(200),
    state: wordStateSchema,
    updatedAt: z.number().finite(),
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
})
export type Encounter = z.infer<typeof encounterSchema>
export const backupSchema = z.object({
    version: z.literal(1),
    words: z.array(wordSchema).max(200_000),
    encounters: z.array(encounterSchema).max(500_000),
})
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
    targetLanguage: '简体中文',
    timeoutMs: 30_000,
}
export const translationInputSchema = z.object({
    text: z.string().trim().min(1).max(2000),
    context: z.string().max(3000).default(''),
})
export type TranslationInput = z.infer<typeof translationInputSchema>
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

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '操作失败，请重试'
}
