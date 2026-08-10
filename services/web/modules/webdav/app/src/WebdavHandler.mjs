import { createWebdavClient } from './WebdavClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import WebdavTokenManager from './WebdavTokenManager.mjs'
import WebdavPaths from './WebdavPaths.mjs'
import logger from '@overleaf/logger'

async function getConnectionState(userId) {
  try {
    const credentials = await WebdavTokenManager.getUserCredentials(userId)
    if (!credentials) return false
    
    const { baseUrl, username, password } = credentials
    const client = createWebdavClient(baseUrl, username, password || '')
    await client.check()
    return true
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to verify WebDAV connection')
    return false
  }
}

async function getProjectState(projectId) {
  let state = await SyncStateManager.getProjectState(projectId)
  if (!state) {
    return { connected: false }
  }
  
  // Verify the connection is still valid
  try {
    const client = createWebdavClient(state.baseUrl, state.username || '', state.password || '')
    await client.check()
    state.connected = true
  } catch (err) {
    logger.warn({ err, projectId }, 'Failed to verify WebDAV connection status')
    state.connected = false
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
  const client = createWebdavClient(state.baseUrl, username, password, rootPath)
  
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
    throw new Error('Project is not linked to WebDAV')
  }
  
  // TODO: Implement pushing local Overleaf changes to WebDAV
  throw new Error('pushLocalChanges not fully implemented - needs overleaf-to-webdav sync logic')
}

export default {
  getConnectionState,
  getProjectState,
  unlinkProject,
  importRemoteProject,
  pushLocalChanges,
}

export { SyncStateManager, WebdavTokenManager, createWebdavClient }

// Debug stubs for functions not yet fully implemented
async function pollRemoteSync(projectId) {
  logger.info({ projectId }, 'pollRemoteSync called - STUB: needs full implementation')
  // TODO: Implement polling WebDAV for changes and importing them
  return { success: true, message: 'pollRemoteSync stub executed' }
}

export { pollRemoteSync }
