import { WebDAVServiceClient } from './WebDAVServiceClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import WebdavTokenManager from './WebdavTokenManager.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import WebdavPaths from './WebdavPaths.mjs'
import logger from '@overleaf/logger'
import WebdavSync from './WebdavSync.mjs'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import { Readable } from 'node:stream'

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
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) throw new Error('WebDAV is not connected')

  const remoteRoot = WebdavPaths.remotePath(
    rootPath || credentials.rootPath,
    projectName
  )
  const client = new WebDAVServiceClient(credentials)
  const files = []

  async function collectFiles(resourcePath) {
    for (const entry of await client.list(resourcePath)) {
      if (entry.path === resourcePath || entry.path.endsWith(`${resourcePath}/`)) continue
      if (entry.isDirectory) await collectFiles(entry.path)
      else files.push(entry)
    }
  }

  await collectFiles(remoteRoot)
  if (files.length === 0) {
    logger.info({ projectId, remoteRoot }, 'No files found in WebDAV project folder')
    return { importedFiles: 0 }
  }

  let importedFiles = 0
  for (const file of files) {
    const relativePath = file.path.slice(remoteRoot.length) || '/'
    const body = await client.get(file.path)
    await TpdsUpdateHandler.promises.newUpdate(
      userId,
      null,
      projectName,
      relativePath,
      Readable.from([Buffer.from(body)]),
      'webdav'
    )
    importedFiles += 1
  }
  return { importedFiles }
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
