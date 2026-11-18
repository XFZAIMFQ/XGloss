import { describe, expect, it } from 'vitest'
import { calculateCoverage, countTokens, normalizeWord, tokenize } from '../src/domain/vocabulary'
import { parseWordCsv } from '../src/domain/csv'

describe('vocabulary statistics', () => {
    it('normalizes casing and apostrophes while excluding identifiers', () => {
        expect(normalizeWord('  CAN’T  ')).toBe("can't")
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
})
