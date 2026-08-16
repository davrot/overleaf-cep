import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { GitHubSyncUserCredentials } from '../models/githubSyncUserCredentials.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'

const { normalizeQuery } = Mongo

// GS-07: serialize the per-user read-modify-write credential operations so
// concurrent saves (e.g. linking two servers at once) can't lose updates.
const userLocks = new Map()
function withUserLock(userId, fn) {
  const prev = userLocks.get(userId) || Promise.resolve()
  const run = prev.then(() => fn())
  userLocks.set(userId, run.catch(() => {}))
  return run
}

// Provider type for git servers (runtime-compatible)
const validProviders = ['github', 'gitlab', 'gitea', 'forgejo']

/**
 * Get default server URL for a provider
 */
function getDefaultServerUrl(provider) {
  const defaults = {
    github: 'https://github.com',
    gitlab: 'https://gitlab.com',
    gitea: 'https://gitea.io',
    forgejo: 'https://forgejo.org'
  }
  return defaults[provider] || 'https://github.com'
}

async function encryptAccessToken(accessToken) {
  try {
    return await AccessTokenEncryptor.encryptJson(accessToken)
  } catch (err) {
    throw OError.tag('failed to encrypt token', err)
  }
}

async function decryptAccessToken(tokenEncrypted) {
  try {
    return await AccessTokenEncryptor.decryptToJson(tokenEncrypted)
  } catch (err) {
    throw new InvalidTokenError('failed to decrypt token', { status: 401 }, err)
  }
}

// ------------------------- PAT-based functions -------------------------- //

/**
 * Save PAT for a specific provider and server URL
 */
async function _saveUserPAT(userId, provider, serverUrl, pat) {
  const tokenEncrypted = await encryptAccessToken(pat)

  // Normalize server URL (remove trailing slash)
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')
  const now = new Date()

  // Read-modify-write: NEVER build Mongo dot-paths from the (dotted) server URL,
  // or the driver will split the URL on the dot into nested keys.
  const doc = (await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))) ||
    new GitHubSyncUserCredentials({ userId, createdAt: now })

  const tokens = { ...(doc.tokens || {}) }
  tokens[provider] = { ...(tokens[provider] || {}) }
  tokens[provider][normalizedServerUrl] = tokenEncrypted
  doc.tokens = tokens
  doc.markModified('tokens')

  const servers = { ...(doc.servers || {}) }
  servers[provider] = { ...(servers[provider] || {}) }
  const prev = servers[provider][normalizedServerUrl] || {}
  servers[provider][normalizedServerUrl] = {
    url: normalizedServerUrl,
    username: prev.username || '',
    createdAt: prev.createdAt || now,
    lastUsedAt: now
  }
  doc.servers = servers
  doc.markModified('servers')
  doc.lastUsedAt = now

  await doc.save()
  return doc
}

/**
 * Get PAT for a specific provider and server URL
 */
async function getUserPAT(userId, provider, serverUrl) {
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  
  if (!credentials) {
    throw new InvalidTokenError('no user token', { userId, status: 400 })
  }
  
  let storedToken = credentials.tokens?.[provider]?.[normalizedServerUrl]
  // Guard against corrupted nested docs (dot-split URLs from older writes)
  if (storedToken && typeof storedToken !== 'string') storedToken = undefined
  if (!storedToken) {
    // legacy OAuth token (pre-PAT schema): credentials.github (github.com only)
    if (
      provider === 'github' &&
      normalizedServerUrl === getDefaultServerUrl('github') &&
      credentials.github
    ) {
      return await decryptAccessToken(credentials.github)
    }
    throw new InvalidTokenError(`no token for ${provider} server ${normalizedServerUrl}`, { 
      userId, 
      provider, 
      serverUrl: normalizedServerUrl,
      status: 400 
    })
  }
  
  return await decryptAccessToken(storedToken)
}

/**
 * Resolve stored PAT + username for a provider/server.
 * Returns { token, serverUrl, username } or throws InvalidTokenError.
 */
async function getUserPATCredentials(userId, provider, serverUrl) {
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')
  const token = await getUserPAT(userId, provider, normalizedServerUrl)

  let username = ''
  const servers = await getUserServers(userId)
  username =
    servers?.[provider]?.[normalizedServerUrl]?.username ||
    servers?.[provider]?.[serverUrl]?.username ||
    ''

  return { token, serverUrl: normalizedServerUrl, username }
}

/**
 * List all servers a user has stored tokens for (for status checks)
 */
