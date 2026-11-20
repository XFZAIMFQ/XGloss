import { t } from '../i18n'
import {
    defaultCollectionId,
    type CollectionLanguage,
    type SourceLanguage,
    type VocabularyCollection,
    type Word,
    type WordSort,
} from './models'

export type FlagCode = CollectionLanguage | 'cn'

export interface LanguageOption {
    code: CollectionLanguage
    flagEmoji: string
    nativeName: string
    label: string
}

export interface SourceLanguageOption {
    code: SourceLanguage
    flag: FlagCode | null
    shortLabel: string
    label: string
}

export interface TargetLanguageOption {
    value: string
    flag: FlagCode
    shortLabel: string
    label: string
}

export const languageOptions: readonly LanguageOption[] = [
    { code: 'en', flagEmoji: '🇺🇸', nativeName: 'English', label: t('language.en') },
    { code: 'ja', flagEmoji: '🇯🇵', nativeName: '日本語', label: t('language.ja') },
    { code: 'ko', flagEmoji: '🇰🇷', nativeName: '한국어', label: t('language.ko') },
    { code: 'de', flagEmoji: '🇩🇪', nativeName: 'Deutsch', label: t('language.de') },
    { code: 'fr', flagEmoji: '🇫🇷', nativeName: 'Français', label: t('language.fr') },
    { code: 'es', flagEmoji: '🇪🇸', nativeName: 'Español', label: t('language.es') },
    { code: 'ru', flagEmoji: '🇷🇺', nativeName: 'Русский', label: t('language.ru') },
    { code: 'it', flagEmoji: '🇮🇹', nativeName: 'Italiano', label: t('language.it') },
]

export const sourceLanguageOptions: readonly SourceLanguageOption[] = [
    { code: 'auto', flag: null, shortLabel: t('language.autoShort'), label: t('language.auto') },
    ...languageOptions.map((option) => ({
        code: option.code,
        flag: option.code as FlagCode,
        shortLabel: option.code.toUpperCase(),
        label: option.label,
    })),
]

export const targetLanguageOptions: readonly TargetLanguageOption[] = [
    {
        value: t('common.simplifiedChinese'),
        flag: 'cn',
        shortLabel: t('language.zhShort'),
        label: t('common.simplifiedChinese'),
    },
    {
        value: t('language.zhTW'),
        flag: 'cn',
        shortLabel: t('language.zhTWShort'),
        label: t('language.zhTW'),
    },
    { value: 'English', flag: 'en', shortLabel: 'EN', label: t('language.en') },
    { value: '日本語', flag: 'ja', shortLabel: 'JA', label: t('language.ja') },
    { value: '한국어', flag: 'ko', shortLabel: 'KO', label: t('language.ko') },
    { value: 'Deutsch', flag: 'de', shortLabel: 'DE', label: t('language.de') },
    { value: 'Français', flag: 'fr', shortLabel: 'FR', label: t('language.fr') },
    { value: 'Español', flag: 'es', shortLabel: 'ES', label: t('language.es') },
]

export function languageInfo(code: CollectionLanguage): LanguageOption {
    return languageOptions.find((option) => option.code === code) ?? languageOptions[0]!
}

export function sourceLanguageInfo(code: SourceLanguage): SourceLanguageOption {
    return sourceLanguageOptions.find((option) => option.code === code) ?? sourceLanguageOptions[0]!
}

export function sourceLanguageShort(code: SourceLanguage): string {
    return sourceLanguageInfo(code).shortLabel
}

export function targetLanguageOption(value: string): TargetLanguageOption | undefined {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return targetLanguageOptions[0]
    return targetLanguageOptions.find(
        (option) => option.value.toLowerCase() === normalized || option.label.toLowerCase() === normalized,
    )
}

export function targetLanguageShort(value: string): string {
    const matched = targetLanguageOption(value)
    if (matched) return matched.shortLabel
    const trimmed = value.trim()
    if (!trimmed) return t('language.zhShort')
    if (/中文/u.test(trimmed)) return t('language.zhShort')
    return trimmed.slice(0, 4)
}

export function targetLanguageFlag(value: string): FlagCode | undefined {
    const matched = targetLanguageOption(value)
    if (matched) return matched.flag
    if (/中文/u.test(value)) return 'cn'
    return undefined
}

export function defaultCollection(now = 0): VocabularyCollection {
    return {
        id: defaultCollectionId,
        language: 'en',
        name: t('library.collection'),
        description: t('library.collectionIntro'),
        pinned: true,
        createdAt: now,
        updatedAt: now,
    }
}

export function wordCollectionId(word: Pick<Word, 'collectionId'>): string {
    return word.collectionId ?? defaultCollectionId
}

export function sortCollections(collections: readonly VocabularyCollection[]): VocabularyCollection[] {
    return [...collections].sort(
        (left, right) =>
            Number(right.pinned) - Number(left.pinned) ||
            right.updatedAt - left.updatedAt ||
            left.id.localeCompare(right.id),
    )
}

export function activeCollectionId(collections: readonly VocabularyCollection[]): string {
    return sortCollections(collections)[0]?.id ?? defaultCollectionId
}

function masteryRank(word: Word, ascending: boolean): number {
    if (word.state === 'learning') return word.level ?? 1
    if (word.state === 'known') return 5
    return ascending ? 6 : 0
}

export function sortWords(words: readonly Word[], sortBy: WordSort): Word[] {
    return [...words].sort((left, right) => {
        switch (sortBy) {
            case 'updated-asc':
                return left.updatedAt - right.updatedAt || left.key.localeCompare(right.key)
            case 'alpha-asc':
                return left.key.localeCompare(right.key)
            case 'alpha-desc':
                return right.key.localeCompare(left.key)
            case 'level-asc':
                return (
                    masteryRank(left, true) - masteryRank(right, true) ||
                    right.updatedAt - left.updatedAt ||
                    left.key.localeCompare(right.key)
                )
            case 'level-desc':
                return (
                    masteryRank(right, false) - masteryRank(left, false) ||
                    right.updatedAt - left.updatedAt ||
                    left.key.localeCompare(right.key)
                )
            case 'updated-desc':
            default:
                return right.updatedAt - left.updatedAt || left.key.localeCompare(right.key)
        }
    })
}
