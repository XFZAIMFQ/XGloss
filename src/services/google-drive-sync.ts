import { t } from '../i18n'
import { browser } from 'wxt/browser'
import { z } from 'zod'
import { backupSchema, type Backup } from '../domain/models'

export const googleApiOrigin = 'https://www.googleapis.com'
const backupFileName = 'xgloss-backup.json'
const driveAppDataScope = 'https://www.googleapis.com/auth/drive.appdata'
const driveScope = `${driveAppDataScope} https://www.googleapis.com/auth/userinfo.email`
const timeoutMs = 30_000

const fileListSchema = z.object({
    files: z.array(z.object({ id: z.string().min(1) })).default([]),
})
const uploadedFileSchema = z.object({
    id: z.string().min(1),
})
const userInfoSchema = z.object({
    email: z.string().optional(),
})

export class GoogleAuthExpiredError extends Error {
    constructor() {
        super(t('sync.tokenExpired'))
        this.name = 'GoogleAuthExpiredError'
    }
}

export function googleRedirectUri(): string {
    try {
        return browser.identity.getRedirectURL('google')
    } catch {
        return ''
    }
}

export function parseGoogleAuthCallback(
    callbackUrl: string,
    expectedState: string,
): {
    accessToken: string
    expiresIn: number
} {
    const parsed = new URL(callbackUrl)
    const params = new URLSearchParams(parsed.hash.replace(/^#/, ''))
    const error = params.get('error')
    if (error === 'access_denied') throw new Error(t('sync.authCancelled'))
    if (error) throw new Error(t('sync.authFailed'))
    if (params.get('state') !== expectedState) throw new Error(t('sync.authFailed'))
    const accessToken = params.get('access_token')?.trim()
    if (!accessToken) throw new Error(t('sync.authFailed'))
    const grantedScope = params.get('scope')
    if (grantedScope !== null && !grantedScope.split(/\s+/).includes(driveAppDataScope)) {
        throw new Error(t('sync.missingDriveScope'))
    }
    const rawExpires = Number(params.get('expires_in') ?? '3600')
    const expiresIn = Number.isFinite(rawExpires) && rawExpires > 0 ? rawExpires : 3600
    return { accessToken, expiresIn }
}

export async function authorizeGoogleDrive(
    clientId: string,
    fetcher: typeof fetch = fetch,
): Promise<{ accessToken: string; tokenExpiresAt: number; accountEmail: string }> {
    const trimmed = clientId.trim()
    if (!trimmed) throw new Error(t('sync.clientIdRequired'))
    const redirectUri = googleRedirectUri()
    const state = crypto.randomUUID()
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', trimmed)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'token')
    authUrl.searchParams.set('scope', driveScope)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('prompt', 'select_account consent')
    let callbackUrl: string | undefined
    try {
        callbackUrl = await browser.identity.launchWebAuthFlow({
            url: authUrl.toString(),
            interactive: true,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : ''
        if (message.includes('cancel') || message.includes('user did not approve')) {
            throw new Error(t('sync.authCancelled'), { cause: error })
        }
        throw new Error(t('sync.authFailed'), { cause: error })
    }
    if (!callbackUrl) throw new Error(t('sync.authCancelled'))
    const { accessToken, expiresIn } = parseGoogleAuthCallback(callbackUrl, state)
    const tokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000
    let accountEmail = ''
    try {
        const infoResponse = await fetcher(`${googleApiOrigin}/oauth2/v2/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10_000),
        })
        if (infoResponse.ok) {
            const parsed = userInfoSchema.safeParse(await infoResponse.json())
            if (parsed.success && parsed.data.email) accountEmail = parsed.data.email
        }
    } catch {
        // User email is display-only metadata; continue if unavailable.
    }
    return { accessToken, tokenExpiresAt, accountEmail }
}

async function driveFetch(
    url: string,
    accessToken: string,
    init: RequestInit = {},
    fetcher: typeof fetch = fetch,
): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    const response = await fetcher(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401) throw new GoogleAuthExpiredError()
    if (response.status === 403) {
        const text = await response.text().catch(() => '')
        if (text.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || text.includes('insufficientPermissions')) {
            throw new Error(t('sync.missingDriveScope'))
        }
    }
    if (!response.ok) throw new Error(t('sync.uploadError', { status: response.status }))
    return response
}

export async function syncBackupWithGoogleDrive(
    accessToken: string,
    getLocalBackup: () => Promise<Extract<Backup, { version: 2 }>>,
    mergeRemoteBackup: (remote: Backup) => Promise<number>,
    fetcher: typeof fetch = fetch,
): Promise<{ mergedWords: number; uploadedWords: number; fileId: string }> {
    const query = encodeURIComponent(`name='${backupFileName}' and trashed=false`)
    const listUrl = `${googleApiOrigin}/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id)&pageSize=1`
    const listResponse = await driveFetch(listUrl, accessToken, {}, fetcher)
    const listData = fileListSchema.parse(await listResponse.json())
    const existingId = listData.files[0]?.id

    let mergedWords = 0
    if (existingId) {
        const downloadUrl = `${googleApiOrigin}/drive/v3/files/${encodeURIComponent(existingId)}?alt=media`
        const downloadResponse = await driveFetch(downloadUrl, accessToken, {}, fetcher)
        const remoteRaw: unknown = await downloadResponse.json()
        const remoteBackup = backupSchema.parse(remoteRaw)
        mergedWords = await mergeRemoteBackup(remoteBackup)
    }

    const mergedLocal = await getLocalBackup()
    const payload = JSON.stringify(mergedLocal)
    let fileId = existingId ?? ''
    if (existingId) {
        const updateUrl = `${googleApiOrigin}/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=media`
        await driveFetch(
            updateUrl,
            accessToken,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                body: payload,
            },
            fetcher,
        )
    } else {
        const boundary = `xgloss_${crypto.randomUUID().replaceAll('-', '')}`
        const metadata = JSON.stringify({
            name: backupFileName,
            parents: ['appDataFolder'],
            mimeType: 'application/json',
        })
        const multipartBody = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            metadata,
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            payload,
            `--${boundary}--`,
            '',
        ].join('\r\n')
        const createUrl = `${googleApiOrigin}/upload/drive/v3/files?uploadType=multipart&fields=id`
        const createResponse = await driveFetch(
            createUrl,
            accessToken,
            {
                method: 'POST',
                headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                body: multipartBody,
            },
            fetcher,
        )
        fileId = uploadedFileSchema.parse(await createResponse.json()).id
    }

    return {
        mergedWords,
        uploadedWords: mergedLocal.words.length,
        fileId,
    }
}