async function getLinkedServers(userId) {
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  const servers = []
  const tokens = credentials?.tokens || {}

  // legacy OAuth token (pre-PAT schema)
  if (!Object.keys(tokens).length && credentials?.github) {
    servers.push({
      provider: 'github',
      url: getDefaultServerUrl('github'),
      username: ''
    })
  }

  for (const [provider, urlMap] of Object.entries(tokens)) {
    for (const [url, entry] of Object.entries(urlMap || {})) {
      if (typeof entry !== 'string') continue // skip corrupted nested entries
      const cfg = credentials?.servers?.[provider]?.[url] || {}
      servers.push({
        provider,
        url,
        username: cfg.username || '',
      })
    }
  }
  return servers
}

/**
 * Remove PAT for a specific provider and server URL
 */
async function _removeUserPAT(userId, provider, serverUrl) {
  const normalizedServerUrl = serverUrl?.replace(/\/$/, '')

  const doc = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!doc) return

  const tokens = { ...(doc.tokens || {}) }
  const servers = { ...(doc.servers || {}) }

  if (normalizedServerUrl) {
    if (tokens[provider]) delete tokens[provider][normalizedServerUrl]
    if (servers[provider]) delete servers[provider][normalizedServerUrl]
  } else {
    delete tokens[provider]
    delete servers[provider]
  }
  if (tokens[provider] && !Object.keys(tokens[provider]).length) delete tokens[provider]
  if (servers[provider] && !Object.keys(servers[provider]).length) delete servers[provider]

  doc.tokens = tokens
  doc.servers = servers
  doc.markModified('tokens')
  doc.markModified('servers')
  doc.lastUsedAt = new Date()
  await doc.save()
}

/**
 * Get all registered servers for a user
 */
async function getUserServers(userId) {
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  
  if (!credentials) return {}
  
  return credentials.servers || {}
}

/**
 * Update username for a specific provider/server URL
 */
async function _updateServerUsername(userId, provider, serverUrl, username) {
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')

  const doc = (await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))) ||
    new GitHubSyncUserCredentials({ userId, createdAt: new Date() })
  const servers = { ...(doc.servers || {}) }
  servers[provider] = { ...(servers[provider] || {}) }
  const prev = servers[provider][normalizedServerUrl] || {}
  servers[provider][normalizedServerUrl] = {
    url: normalizedServerUrl,
    username: username || '',
    createdAt: prev.createdAt || new Date(),
    lastUsedAt: new Date()
  }
  doc.servers = servers
  doc.markModified('servers')
  doc.lastUsedAt = new Date()
  await doc.save()
}


/**
 * Add a new server configuration for a user
 */
async function _addServerConfig(userId, provider, serverUrl, username) {
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')
  
  // Check if this server is already configured
  const servers = await getUserServers(userId)
  if (servers?.[provider]?.[normalizedServerUrl]) {
    throw new Error('Server already configured')
  }
  
  const now = new Date()
  const doc = (await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))) ||
    new GitHubSyncUserCredentials({ userId, createdAt: now })
  const serversMap = { ...(doc.servers || {}) }
  serversMap[provider] = { ...(serversMap[provider] || {}) }
  serversMap[provider][normalizedServerUrl] = {
    url: normalizedServerUrl,
    username: username || '',
    createdAt: now,
    lastUsedAt: now
  }
  doc.servers = serversMap
  doc.markModified('servers')
  doc.lastUsedAt = now
  await doc.save()

  return { success: true, serverUrl: normalizedServerUrl }
}

/**
 * Remove a server configuration for a user
 */
async function _removeServer(userId, provider, serverUrl) {
  const normalizedServerUrl = serverUrl?.replace(/\/$/, '')

  const doc = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (doc) {
    const serversMap = { ...(doc.servers || {}) }
    if (normalizedServerUrl) {
      if (serversMap[provider]) delete serversMap[provider][normalizedServerUrl]
    } else {
      delete serversMap[provider]
    }
    if (serversMap[provider] && !Object.keys(serversMap[provider]).length) {
      delete serversMap[provider]
    }
    doc.servers = serversMap
    doc.markModified('servers')
    doc.lastUsedAt = new Date()
    await doc.save()
  }

  // Also remove the PAT token(s)
  await _removeUserPAT(userId, provider, normalizedServerUrl) // hold: lock already acquired in removeServer

  return { success: true }
}

/**
 * Get servers with usernames only (without encrypted tokens)
 */
