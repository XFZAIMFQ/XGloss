import { describe, expect, it } from 'vitest'
import {
    calculateCoverage,
    contextAround,
    countTokens,
    highlightKind,
    learningLevelDefinitions,
    normalizeWord,
    ratingLabel,
    tokenize,
} from '../src/domain/vocabulary'
import { parseWordCsv } from '../src/domain/csv'
import { halfWidthPunctuation } from '../src/domain/definitions'
import { activityStreaks, localDay, summarizeActivity } from '../src/domain/activity'
import {
    activeCollectionId,
    sortCollections,
    sortWords,
    sourceLanguageShort,
    targetLanguageFlag,
    targetLanguageShort,
    wordCollectionId,
} from '../src/domain/collections'
import {
    deleteCollectionInputSchema,
    readingPanelPositionSchema,
    selectionTriggerSchema,
    sourceLanguageSchema,
    translationLanguagesSchema,
    translationProvidersStateSchema,
    webAnalysisScopeSchema,
} from '../src/domain/models'
import {
    buildEncounterHighlightUrl,
    buildTextFragmentDirective,
    buildTextFragmentFromContext,
    stripTextFragment,
} from '../src/domain/text-fragment'
import {
    anchorPositionToCoords,
    clampFloatingCoords,
    coordsToAnchorPosition,
} from '../src/domain/panel-position'

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
        expect(() => parseWordCsv('something\nhello')).toThrow('word 或 term 列')
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
    it('imports WordByWord CSV with status 1-5, meanings, and example encounters', () => {
        const csv = [
            'term,meaning,example,term_language,meaning_language,status',
            'Classic,经典,Classic single-board computers (SBC).,en_US,cmn_CN,1',
            'access,访问,,en_US,cmn_CN,2',
            'should,应当,,en_US,cmn_CN,3',
            'Controller,控制器,DMA Controller API.,en_US,cmn_CN,4',
            'Password,密码,"…Network"" -DWIFI_PASSWORD=""Your Password""）。",en_US,cmn_CN,5',
            'skipme,忽略词,,en_US,cmn_CN,0',
        ].join('\n')
        const result = parseWordCsv(csv, 'en')
        expect(result.words).toHaveLength(6)
        expect(result.words.find((w) => w.key === 'classic')).toMatchObject({
            text: 'Classic',
            state: 'learning',
            level: 1,
            meaning: '经典',
            collectionId: 'en',
        })
        expect(result.words.find((w) => w.key === 'access')).toMatchObject({ state: 'learning', level: 2 })
        expect(result.words.find((w) => w.key === 'should')).toMatchObject({ state: 'learning', level: 3 })
        expect(result.words.find((w) => w.key === 'controller')).toMatchObject({
            state: 'learning',
            level: 4,
        })
        expect(result.words.find((w) => w.key === 'password')).toMatchObject({
            state: 'known',
            level: undefined,
            meaning: '密码',
        })
        expect(result.words.find((w) => w.key === 'skipme')).toMatchObject({
            state: 'ignored',
            level: undefined,
        })
        expect(result.encounters).toHaveLength(3)
        expect(result.encounters.find((e) => e.wordKey === 'classic')?.context).toBe(
            'Classic single-board computers (SBC).',
        )
        expect(result.encounters.find((e) => e.wordKey === 'password')?.context).toBe(
            '…Network" -DWIFI_PASSWORD="Your Password"）。',
        )
        expect(() => parseWordCsv('term,status\nhello,6')).toThrow('无效的状态值')
    })
    it('defines WordByWord-aligned learning levels 1-4', () => {
        expect(learningLevelDefinitions.map((item) => item.english)).toEqual([
            'New',
            'Recognized',
            'Familiar',
            'Learned',
        ])
        expect(ratingLabel({ state: 'learning', level: 1 })).toBe('学习 1 级 (新词)')
        expect(ratingLabel({ state: 'learning', level: 2 })).toBe('学习 2 级 (初识)')
        expect(ratingLabel({ state: 'learning', level: 3 })).toBe('学习 3 级 (熟悉)')
        expect(ratingLabel({ state: 'learning', level: 4 })).toBe('学习 4 级 (已学)')
    })
})

