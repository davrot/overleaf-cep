import WebdavCredentials from './WebdavCredentials.mjs'
import { WebdavSyncProjectStates } from '../models/webdavSyncProjectStates.mjs'
import WebdavController from './WebdavController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import logger from '@overleaf/logger'
import WebdavHandler from './WebdavHandler.mjs'

const { ensureUserCanWriteProjectContent } = AuthorizationMiddleware

/**
 * Express router for WebDAV-related API endpoints.
 * Provides routes for:
 * - User connection management (connect, disconnect, status)
 * - Project synchronization (pull, push, state, conflict resolution)
 * - Importing projects from WebDAV
 */
export default {
  /**
   * Registers WebDAV routes on the provided webRouter.
   * 
   * @param {Object} webRouter - Express router instance to register routes on
   */
  apply(webRouter) {
    // Get user's WebDAV connection status
    webRouter.get(
      '/user/webdav/status',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const credentials = await WebdavCredentials.get(userId)
          if (!credentials) {
            return res.json({ connected: false })
          }

          // Get project sync state for last sync info
          const projects = await WebdavSyncProjectStates.find(
            { username: credentials.username },
            { projectId: 1, lastSyncAt: 1, lastSyncError: 1, lastConflict: 1 }
          ).lean()

          res.json({
            connected: true,
            baseUrl: credentials.baseUrl,
            rootPath: credentials.rootPath,
            lastSyncAt: projects[0]?.lastSyncAt || null,
            lastSyncError: projects[0]?.lastSyncError || null,
            lastConflict: projects[0]?.lastConflict || null,
          })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Connect to WebDAV
    webRouter.post(
      '/user/webdav/connect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const { baseUrl, username, password, rootPath } = req.body
          await WebdavCredentials.save(userId, { baseUrl, username, password, rootPath })
          res.json({ success: true })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Disconnect from WebDAV
    webRouter.post(
      '/user/webdav/disconnect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          await WebdavCredentials.remove(userId)
          res.json({ success: true })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Poll remote WebDAV for changes and pull them (user settings page)
    webRouter.post(
      '/user/webdav/poll',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          // Get user credentials
          const credentials = await WebdavCredentials.get(userId)
          if (!credentials) {
            return res.status(404).json({ error: 'WebDAV not configured' })
          }

          // For now, just acknowledge the poll request without performing sync
          // Full polling requires project-specific logic (handled in project modal)
          res.json({ success: true, message: 'Poll acknowledged' })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Get project state
    webRouter.get(
      '/project/:project_id/webdav/state',
      ensureUserCanWriteProjectContent,
      WebdavController.getProjectState
    )

    // Pull from WebDAV into Overleaf (manual trigger)
    webRouter.post(
      '/project/:project_id/webdav/pull',
      ensureUserCanWriteProjectContent,
      WebdavController.pullRemoteChanges
    )

    // Push local Overleaf changes to WebDAV (manual trigger)
    webRouter.post(
      '/project/:project_id/webdav/push',
      ensureUserCanWriteProjectContent,
      WebdavController.pushLocalChanges
    )

    // List remote files in project's WebDAV folder
    webRouter.get(
      '/project/:project_id/webdav/files',
      ensureUserCanWriteProjectContent,
      WebdavController.listFiles
    )

    // Resolve conflict by keeping local or remote version
    webRouter.post(
      '/project/:project_id/webdav/conflict/resolve',
      ensureUserCanWriteProjectContent,
      WebdavController.resolveProjectConflict
    )

    // Link a project to WebDAV (create project sync state)
    webRouter.post(
      '/project/:project_id/webdav/link',
      ensureUserCanWriteProjectContent,
      WebdavController.linkProject
    )

    // Get project name
    webRouter.get(
      '/project/:project_id/webdav/project-name',
      ensureUserCanWriteProjectContent,
      WebdavController.getProjectName
    )

    // Unlink a project from WebDAV (DELETE)
    webRouter.delete(
      '/project/:project_id/webdav/state',
      ensureUserCanWriteProjectContent,
      WebdavController.unlinkProject
    )

    // Create a new project by importing content from WebDAV
    webRouter.post(
      '/project/new/webdav',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const { projectName, rootPath } = req.body
          if (!projectName) {
            return res.status(400).json({ error: 'projectName is required' })
          }

          // Import from WebDAV
          await WebdavHandler.importRemoteProject(userId, null, projectName, rootPath)
          res.json({ success: true, message: 'Import completed' })
        } catch (err) {
          logger.error({ err, userId, body: req.body }, 'WebDAV import failed')
          res.status(500).json({ error: err.message || 'Import failed' })
        }
      }
    )
  },
}
