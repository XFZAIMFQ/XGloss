import { describe, expect, it } from 'vitest'
import type { Backup } from '../src/domain/models'
import { readGoogleSyncConfig, writeGoogleSyncConfig, type StorageAreaLike } from '../src/data/settings'
import {
    GoogleAuthExpiredError,
    parseGoogleAuthCallback,
    syncBackupWithGoogleDrive,
} from '../src/services/google-drive-sync'
import {
    appendWordsToWordbook,
    listWordbookCategories,
    removeWordsFromWordbook,
} from '../src/services/wordbook-sync'

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

const sampleLocalBackup: Extract<Backup, { version: 2 }> = {
    version: 2,
    collections: [
        {
            id: 'en',
            language: 'en',
            name: 'Reading',
            description: '',
            pinned: true,
            createdAt: 1,
            updatedAt: 1,
        },
    ],
    words: [{ key: 'register', text: 'register', state: 'learning', level: 2, updatedAt: 10 }],
    encounters: [],
    activities: [],
}

describe('Google Drive appDataFolder sync', () => {
    it('parses OAuth implicit callback and enforces CSRF state', () => {
        const parsed = parseGoogleAuthCallback(
            'https://abc.chromiumapp.org/google#access_token=tok123&expires_in=3600&state=s1&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.appdata%20openid',
            's1',
        )
        expect(parsed).toEqual({ accessToken: 'tok123', expiresIn: 3600 })
        expect(() =>
            parseGoogleAuthCallback(
                'https://abc.chromiumapp.org/google#access_token=tok123&state=s1&scope=openid%20email',
                's1',
            ),
        ).toThrow('应用配置数据权限')
        expect(() =>
            parseGoogleAuthCallback(
                'https://abc.chromiumapp.org/google#access_token=tok123&state=wrong',
                's1',
            ),
        ).toThrow('授权失败')
        expect(() =>
            parseGoogleAuthCallback('https://abc.chromiumapp.org/google#error=access_denied&state=s1', 's1'),
        ).toThrow('已取消')
    })

    it('creates a new backup file in appDataFolder when none exists remotely', async () => {
        const calls: { url: string; method: string; body?: string }[] = []
        const fetcher: typeof fetch = async (input, init) => {
            const url = String(input)
            const method = init?.method ?? 'GET'
            calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined })
            if (url.includes('/drive/v3/files?spaces=appDataFolder')) {
                return jsonResponse({ files: [] })
            }
            if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
                return jsonResponse({ id: 'file-new' })
            }
            throw new Error(`Unexpected URL: ${url}`)
        }
        const result = await syncBackupWithGoogleDrive(
            'token-1',
            async () => sampleLocalBackup,
            async () => 0,
            fetcher,
        )
        expect(result).toEqual({ mergedWords: 0, uploadedWords: 1, fileId: 'file-new' })
        expect(calls.map((call) => call.method)).toEqual(['GET', 'POST'])
        expect(calls[1]?.body).toContain('"parents":["appDataFolder"]')
        expect(calls[1]?.body).toContain('"xgloss-backup.json"')
    })

    it('downloads, merges, and PATCH-updates an existing remote backup', async () => {
        const remoteBackup: Extract<Backup, { version: 2 }> = {
            version: 2,
            words: [{ key: 'kernel', text: 'kernel', state: 'known', updatedAt: 20 }],
            encounters: [],
            activities: [],
        }
        let mergedRemoteCount = 0
        const calls: { url: string; method: string }[] = []
        const fetcher: typeof fetch = async (input, init) => {
            const url = String(input)
            calls.push({ url, method: init?.method ?? 'GET' })
            if (url.includes('/drive/v3/files?spaces=appDataFolder')) {
                return jsonResponse({ files: [{ id: 'file-42' }] })
            }
            if (url.includes('/drive/v3/files/file-42?alt=media')) {
                return jsonResponse(remoteBackup)
            }
            if (url.includes('/upload/drive/v3/files/file-42?uploadType=media')) {
                return jsonResponse({ id: 'file-42' })
            }
            throw new Error(`Unexpected URL: ${url}`)
        }
        const result = await syncBackupWithGoogleDrive(
            'token-1',
            async () => ({
                ...sampleLocalBackup,
                words: [...sampleLocalBackup.words, ...remoteBackup.words],
            }),
            async (remote) => {
                mergedRemoteCount = remote.words.length
                return remote.words.length
            },
            fetcher,
        )
        expect(mergedRemoteCount).toBe(1)
        expect(result).toEqual({ mergedWords: 1, uploadedWords: 2, fileId: 'file-42' })
        expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'PATCH'])
    })

    it('throws GoogleAuthExpiredError on HTTP 401', async () => {
        const fetcher: typeof fetch = async () => new Response('', { status: 401 })
        await expect(
            syncBackupWithGoogleDrive(
                'expired-token',
                async () => sampleLocalBackup,
                async () => 0,
                fetcher,
            ),
        ).rejects.toBeInstanceOf(GoogleAuthExpiredError)
    })

    it('backs up only non-secret Google clientId via chrome.storage.sync with graceful fallback', async () => {
        const createArea = (): { data: Record<string, unknown>; area: StorageAreaLike } => {
            const data: Record<string, unknown> = {}
            return {
                data,
                area: {
                    async get(key) {
                        return key in data ? { [key]: data[key] } : {}
                    },
                    async set(items) {
                        Object.assign(data, items)
                    },
                    async remove(key) {
                        delete data[key]
                    },
                },
            }
        }
        const local = createArea()
        const sync = createArea()
        await writeGoogleSyncConfig(local.area, sync.area, {
            clientId: 'abc.apps.googleusercontent.com',
            accessToken: 'secret-token',
            tokenExpiresAt: Date.now() + 60_000,
            accountEmail: 'user@example.com',
        })
        expect(sync.data).toEqual({ googleSyncClientId: 'abc.apps.googleusercontent.com' })
        expect(JSON.stringify(sync.data)).not.toContain('secret-token')

        const freshLocal = createArea()
        const restored = await readGoogleSyncConfig(freshLocal.area, sync.area)
        expect(restored.clientId).toBe('abc.apps.googleusercontent.com')
        expect(restored.accessToken).toBe('')

        const legacyLocal = createArea()
        const emptySync = createArea()
        legacyLocal.data.googleSync = { clientId: 'legacy.apps.googleusercontent.com' }
        await readGoogleSyncConfig(legacyLocal.area, emptySync.area)
        expect(emptySync.data.googleSyncClientId).toBe('legacy.apps.googleusercontent.com')

        await writeGoogleSyncConfig(local.area, sync.area, { clientId: '' })
        expect('googleSyncClientId' in sync.data).toBe(false)

        const brokenSync: StorageAreaLike = {
            async get() {
                throw new Error('sync disabled')
            },
            async set() {
                throw new Error('sync disabled')
            },
            async remove() {
                throw new Error('sync disabled')
            },
        }
        const saved = await writeGoogleSyncConfig(local.area, brokenSync, {
            clientId: 'offline.apps.googleusercontent.com',
        })
        expect(saved.clientId).toBe('offline.apps.googleusercontent.com')
    })
})