describe('text normalization and context', () => {
    it('normalizes full-width punctuation to ASCII half-width equivalents', () => {
        expect(halfWidthPunctuation('运行\uff08程序\u3001系统\uff09\uff0c跑步\u3002')).toBe(
            '运行(程序,系统),跑步.',
        )
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
    it('validates selection triggers and formats language pair labels', () => {
        expect(selectionTriggerSchema.parse('auto')).toBe('auto')
        expect(selectionTriggerSchema.parse('icon')).toBe('icon')
        expect(selectionTriggerSchema.parse('off')).toBe('off')
        expect(() => selectionTriggerSchema.parse('invalid')).toThrow()
        expect(webAnalysisScopeSchema.parse('main')).toBe('main')
        expect(webAnalysisScopeSchema.parse('full')).toBe('full')
        expect(() => webAnalysisScopeSchema.parse('body')).toThrow()
        expect(sourceLanguageSchema.parse('ja')).toBe('ja')
        expect(
            translationLanguagesSchema.parse({ sourceLanguage: 'en', targetLanguage: '简体中文' }),
        ).toEqual({
            sourceLanguage: 'en',
            targetLanguage: '简体中文',
        })
        expect(sourceLanguageShort('auto')).toBe('自动')
        expect(sourceLanguageShort('ja')).toBe('JA')
        expect(targetLanguageShort('简体中文')).toBe('中')
        expect(targetLanguageShort('English')).toBe('EN')
        expect(targetLanguageShort('Português')).toBe('Port')
        expect(targetLanguageFlag('简体中文')).toBe('cn')
        expect(targetLanguageFlag('English')).toBe('en')
    })
    it('sorts words by time, alphabet, and mastery level with ignored words last', () => {
        const sample = [
            { key: 'beta', text: 'beta', state: 'learning' as const, level: 3 as const, updatedAt: 20 },
            { key: 'alpha', text: 'alpha', state: 'known' as const, updatedAt: 10 },
            { key: 'gamma', text: 'gamma', state: 'learning' as const, level: 1 as const, updatedAt: 30 },
            { key: 'delta', text: 'delta', state: 'ignored' as const, updatedAt: 40 },
        ]
        expect(sortWords(sample, 'updated-desc').map((w) => w.key)).toEqual([
            'delta',
            'gamma',
            'beta',
            'alpha',
        ])
        expect(sortWords(sample, 'updated-asc').map((w) => w.key)).toEqual([
            'alpha',
            'beta',
            'gamma',
            'delta',
        ])
        expect(sortWords(sample, 'alpha-asc').map((w) => w.key)).toEqual(['alpha', 'beta', 'delta', 'gamma'])
        expect(sortWords(sample, 'alpha-desc').map((w) => w.key)).toEqual(['gamma', 'delta', 'beta', 'alpha'])
        expect(sortWords(sample, 'level-asc').map((w) => w.key)).toEqual(['gamma', 'beta', 'alpha', 'delta'])
        expect(sortWords(sample, 'level-desc').map((w) => w.key)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    })
    it('validates collection deletion and multi-provider translation schemas', () => {
        expect(
            deleteCollectionInputSchema.parse({ id: 'ja', mode: 'move', targetCollectionId: 'en' }),
        ).toEqual({
            id: 'ja',
            mode: 'move',
            targetCollectionId: 'en',
        })
        expect(() => deleteCollectionInputSchema.parse({ id: 'ja', mode: 'invalid' })).toThrow()
        const providers = translationProvidersStateSchema.parse({
            activeId: 'p1',
            providers: [
                {
                    id: 'p1',
                    name: 'DeepSeek',
                    baseUrl: 'https://api.deepseek.com',
                    apiKey: 'secret',
                    model: 'deepseek-flash',
                    timeoutMs: 30_000,
                },
            ],
            targetLanguage: '简体中文',
        })
        expect(providers.providers).toHaveLength(1)
    })
})

describe('text fragment encounter links', () => {
    it('strips existing text fragment directives while preserving regular hashes', () => {
        expect(stripTextFragment('https://example.com/post#:~:text=register')).toBe(
            'https://example.com/post',
        )
        expect(stripTextFragment('https://example.com/post#intro:~:text=hardware-,register')).toBe(
            'https://example.com/post#intro',
        )
        expect(stripTextFragment('https://example.com/post#intro')).toBe('https://example.com/post#intro')
    })

    it('builds disambiguated directives with percent-encoded hyphens and context affixes', () => {
        const text = 'Read the low-level register first. Then register a new user-id.'
        const firstOffset = text.indexOf('register')
        const secondOffset = text.lastIndexOf('register')
        const first = buildTextFragmentFromContext(text, 'register', firstOffset)
        const second = buildTextFragmentFromContext(text, 'register', secondOffset)
        expect(first).toBe(':~:text=the%20low%2Dlevel-,register,-first.%20Then%20register')
        expect(second).toBe(':~:text=register%20first.%20Then-,register,-a%20new%20user')
        expect(first).not.toBe(second)
        expect(buildTextFragmentDirective({ text: 'state-of-the-art' })).toBe(
            ':~:text=state%2Dof%2Dthe%2Dart',
        )
    })

    it('creates highlight URLs for stored and legacy encounters while rejecting unsafe protocols', () => {
        expect(
            buildEncounterHighlightUrl(
                'https://example.com/docs#section',
                'register',
                'Write to the hardware register now.',
                ':~:text=the%20hardware-,register,-now',
            ),
        ).toBe('https://example.com/docs#section:~:text=the%20hardware-,register,-now')
        expect(
            buildEncounterHighlightUrl(
                'https://example.com/docs',
                'register',
                'Write to the hardware register now.',
            ),
        ).toBe('https://example.com/docs#:~:text=to%20the%20hardware-,register,-now')
        expect(buildEncounterHighlightUrl('javascript:alert(1)', 'register', '')).toBeUndefined()
    })
})

describe('floating reading panel positioning', () => {
    it('anchors to nearest viewport edges and keeps expanded panel clamped inside viewport', () => {
        const saved = coordsToAnchorPosition(
            1210,
            24,
            { width: 54, height: 30 },
            { width: 1280, height: 800 },
        )
        expect(readingPanelPositionSchema.parse(saved)).toEqual({
            anchorX: 'right',
            offsetX: 16,
            anchorY: 'top',
            offsetY: 24,
        })
        const expanded = anchorPositionToCoords(
            saved,
            { width: 334, height: 480 },
            { width: 1280, height: 800 },
        )
        expect(expanded).toEqual({ left: 930, top: 24 })
        expect(
            clampFloatingCoords(900, 700, { width: 334, height: 480 }, { width: 600, height: 520 }, 12),
        ).toEqual({ left: 254, top: 28 })
    })
})
