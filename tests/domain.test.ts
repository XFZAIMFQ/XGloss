import { describe, expect, it } from 'vitest'
import {
    calculateCoverage,
    contextAround,
    countTokens,
    highlightKind,
    normalizeWord,
    tokenize,
} from '../src/domain/vocabulary'
import { parseWordCsv } from '../src/domain/csv'
import { dictionaryMeanings } from '../src/domain/definitions'
import { activityStreaks, localDay, summarizeActivity } from '../src/domain/activity'
import { activeCollectionId, sortCollections, wordCollectionId } from '../src/domain/collections'

describe('vocabulary statistics', () => {
    it('normalizes casing and apostrophes while excluding identifiers', () => {
        expect(normalizeWord('  CAN\u2019T  ')).toBe("can't")
        expect(tokenize('hardware_adc GPIO15 valid words')).toHaveLength(2)
    })
    it('counts occurrences and unique unknown words with consistent exclusions', () => {
        const counts = countTokens(tokenize('known '.repeat(20) + 'new new ignored learning'))
        const coverage = calculateCoverage(counts, [
            { key: 'known', text: 'known', state: 'known', updatedAt: 1 },
            { key: 'ignored', text: 'ignored', state: 'ignored', updatedAt: 1 },
            { key: 'learning', text: 'learning', state: 'learning', updatedAt: 1 },
        ])
        expect(coverage.total).toBe(23)
        expect(coverage.percent).toBe(86)
        expect(coverage.candidates).toEqual([{ key: 'new', count: 2 }])
        expect(coverage.learning).toBe(1)
    })
    it('keeps small samples unscored', () =>
        expect(calculateCoverage(new Map([['word', 1]]), []).percent).toBeNull())
    it('uses the first highlight level for legacy words and removes mastered or ignored highlights', () => {
        expect(highlightKind(undefined)).toBe('unknown')
        expect(highlightKind({ state: 'learning' })).toBe('learning-1')
        expect(highlightKind({ state: 'learning', level: 4 })).toBe('learning-4')
        expect(highlightKind({ state: 'known' })).toBeUndefined()
        expect(highlightKind({ state: 'ignored' })).toBeUndefined()
    })
})

describe('CSV import', () => {
    it('accepts BOM, quoted commas, CRLF and duplicate normalized keys', () => {
        const result = parseWordCsv(
            '\uFEFFword,state\r\n"hello, world",learning\r\nHELLO,known\r\nhello,ignored\r\n',
        )
        expect(result.words).toHaveLength(2)
        expect(result.words.find((word) => word.key === 'hello')?.state).toBe('ignored')
    })
    it('rejects malformed or unsupported data before writes', () => {
        expect(() => parseWordCsv('word,state\nhello,invalid')).toThrow()
        expect(() => parseWordCsv('word\n"unclosed')).toThrow('引号未闭合')
        expect(() => parseWordCsv('something\nhello')).toThrow('word 列')
    })
    it('keeps learning grades from new CSV and validates their state', () => {
        expect(parseWordCsv('word,state,level\nregister,learning,4\nknown,known,').words[0]?.level).toBe(4)
        expect(() => parseWordCsv('word,state,level\nregister,learning,5')).toThrow()
        expect(() => parseWordCsv('word,state,level\nregister,ignored,4')).toThrow()
    })
    it('imports an optional escaped preferred meaning', () => {
        expect(
            parseWordCsv('word,state,level,meaning\nregister,learning,2,"登记,记录"').words[0]?.meaning,
        ).toBe('登记,记录')
        expect(
            parseWordCsv('word,state,level,meaning\nregister,learning,2,"\'=test"').words[0]?.meaning,
        ).toBe('=test')
    })
})

describe('dictionary presentation', () => {
    it('strips known part-of-speech labels and merges duplicate glosses only in simple mode', () => {
        const entry = {
            word: 'hereafter',
            phonetic: '',
            definition: '',
            exchange: '',
            translation: 'n. 将来, 来世\nadv. 此后, 将来, 来世\n[法] 以后',
        }
        expect(dictionaryMeanings(entry, 'simple')).toEqual(['将来', '来世', '此后', '[法] 以后'])
        expect(dictionaryMeanings(entry, 'detailed')[0]).toBe('n. 将来, 来世')
    })
    it('normalizes punctuation without splitting a gloss inside brackets', () => {
        const entry = {
            word: 'run',
            phonetic: '',
            definition: '',
            exchange: '',
            translation: 'v. 运行\uff08程序\u3001系统\uff09\uff0c跑步',
        }
        expect(dictionaryMeanings(entry, 'simple')).toEqual(['运行(程序,系统)', '跑步'])
    })
    it('uses the selected occurrence to disambiguate repeated words', () => {
        const text = 'Read the hardware register. Then register an account.'
        expect(contextAround(text, 'register')).toBe('Read the hardware register.')
        expect(contextAround(text, 'register', 1000, text.lastIndexOf('register'))).toBe(
            'Then register an account.',
        )
    })
})

describe('learning activity', () => {
    it('counts unique words per local date and preserves a streak through yesterday', () => {
        const yesterday = new Date(2026, 10, 17, 12)
        const start = new Date(2026, 10, 16)
        const today = new Date(2026, 10, 18)
        const counts = summarizeActivity(
            [start, yesterday, yesterday].map((date, index) => ({
                id: String(index),
                wordKey: 'register',
                kind: 'rated',
                rating: { state: 'learning', level: 3 },
                createdAt: date.getTime(),
            })),
        )
        expect(counts).toEqual({ [localDay(start)]: 1, [localDay(yesterday)]: 1 })
        expect(activityStreaks(counts, start, today)).toEqual({ current: 2, longest: 2 })
    })
})

describe('collections domain helpers', () => {
    it('sorts pinned collections first and falls back to the default collection id', () => {
        const sorted = sortCollections([
            {
                id: 'ja',
                language: 'ja',
                name: 'Japanese',
                description: '',
                pinned: false,
                createdAt: 1,
                updatedAt: 99,
            },
            {
                id: 'en',
                language: 'en',
                name: 'English',
                description: '',
                pinned: true,
                createdAt: 1,
                updatedAt: 10,
            },
            {
                id: 'de',
                language: 'de',
                name: 'German',
                description: '',
                pinned: true,
                createdAt: 1,
                updatedAt: 50,
            },
        ])
        expect(sorted.map((item) => item.id)).toEqual(['de', 'en', 'ja'])
        expect(activeCollectionId(sorted)).toBe('de')
        expect(wordCollectionId({ collectionId: undefined })).toBe('en')
        expect(wordCollectionId({ collectionId: 'ja' })).toBe('ja')
    })
    it('attaches an optional collectionId when parsing CSV', () => {
        const parsed = parseWordCsv('word,state\ncat,learning\n', 'ja')
        expect(parsed.words[0]?.collectionId).toBe('ja')
    })
})
