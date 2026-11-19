import { describe, expect, it, vi } from 'vitest'
import {
    completionEndpoint,
    deepSeekPreset,
    requestTranslation,
    translationCacheKey,
} from '../src/services/openai-translation'
import { defaultTranslationSettings } from '../src/domain/models'

const settings = {
    ...defaultTranslationSettings,
    baseUrl: 'https://example.com/v1/',
    model: 'custom-model',
    apiKey: 'test-key',
}
const word = { text: 'register', context: 'Write the value to the hardware register.' }
const meanings = {
    kind: 'meanings',
    meanings: [
        { text: '寄存器', partOfSpeech: '名词' },
        { text: '登记', partOfSpeech: '动词' },
    ],
}

function responseWith(content: string) {
    return vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] })))
}

describe('OpenAI-compatible translation', () => {
    it('requests ranked candidates with the source sentence and retains their order', async () => {
        const fetcher = responseWith(JSON.stringify(meanings))
        expect(await requestTranslation(settings, word, fetcher)).toEqual(meanings)
        const [url, init] = fetcher.mock.calls[0]!
        expect(String(url)).toBe('https://example.com/v1/chat/completions')
        expect(init.headers.Authorization).toBe('Bearer test-key')
        const body = JSON.parse(init.body)
        expect(body.stream).toBe(false)
        expect(body.model).toBe('custom-model')
        expect(JSON.parse(body.messages[1].content)).toEqual({
            selectedText: word.text,
            context: word.context,
        })
        expect(body.messages[0].content).toContain('fits the supplied context first')
        expect(body).not.toHaveProperty('response_format')
        expect(body).not.toHaveProperty('thinking')
    })
    it('uses DeepSeek JSON mode and returns the entire passage with half-width punctuation', async () => {
        const sentence = { text: 'Read the register, then clear the flag.', context: '' }
        const fetcher = responseWith(
            JSON.stringify({ kind: 'text', text: '读取寄存器\uff0c然后清除标志\u3002' }),
        )
        expect(await requestTranslation({ ...settings, ...deepSeekPreset }, sentence, fetcher)).toEqual({
            kind: 'text',
            text: '读取寄存器,然后清除标志.',
        })
        const [url, init] = fetcher.mock.calls[0]!
        expect(String(url)).toBe('https://api.deepseek.com/chat/completions')
        const body = JSON.parse(init.body)
        expect(body.model).toBe('deepseek-flash')
        expect(body.response_format).toEqual({ type: 'json_object' })
        expect(body.thinking).toEqual({ type: 'disabled' })
        expect(body.messages[0].content).toContain('Return a full translation')
    })
    it('accepts a contextual phrase from a local server without authentication and merges duplicate meanings', async () => {
        const fetcher = responseWith(
            JSON.stringify({
                kind: 'meanings',
                meanings: [{ text: '建立' }, { text: '安排' }, { text: '建立' }],
            }),
        )
        await expect(
            requestTranslation(
                { ...settings, baseUrl: 'http://localhost:11434/v1', apiKey: '' },
                { text: 'set up', context: 'Set up a meeting with the supplier.' },
                fetcher,
            ),
        ).resolves.toEqual({ kind: 'meanings', meanings: [{ text: '建立' }, { text: '安排' }] })
        expect(fetcher.mock.calls[0]![1].headers).not.toHaveProperty('Authorization')
    })
    it('validates endpoint protocols and malformed response data', async () => {
        expect(() => completionEndpoint('http://remote.example/v1')).toThrow('HTTPS')
        expect(() => completionEndpoint('https://user:password@example.com/v1')).toThrow('Base URL')
        const fetcher = vi.fn().mockResolvedValue(new Response('{"choices":[]}'))
        await expect(requestTranslation(settings, word, fetcher)).rejects.toThrow('content')
        await expect(requestTranslation(settings, word, responseWith('plain text'))).rejects.toThrow('JSON')
        await expect(
            requestTranslation(settings, word, responseWith('{"kind":"meanings","meanings":[]}')),
        ).rejects.toThrow('格式不正确')
        await expect(
            requestTranslation(
                settings,
                { text: 'Write the value.', context: '' },
                responseWith(JSON.stringify(meanings)),
            ),
        ).rejects.toThrow('格式不正确')
    })
    it('handles HTTP failure without exposing server bodies or credentials', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('test-key', { status: 401 }))
        await expect(requestTranslation(settings, word, fetcher)).rejects.toThrow('API Key 无效')
    })
    it('keeps malformed server content out of displayed JSON errors', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('test-key not json'))
        await expect(requestTranslation(settings, word, fetcher)).rejects.toThrow('无效的 JSON')
    })
    it('isolates caches by context, model configuration, and language direction', async () => {
        const key = await translationCacheKey(settings, word)
        expect(key).toHaveLength(64)
        expect(await translationCacheKey(settings, { ...word, context: 'account' })).not.toBe(key)
        expect(await translationCacheKey({ ...settings, model: 'other' }, word)).not.toBe(key)
        expect(await translationCacheKey(settings, { ...word, sourceLanguage: 'en' })).not.toBe(key)
        expect(await translationCacheKey(settings, { ...word, targetLanguage: 'English' })).not.toBe(key)
        expect(
            await translationCacheKey(settings, { ...word, targetLanguage: settings.targetLanguage }),
        ).toBe(key)
    })
    it('includes explicit source and target languages in the system prompt only when specified', async () => {
        const fetcher = responseWith(JSON.stringify(meanings))
        await requestTranslation(
            settings,
            { ...word, sourceLanguage: 'ja', targetLanguage: 'English' },
            fetcher,
        )
        const body = JSON.parse(fetcher.mock.calls[0]![1].body)
        expect(body.messages[0].content).toContain('Translate from Japanese. Write in English.')
    })
})
