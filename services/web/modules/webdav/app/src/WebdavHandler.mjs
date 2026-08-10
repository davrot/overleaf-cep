import { WebDAVServiceClient } from './WebDAVServiceClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import WebdavTokenManager from './WebdavTokenManager.mjs'
import WebdavPaths from './WebdavPaths.mjs'
import logger from '@overleaf/logger'

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

async function getProjectState(projectId, { verifyConnection = true } = {}) {
  let state = await SyncStateManager.getProjectState(projectId)
  if (!state) {
    return { connected: false }
  }
  
  // Verify the connection is still valid (unless disabled)
  if (verifyConnection) {
    try {
      const credentials = await WebdavTokenManager.getUserCredentials(state.userId || '') || state
      const client = new WebDAVServiceClient(credentials)
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
  const state = await SyncStateManager.getProjectState(projectId)
  if (!state || !state.connected) {
    logger.info({ projectId }, 'pushLocalChanges: not connected to WebDAV')
    return { success: false, message: 'Not connected to WebDAV' }
  }

  // For initial sync, we only need to pull from WebDAV (import existing files)
  // Local-to-WebDAV push is implemented in WebdavSync.mjs for ongoing sync
  logger.info(
    { projectId },
    'pushLocalChanges skipped - initial sync uses pullRemoteSync; local-to-webdav push available via WebdavSync'
  )
  return { success: true, message: 'Push skipped (use WebdavSync for full bidirectional sync)' }
}

// Debug stub for polling WebDAV for changes
async function pollRemoteSync(projectId, { force = false } = {}) {
  const state = await SyncStateManager.getProjectState(projectId)
  if (!state || !state.connected) {
    throw new Error('Project is not linked to WebDAV')
  }
  
  logger.info({ projectId, baseUrl: state.baseUrl }, 'pollRemoteSync called - stub implementation')
  // TODO: Implement polling WebDAV for changes and importing them
  return { success: true, message: 'pollRemoteSync executed' }
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
