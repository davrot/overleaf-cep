import { encryptToken, decryptToken } from './DropboxCredentials.mjs'
import { DropboxUserCredentials } from '../models/dropboxUserCredentials.mjs'
import { DropboxSyncProjectStates } from '../models/dropboxSyncProjectStates.mjs'
import DropboxClient from './DropboxClient.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import logger from '@overleaf/logger'

const { ensureUserCanWriteProjectContent } = AuthorizationMiddleware

/**
 * Express router for Dropbox-related API endpoints.
 */
export default {
  /**
   * Registers Dropbox routes on the provided webRouter.
   */
  apply(webRouter) {
    const { baseUrl, rootPath, username: _unusedUsername } = process.env

    // Get user's Dropbox connection status
    webRouter.get(
      '/user/dropbox/status',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.json({ connected: false })
          }

          // Decrypt access token
          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          // Get project sync state for last sync info
          const projects = await DropboxSyncProjectStates.find(
            { path: rootPath || '/Overleaf/Dropbox' },
            { projectId: 1, lastSyncAt: 1, lastSyncError: 1 }
          ).lean()

          res.json({
            connected: true,
            accessToken: 'set', // Don't expose full token
            path: rootPath || '/Overleaf/Dropbox',
            lastSyncAt: projects[0]?.lastSyncAt || null,
            lastSyncError: projects[0]?.lastSyncError || null,
          })
        } catch (err) {
          logger.error({ err }, 'Failed to get Dropbox status')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Connect to Dropbox
    webRouter.post(
      '/user/dropbox/connect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const { access_token } = req.body

          if (!access_token) {
            return res.status(400).json({ error: 'Missing access_token' })
          }

          // Validate token format (starts with sl.)
          if (!access_token.startsWith('sl.')) {
            console.warn(`Dropbox token does not start with sl. - may be invalid`)
          }

          // Encrypt and store
          const encryptedToken = encryptToken(access_token)
          await DropboxUserCredentials.findOneAndUpdate(
            { userId },
            { accessToken: encryptedToken },
            { upsert: true, new: true }
          )

          res.json({ success: true })
        } catch (err) {
          logger.error({ err }, 'Failed to connect to Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Disconnect from Dropbox
    webRouter.post(
      '/user/dropbox/disconnect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          await DropboxUserCredentials.deleteOne({ userId })
          res.json({ success: true })
        } catch (err) {
          logger.error({ err }, 'Failed to disconnect from Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Get project's Dropbox sync state
    webRouter.get(
      '/project/:id/dropbox/state',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.id

        try {
          const state = await DropboxSyncProjectStates.findOne({ projectId })
          res.json(state || { connected: false })
        } catch (err) {
          logger.error(
            { err, projectId },
            'Failed to get project Dropbox state'
          )
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Link project to Dropbox
    webRouter.post(
      '/project/:id/dropbox/link',
      async (req, res) => {
        const userId = req.user?/_id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.id
        const { path } = req.body

        try {
          // Verify user is connected to Dropbox first
          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.status(409).json({
              error: 'Not connected to Dropbox. Please connect your account first.',
            })
          }

          // Decrypt token
          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          // Create client and verify connection
          const client = new DropboxClient({ accessToken })
          await client.checkConnection()

          // Save project state
          const state = new DropboxSyncProjectStates({
            projectId,
            connected: true,
            path: path || '/Overleaf/Dropbox',
          })
          await state.save()

          res.json({ success: true, path: state.path })
        } catch (err) {
          logger.error(
            { err, projectId },
            'Failed to link project to Dropbox'
          )
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Unlink project from Dropbox
    webRouter.delete(
      '/project/:id/dropbox/state',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.id

        try {
          await DropboxSyncProjectStates.deleteOne({ projectId })
          res.json({ success: true })
        } catch (err) {
          logger.error(
            { err, projectId },
            'Failed to unlink project from Dropbox'
          )
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Pull remote changes into Overleaf
    webRouter.post(
      '/project/:id/dropbox/pull',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.id

        try {
          // Get project state and user credentials
          const state = await DropboxSyncProjectStates.findOne({
            projectId,
          }).select('path connected')
          if (!state || !state.connected) {
            return res.status(409).json({
              error: 'Project not linked to Dropbox',
            })
          }

          // TODO: Implement pull logic
          // For now, just acknowledge the request
          await state.updateOne({ lastSyncAt: new Date() })

          res.json({ success: true, message: 'Pull initiated' })
        } catch (err) {
          logger.error({ err, projectId }, 'Failed to pull from Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Push local changes to Dropbox
    webRouter.post(
      '/project/:id/dropbox/push',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.id

        try {
          const state = await DropboxSyncProjectStates.findOne({
            projectId,
          }).select('path connected')
          if (!state || !state.connected) {
            return res.status(409).json({
              error: 'Project not linked to Dropbox',
            })
          }

          // TODO: Implement push logic
          await state.updateOne({ lastSyncAt: new Date() })

          res.json({ success: true, message: 'Push initiated' })
        } catch (err) {
          logger.error({ err, projectId }, 'Failed to push to Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // List files in project's Dropbox folder
    webRouter.get(
      '/project/:id/dropbox/files',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.id

        try {
          const state = await DropboxSyncProjectStates.findOne({
            projectId,
          }).select('path connected')

          if (!state || !state.connected) {
            return res.status(409).json({
              error: 'Project not linked to Dropbox',
            })
          }

          // Get user credentials
          const credentials = await DropboxUserCredentials.findOne({ userId })
          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          // List files using Dropbox client
          const client = new DropboxClient({ accessToken })
          const result = await client.list(state.path)

          res.json({
            path: state.path,
            entries: result.entries || [],
          })
        } catch (err) {
          logger.error({ err, projectId }, 'Failed to list Dropbox files')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Resolve a sync conflict
    webRouter.post(
      '/project/:id/dropbox/conflict/resolve',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.id
        const { path, choice } = req.body

        try {
          // TODO: Implement conflict resolution logic
          // For now, just acknowledge the request
          res.json({
            success: true,
            message: `Conflict resolved - keeping ${choice}`,
          })
        } catch (err) {
          logger.error({ err, projectId }, 'Failed to resolve Dropbox conflict')
          res.status(500).json({ error: err.message })
        }
      }
    )
  },
}
