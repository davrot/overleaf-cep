import { expressify } from '@overleaf/promise-utils'
import OError from '@overleaf/o-error'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'

import WebdavHandler, { createWebdavClient } from './WebdavHandler.mjs'
import WebdavPaths from './WebdavPaths.mjs'
import ConflictResolver from './ConflictResolver.mjs'

// Import sub-modules for linkProject
const SyncStateManager = WebdavHandler.SyncStateManager || (await import('./SyncStateManager.mjs')).default
const WebdavTokenManager = WebdavHandler.WebdavTokenManager || (await import('./WebdavTokenManager.mjs')).default

/**
 * Get user's WebDAV connection state (Express-wrapped)
 * Returns whether the current logged-in user has a valid WebDAV connection.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with connected status
 */
async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const isConnected = await WebdavHandler.getConnectionState(userId)
    return res.json({ connected: isConnected })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, userId }, 'failed to get connection status')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Get project's sync state with WebDAV (Express-wrapped)
 * Retrieves the current sync configuration and status for a project.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object  
 * @returns {Promise<void>} Sends JSON response with project state
 */
async function getProjectState(req, res) {
  const { project_id: projectId } = req.params

  try {
    const state = await WebdavHandler.getProjectState(projectId)
    return res.json(state)
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to get project state')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Poll remote WebDAV for changes and pull them into Overleaf (Express-wrapped)
 * Compares file hashes/ETags between remote and local versions,
 * downloading new files and updating modified ones. Detects conflicts when
 * both sides have been modified since last sync.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with success/error status
 */
async function pullRemoteChanges(req, res) {
  const { project_id: projectId } = req.params

  try {
    await WebdavHandler.pollRemoteSync(projectId)
    return res.json({ success: true, message: 'Pull completed' })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to poll remote WebDAV')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Push local Overleaf changes to WebDAV (Express-wrapped)
 * Uploads all files from the current Overleaf project version to the remote
 * WebDAV folder. Uses ETag-based concurrency control.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params and userId from session
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with success/error status
 */
async function pushLocalChanges(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    await WebdavHandler.pushLocalChanges(userId, projectId)
    return res.json({ success: true, message: 'Push completed' })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to push local changes')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * List remote files in a project's WebDAV folder (Express-wrapped)
 * Returns a list of files from the project's remote WebDAV folder.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with array of files
 */
async function listFiles(req, res) {
  const { project_id: projectId } = req.params

  try {
    // Check if project is linked to WebDAV
    const state = await WebdavHandler.getProjectState(projectId)
    if (!state.connected) {
      return res.status(404).json({ message: 'Project not linked to WebDAV' })
    }

    // Build remote path and list files using handler's createWebdavClient
    const projectName = await getProjectName(projectId)
    const remoteRoot = WebdavPaths.remotePath(state.rootPath, projectName)

    const client = createWebdavClient(state.baseUrl, state.username, '')
    const files = (await client.list(remoteRoot) || []).filter(f => !f.isDirectory)

    return res.json({
      files: files.map(f => ({
        path: f.path,
        size: f.size,
        lastModified: f.lastModified,
      }))
    })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to list remote files')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'

/**
 * Get project name helper (Express-wrapped)
 * Fetches the Overleaf project name from the database.
 * 
 * @param {Object} req - Express request object with req.params.project_id
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with project name
 */
async function getProjectName(req, res) {
  const projectId = req.params.project_id
  try {
    const projectDoc = await ProjectGetter.promises.getProject(projectId, { name: 1 })
    const projectName = projectDoc?.name || `project_${projectId}`
    return res.json({ projectName })
  } catch (err) {
    logger.warn({ message: err.message, projectId }, 'Failed to get project name, using fallback')
    return res.json({ projectName: `project_${projectId}` })
  }
}

/**
 * Resolve a conflict by keeping local or remote version (Express-wrapped)
 * Marks a conflict as resolved and updates the project's sync state.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with resolution result
 */
async function linkProject(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const { baseUrl, rootPath, username } = req.body || {}

    if (!baseUrl || !rootPath) {
      return res.status(400).json({
        message: 'Missing required parameters: baseUrl and rootPath are required'
      })
    }

    // Get user credentials to get the actual username
    let actualUsername = username
    try {
      const credentials = await WebdavTokenManager.getUserCredentials(userId)
      if (credentials) {
        actualUsername = credentials.username
      }
    } catch (err) {
      logger.warn({ message: err.message, userId }, 'Could not fetch user credentials, Using provided username')
    }

    // Create project sync state
    await SyncStateManager.createProjectState(projectId, {
      connected: true,
      baseUrl,
      rootPath,
      username: actualUsername,
      lastSyncAt: null,
      mergeStatus: 'clean'
    })

    // Immediately trigger a pollRemoteSync to import any existing files from WebDAV
    try {
      logger.info({ projectId }, 'Triggering initial sync (import + export) after linking project to WebDAV')
      // First pull from WebDAV to Overleaf
      await WebdavHandler.pollRemoteSync(projectId)
      // Then push from Overleaf to WebDAV
      await WebdavHandler.pushLocalChanges(userId, projectId)
    } catch (syncErr) {
      // Don't fail the link if sync fails - just log it
      logger.warn({ message: syncErr.message, projectId }, 'Initial WebDAV sync failed but project linking succeeded')
    }

    return res.json({
      success: true,
      message: 'Project linked to WebDAV successfully',
      state: { connected: true, baseUrl, rootPath }
    })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to link project to WebDAV')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

async function resolveProjectConflict(req, res) {
  const { project_id: projectId } = req.params
  const { path, choice } = req.body

  try {
    if (!path || !choice) {
      return res.status(400).json({
        message: 'Missing required parameters: path and choice are required'
      })
    }

    if (choice !== 'local' && choice !== 'remote') {
      return res.status(400).json({
        message: "Invalid choice. Must be 'local' or 'remote'"
      })
    }

    await ConflictResolver.resolve(projectId, path, choice)

    return res.json({
      success: true,
      message: `Conflict resolved - keeping ${choice} version`,
      path
    })
  } catch (err) {
    if (err.message?.includes('not found') || err.message?.includes('Conflict not found')) {
      return res.status(404).json({
        message: 'No active conflict for this file',
        errorCode: 'CONFLICT_NOT_FOUND'
      })
    }

    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to resolve conflict')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Unlink a project from WebDAV (Express-wrapped)
 * Removes theassociation between an Overleaf project and its WebDAV folder.
 * Does NOT delete the remote files - only clears local sync configuration.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with success status
 */
async function unlinkProject(req, res) {
  const { project_id: projectId } = req.params

  try {
    await WebdavHandler.unlinkProject(projectId)
    return res.json({
      success: true,
      message: 'Project unlinked from WebDAV'
    })
  } catch (err) {
    if (err.message?.includes('not linked') || err.message?.includes('not found')) {
      return res.status(404).json({
        message: 'Project is not linked to WebDAV',
        errorCode: 'PROJECT_NOT_LINKED'
      })
    }

    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to unlink project from WebDAV')
    return res.status(err?.response?.status || 500).json({ message: err.message })
  }
}

export default {
  /**
   * Get user's WebDAV connection state (Express-wrapped)
   */
  getConnectionStatus: expressify(getConnectionStatus),

  /**
   * Get project's sync state with WebDAV (Express-wrapped)
   */
  getProjectState: expressify(getProjectState),

  /**
   * Poll remote WebDAV for changes and pull them into Overleaf (Express-wrapped)
   */
  pullRemoteChanges: expressify(pullRemoteChanges),

  /**
   * Push local Overleaf changes to WebDAV (Express-wrapped)
   */
  pushLocalChanges: expressify(pushLocalChanges),

  /**
   * List remote files in a project's WebDAV folder (Express-wrapped)
   */
  listFiles: expressify(listFiles),

  /**
   * Link a project to WebDAV (Express-wrapped)
   */
  linkProject: expressify(linkProject),

  /**
   * Resolve a conflict by keeping local or remote version (Express-wrapped)
   */
  resolveProjectConflict: expressify(resolveProjectConflict),

  /**
   * Get project name (Express-wrapped)
   */
  getProjectName: expressify(getProjectName),

  /**
   * Unlink a project from WebDAV (Express-wrapped)
   */
  unlinkProject: expressify(unlinkProject),
}
