import { describe, expect, it, vi } from 'vitest'
import {
    completionEndpoint,
    requestTranslation,
    translationCacheKey,
} from '../src/services/openai-translation'
import { defaultTranslationSettings } from '../src/domain/models'

const settings = {
    ...defaultTranslationSettings,
    baseUrl: 'https://example.com/v1/',
    model: 'custom-model',
    apiKey: 'private-key',
}
describe('OpenAI-compatible translation', () => {
    it('constructs a minimal Chat Completions request with context', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ choices: [{ message: { content: '寄存器' } }] })),
            )
        expect(
            await requestTranslation(settings, { text: 'register', context: 'hardware register' }, fetcher),
        ).toBe('寄存器')
        const [url, init] = fetcher.mock.calls[0]!
        expect(String(url)).toBe('https://example.com/v1/chat/completions')
        expect(init.headers.Authorization).toBe('Bearer private-key')
        const body = JSON.parse(init.body)
        expect(body.stream).toBe(false)
        expect(body.model).toBe('custom-model')
        expect(body.messages[1].content).toContain('hardware register')
        expect(body).not.toHaveProperty('temperature')
    })
    it('supports a local endpoint without authentication', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '词义' } }] })))
        await requestTranslation(
            { ...settings, baseUrl: 'http://localhost:11434/v1', apiKey: '' },
            { text: 'word', context: '' },
            fetcher,
        )
        expect(fetcher.mock.calls[0]![1].headers).not.toHaveProperty('Authorization')
    })
    it('validates endpoint protocols and malformed response data', async () => {
        expect(() => completionEndpoint('http://remote.example/v1')).toThrow('HTTPS')
        expect(() => completionEndpoint('https://user:password@example.com/v1')).toThrow('Base URL')
        const fetcher = vi.fn().mockResolvedValue(new Response('{"choices":[]}'))
        await expect(requestTranslation(settings, { text: 'word', context: '' }, fetcher)).rejects.toThrow(
            'content',
        )
    })
    it('handles HTTP failure without exposing server bodies or credentials', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('private-key', { status: 401 }))
        await expect(requestTranslation(settings, { text: 'word', context: '' }, fetcher)).rejects.toThrow(
            'API Key 无效',
        )
    })
    it('keeps malformed server content out of displayed JSON errors', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('private-key not json'))
        await expect(requestTranslation(settings, { text: 'word', context: '' }, fetcher)).rejects.toThrow(
            '无效的 JSON',
        )
    })
    it('isolates caches by context and model configuration', async () => {
        const key = await translationCacheKey(settings, { text: 'register', context: 'hardware' })
        expect(key).toHaveLength(64)
        expect(await translationCacheKey(settings, { text: 'register', context: 'account' })).not.toBe(key)
        expect(
            await translationCacheKey(
                { ...settings, model: 'other' },
                { text: 'register', context: 'hardware' },
            ),
        ).not.toBe(key)
    })
})
