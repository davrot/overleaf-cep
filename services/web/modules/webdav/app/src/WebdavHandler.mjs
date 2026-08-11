import { WebDAVServiceClient } from './WebDAVServiceClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import WebdavTokenManager from './WebdavTokenManager.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import WebdavPaths from './WebdavPaths.mjs'
import logger from '@overleaf/logger'
import WebdavSync from './WebdavSync.mjs'

async function getConnectionState(userId) {
  try {
    const credentials = await WebdavTokenManager.getUserCredentials(userId)
    if (!credentials) return false
    
    const client = new WebDAVServiceClient(credentials)
    await client.check()
    return true
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to verify WebDAV connection')
    return false
  }
}

async function getProjectState(projectId, { userId, verifyConnection = true } = {}) {
  let state = await SyncStateManager.getProjectState(projectId)
  if (!state) {
    return { connected: false }
  }
  
  // Verify the connection is still valid (unless disabled)
  if (verifyConnection) {
    try {
      const credentials = userId ? await WebdavCredentials.get(userId) : null
      const client = new WebDAVServiceClient(credentials || state)
      await client.check()
      state.connected = true
    } catch (err) {
      logger.warn({ err, projectId }, 'Failed to verify WebDAV connection status')
      state.connected = false
    }
  }
  
  return state
}

async function unlinkProject(projectId) {
  const state = await SyncStateManager.getProjectState(projectId)
  if (!state) {
    throw new Error('Project is not linked to WebDAV')
  }
  
  await SyncStateManager.removeProjectState(projectId)
}

async function importRemoteProject(userId, projectId, projectName, rootPath) {
  const state = await SyncStateManager.getProjectState(projectId)
  if (!state || !state.connected) {
    throw new Error('Project is not linked to WebDAV')
  }
  
  // Get user credentials for the actual password
  let username = state.username
  let password = ''
  try {
    const credentials = await WebdavTokenManager.getUserCredentials(userId)
    if (credentials) {
      password = credentials.password || ''
    }
  } catch (err) {
    logger.warn({ message: err.message, userId }, 'Could not fetch user credentials')
  }
  
  const remoteRoot = WebdavPaths.remotePath(rootPath || state.rootPath, projectName)
  const client = new WebDAVServiceClient({
    baseUrl: state.baseUrl,
    username: username,
    password: password
  })
  
  // List files in the remote project folder
  let files
  try {
    files = await client.list(remoteRoot) || []
  } catch (err) {
    logger.warn({ err, remoteRoot }, 'Failed to list remote WebDAV directory')
    files = []
  }
  
  if (!files.length) {
    logger.info({ projectId, remoteRoot }, 'No files found in WebDAV project folder')
    return null
  }
  
  // TODO: Implement zip creation for import
  throw new Error('importRemoteProject not fully implemented - needs zip creation logic')
}

async function pushLocalChanges(userId, projectId) {
  await WebdavSync.syncProject(userId, projectId)
  return { success: true, message: 'Push completed' }
}

async function pollRemoteSync(projectId, { userId } = {}) {
  if (!userId) throw new Error('User is required for WebDAV pull')
  await WebdavSync.pollUser(userId)
  return { success: true, message: 'Pull completed' }
}

export default {
  getConnectionState,
  getProjectState,
  unlinkProject,
  importRemoteProject,
  pushLocalChanges,
  pollRemoteSync,
}

export { SyncStateManager, WebdavTokenManager }
