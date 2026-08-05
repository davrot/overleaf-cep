import Settings from '@overleaf/settings'

const API_URL = 'https://api.dropboxapi.com/2'
const CONTENT_URL = 'https://content.dropboxapi.com/2'
const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropbox.com/oauth2/token'
const tokenRefreshes = new Map()

function clientCredentials() {
    const clientId = Settings.dropbox?.appKey || process.env.DROPBOX_APP_KEY
    const clientSecret =
        Settings.dropbox?.appSecret || process.env.DROPBOX_APP_SECRET
    if (!clientId || !clientSecret) {
        throw new Error('Dropbox OAuth credentials are not configured')
    }
    return { clientId, clientSecret }
}

async function responseBody(response) {
    const text = await response.text()
    let body
    try {
        body = text ? JSON.parse(text) : null
    } catch {
        body = text
    }
    if (!response.ok) {
        const error = new Error(body?.error_summary || `Dropbox request failed: ${response.status}`)
        error.status = response.status
        error.body = body
        throw error
    }
    return body
}

async function exchangeCode(code, redirectUri) {
    const { clientId, clientSecret } = clientCredentials()
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
    })
    return responseBody(response)
}

async function refreshAccessToken(credentials) {
    const key = credentials.refreshToken
    const pendingRefresh = tokenRefreshes.get(key)
    if (pendingRefresh) {
        const token = await pendingRefresh
        credentials.accessToken = token.accessToken
        credentials.expiresAt = token.expiresAt
        return
    }
    const refresh = refreshAccessTokenUnlocked(credentials)
    tokenRefreshes.set(key, refresh)
    try {
        const token = await refresh
        credentials.accessToken = token.accessToken
        credentials.expiresAt = token.expiresAt
    } finally {
        if (tokenRefreshes.get(key) === refresh) {
            tokenRefreshes.delete(key)
        }
    }
}

async function refreshAccessTokenUnlocked(credentials) {
    const { clientId, clientSecret } = clientCredentials()
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: credentials.refreshToken,
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
    })
    const token = await responseBody(response)
    return {
        accessToken: token.access_token,
        expiresAt: token.expires_in
            ? Date.now() + token.expires_in * 1000
            : null,
    }
}

async function request(credentials, url, options = {}, retry = true) {
    if (credentials.expiresAt && credentials.expiresAt <= Date.now() + 60_000) {
        await refreshAccessToken(credentials)
    }
    const response = await fetch(url, {
        ...options,
        headers: {
            authorization: `Bearer ${credentials.accessToken}`,
            ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 401 && retry && credentials.refreshToken) {
        await refreshAccessToken(credentials)
        return request(credentials, url, options, false)
    }
    return responseBody(response)
}

async function binaryRequest(credentials, url, options = {}, retry = true) {
    if (credentials.expiresAt && credentials.expiresAt <= Date.now() + 60_000) {
        await refreshAccessToken(credentials)
    }
    const response = await fetch(url, {
        ...options,
        headers: {
            authorization: `Bearer ${credentials.accessToken}`,
            ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 401 && retry && credentials.refreshToken) {
        await refreshAccessToken(credentials)
        return binaryRequest(credentials, url, options, false)
    }
    if (!response.ok) {
        const error = new Error(`Dropbox request failed: ${response.status}`)
        error.status = response.status
        throw error
    }
    return response.arrayBuffer()
}

async function rpc(credentials, path, body = {}) {
    return request(credentials, `${API_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
}

async function getAuthorizeUrl(redirectUri, state) {
    const { clientId } = clientCredentials()
    const url = new URL(AUTHORIZE_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('token_access_type', 'offline')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    return url.toString()
}

async function getCurrentAccount(credentials) {
    return rpc(credentials, '/users/get_current_account')
}

async function listFolder(credentials, path = '') {
    return rpc(credentials, '/files/list_folder', {
        path,
        recursive: true,
        include_deleted: true,
        include_mounted_folders: false,
    })
}

async function listFolderContinue(credentials, cursor) {
    return rpc(credentials, '/files/list_folder/continue', { cursor })
}

async function getLatestCursor(credentials, path = '') {
    return rpc(credentials, '/files/list_folder/get_latest_cursor', {
        path,
        recursive: true,
        include_media_info: false,
        include_deleted: true,
        include_mounted_folders: false,
    })
}

async function upload(credentials, path, body, mode = 'overwrite') {
    return request(credentials, `${CONTENT_URL}/files/upload`, {
        method: 'POST',
        headers: {
            'content-type': 'application/octet-stream',
            'dropbox-api-arg': JSON.stringify({
                path,
                mode,
                autorename: false,
                mute: true,
            }),
        },
        body,
    })
}

async function download(credentials, path) {
    return binaryRequest(credentials, `${CONTENT_URL}/files/download`, {
        method: 'POST',
        headers: { 'dropbox-api-arg': JSON.stringify({ path }) },
    })
}

async function getMetadata(credentials, path) {
    return rpc(credentials, '/files/get_metadata', { path })
}

async function createFolder(credentials, path) {
    return rpc(credentials, '/files/create_folder_v2', {
        path,
        autorename: false,
    })
}

async function deletePath(credentials, path) {
    return rpc(credentials, '/files/delete_v2', { path })
}

async function movePath(credentials, fromPath, toPath) {
    return rpc(credentials, '/files/move_v2', {
        from_path: fromPath,
        to_path: toPath,
        autorename: false,
        allow_shared_folder: false,
        allow_ownership_transfer: false,
    })
}

async function revokeToken(credentials) {
    return request(credentials, `${API_URL}/auth/token/revoke`, {
        method: 'POST',
    })
}

export default {
    exchangeCode,
    getAuthorizeUrl,
    getCurrentAccount,
    listFolder,
    listFolderContinue,
    getLatestCursor,
    upload,
    download,
    getMetadata,
    createFolder,
    deletePath,
    movePath,
    revokeToken,
}