async function getPublicServers(userId) {
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))

  if (!credentials) return []

  const tokens = credentials.tokens || {}
  if (!Object.keys(tokens).length) {
    // legacy OAuth token (pre-PAT schema) -> expose as a single github server
    if (credentials.github) {
      return [{
        id: `github:${getDefaultServerUrl('github')}`,
        provider: 'github',
        url: getDefaultServerUrl('github'),
        username: ''
      }]
    }
    return []
  }

  // Enumerate stored tokens (source of truth for registered providers)
  const serversList = []
  for (const [provider, urlMap] of Object.entries(credentials.tokens)) {
    for (const [serverUrl, entry] of Object.entries(urlMap || {})) {
      if (typeof entry !== 'string') continue // skip corrupted nested entries
      const config = credentials.servers?.[provider]?.[serverUrl] || {}
      serversList.push({
        id: `${provider}:${serverUrl}`,
        provider,
        url: serverUrl,
        username: config.username || ''
      })
    }
  }

  return serversList
}

// ------------------------- Legacy functions (for backward compatibility) -------------------------- //

async function getUserToken(userId) {
  // Try new format first, fall back to legacy
  try {
    const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
    if (!credentials) throw new InvalidTokenError('no user token', { userId, status: 400 })
    
    // Check for 'github' provider (legacy format)
    const defaultUrl = getDefaultServerUrl('github')
    const storedToken = credentials.tokens?.github?.[defaultUrl]
    if (storedToken) {
      return await decryptAccessToken(storedToken)
    }
    
    throw new InvalidTokenError('no token found', { userId, status: 400 })
  } catch (err) {
    // If error is "no user token", check for legacy format
    if ((err).status === 400 && (err.message)?.includes('no user token')) {
      const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
      if (!credentials) throw new InvalidTokenError('no user token', { userId, status: 400 })
      
      // Legacy format: directly stored 'github' field
      if (credentials.github) {
        return await decryptAccessToken(credentials.github)
      }
    }
    throw err
  }
}

async function saveUserToken(userId, accessToken, serverTypeOrServerUrl) {
  let provider = 'github'
  let serverUrl = getDefaultServerUrl('github')

  // Parse parameters (handle legacy vs new format)
  if (typeof serverTypeOrServerUrl === 'string' && validProviders.includes(serverTypeOrServerUrl)) {
    // Provider type passed as string
    provider = serverTypeOrServerUrl
    serverUrl = getDefaultServerUrl(provider)
  } else if (typeof serverTypeOrServerUrl === 'string') {
    // It's a URL, assume github provider
    serverUrl = serverTypeOrServerUrl
  }
  
  return await saveUserPAT(userId, provider, serverUrl, accessToken)
}

async function removeUserToken(userId, { clearAll = false } = {}) {
  // H10: the default must not be an all-providers footgun. It removes ONLY
  // the `github` provider entries (tokens + servers maps); other providers'
  // tokens are preserved byte-for-byte. PATs need no server-side revocation.
  if (clearAll) {
    // legacy full wipe — kept for explicit opt-in only
    await GitHubSyncUserCredentials.deleteOne(normalizeQuery({ userId }))
    return
  }

  await withUserLock(userId, async () => {
    const doc = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
    if (!doc) return

    const tokens = { ...(doc.tokens || {}) }
    const servers = { ...(doc.servers || {}) }
    delete tokens.github
    delete servers.github

    // Only one (github) provider was stored → the doc becomes empty; delete it.
    if (!Object.keys(tokens).length && !Object.keys(servers).length) {
      await GitHubSyncUserCredentials.deleteOne(normalizeQuery({ userId }))
      return
    }

    doc.tokens = tokens
    doc.servers = servers
    doc.markModified('tokens')
    doc.markModified('servers')
    doc.lastUsedAt = new Date()
    await doc.save()
  })

  logger.debug({ userId }, 'removed github provider entries from user credentials')
}

// ------------------------- exports -------------------------- //
async function saveUserPAT(userId, provider, serverUrl, pat) {
  return withUserLock(userId, () => _saveUserPAT(userId, provider, serverUrl, pat))
}
async function updateServerUsername(userId, provider, serverUrl, username) {
  return withUserLock(userId, () => _updateServerUsername(userId, provider, serverUrl, username))
}
async function addServerConfig(userId, provider, serverUrl, username) {
  return withUserLock(userId, () => _addServerConfig(userId, provider, serverUrl, username))
}
async function removeServer(userId, provider, serverUrl) {
  return withUserLock(userId, () => _removeServer(userId, provider, serverUrl))
}
async function removeUserPAT(userId, provider, serverUrl) {
  return withUserLock(userId, () => _removeUserPAT(userId, provider, serverUrl))
}

export default {
  saveUserPAT,
  getUserPAT,
  getUserPATCredentials,
  getLinkedServers,
  removeUserPAT,
  addServerConfig,
  removeServer,
  getPublicServers,
  getUserServers,
  updateServerUsername,
  
  // Legacy functions (for backward compatibility)
  saveUserToken,
  getUserToken,
  removeUserToken
}
