import { t } from '../i18n'
import { defaultCollectionId, type CollectionLanguage, type VocabularyCollection, type Word } from './models'

export interface LanguageOption {
    code: CollectionLanguage
    flagEmoji: string
    nativeName: string
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

export function languageInfo(code: CollectionLanguage): LanguageOption {
    return languageOptions.find((option) => option.code === code) ?? languageOptions[0]!
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