describe('External wordbook adapters', () => {
    it('supports Eudic category listing, deduplicated append, and mastered word removal', async () => {
        const requests: { url: string; method: string; auth: string | null; body?: unknown }[] = []
        const fetcher: typeof fetch = async (input, init) => {
            const url = String(input)
            const headers = new Headers(init?.headers)
            requests.push({
                url,
                method: init?.method ?? 'GET',
                auth: headers.get('Authorization'),
                body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
            })
            if (url.includes('/studylist/category')) {
                return jsonResponse({ data: [{ id: '0', name: '默认生词本' }] })
            }
            return new Response(null, { status: 204 })
        }
        const profile = { type: 'eudic' as const, token: 'NIS test-token' }
        const categories = await listWordbookCategories(profile, 'en', fetcher)
        expect(categories).toEqual([{ id: '0', name: '默认生词本' }])
        const added = await appendWordsToWordbook(
            profile,
            '0',
            'en',
            ['register', 'Register', 'kernel'],
            fetcher,
        )
        expect(added).toBe(2)
        const removed = await removeWordsFromWordbook(profile, '0', 'en', ['register'], fetcher)
        expect(removed).toBe(1)
        expect(requests[0]?.auth).toBe('NIS test-token')
        expect(requests[1]).toMatchObject({
            method: 'POST',
            body: { id: '0', language: 'en', words: ['register', 'kernel'] },
        })
        expect(requests[2]).toMatchObject({
            method: 'DELETE',
            body: { category_id: '0', language: 'en', words: ['register'] },
        })
    })

    it('supports MaiMemo notepad listing, append-only merge, and word removal', async () => {
        let content = 'alpha\nbeta'
        const authHeaders: string[] = []
        const fetcher: typeof fetch = async (input, init) => {
            const url = String(input)
            const headers = new Headers(init?.headers)
            authHeaders.push(headers.get('Authorization') ?? '')
            if (url.includes('/notepads?')) {
                return jsonResponse({
                    data: { notepads: [{ id: 'np-1', title: 'My Cloud List', content }] },
                })
            }
            if (url.endsWith('/notepads/np-1') && (init?.method ?? 'GET') === 'GET') {
                return jsonResponse({
                    data: {
                        notepad: {
                            id: 'np-1',
                            title: 'My Cloud List',
                            brief: 'Sync',
                            status: 'UNPUBLISHED',
                            tags: ['英语'],
                            content,
                        },
                    },
                })
            }
            if (url.endsWith('/notepads/np-1') && init?.method === 'POST') {
                const payload = JSON.parse(String(init.body)) as { notepad: { content: string } }
                content = payload.notepad.content
                return jsonResponse({ success: true })
            }
            throw new Error(`Unexpected URL: ${url}`)
        }
        const profile = { type: 'maimemo' as const, token: 'mm-secret' }
        const list = await listWordbookCategories(profile, 'en', fetcher)
        expect(list).toEqual([{ id: 'np-1', name: 'My Cloud List' }])
        expect(authHeaders[0]).toBe('Bearer mm-secret')
        const appended = await appendWordsToWordbook(
            profile,
            'np-1',
            'en',
            ['Beta', 'gamma', 'delta'],
            fetcher,
        )
        expect(appended).toBe(2)
        expect(content).toBe('alpha\nbeta\ngamma\ndelta')
        const removed = await removeWordsFromWordbook(profile, 'np-1', 'en', ['BETA'], fetcher)
        expect(removed).toBe(1)
        expect(content).toBe('alpha\ngamma\ndelta')
    })
})
