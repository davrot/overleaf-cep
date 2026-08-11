import { encryptToken, decryptToken } from './DropboxCredentials.mjs'
import { DropboxUserCredentials } from '../models/dropboxUserCredentials.mjs'
import { DropboxSyncProjectStates } from '../models/dropboxSyncProjectStates.mjs'
import DropboxClient from './DropboxClient.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import logger from '@overleaf/logger'
import { randomBytes } from 'node:crypto'

const { ensureUserCanWriteProjectContent } = AuthorizationMiddleware
const DEFAULT_DROPBOX_PATH = 'Overleaf%20Dev'

function normalizeDropboxPath(path) {
  return path === '/Overleaf/Dropbox' || !path ? DEFAULT_DROPBOX_PATH : path
}

/**
 * Express router for Dropbox-related API endpoints.
 */
export default {
  /**
   * Registers Dropbox routes on the provided webRouter.
   */
  apply(webRouter) {
    const { DROPBOX_APP_KEY: appKey, DROPBOX_APP_SECRET: appSecret } = process.env
    const oauthRedirectPath = '/user/dropbox/oauth/callback'

    webRouter.get(
      '/user/dropbox/oauth2',
      AuthenticationController.requireLogin(),
      (req, res) => {
        if (!appKey || !appSecret) {
          return res.status(503).send('Dropbox OAuth is not configured')
        }
        const state = randomBytes(24).toString('hex')
        req.session.dropboxOAuthState = state
        const siteUrl = process.env.LINKED_URL || process.env.SITE_URL || `${req.protocol}://${req.get('host')}`
        const redirectUri = new URL(oauthRedirectPath, siteUrl).toString()
        const authorizeUrl = new URL('https://www.dropbox.com/oauth2/authorize')
        authorizeUrl.search = new URLSearchParams({
          client_id: appKey,
          response_type: 'code',
          redirect_uri: redirectUri,
          token_access_type: 'offline',
          state,
        }).toString()
        res.redirect(authorizeUrl.toString())
      }
    )

    webRouter.get(
      oauthRedirectPath,
      AuthenticationController.requireLogin(),
      async (req, res) => {
        const expectedState = req.session.dropboxOAuthState
        delete req.session.dropboxOAuthState
        if (!req.query.state || req.query.state !== expectedState) {
          return res.status(400).send('Invalid Dropbox OAuth state')
        }
        if (req.query.error) return res.redirect('/user/settings')
        if (!appKey || !appSecret || typeof req.query.code !== 'string') {
          return res.status(400).send('Missing Dropbox OAuth configuration or code')
        }
        try {
          const siteUrl = process.env.LINKED_URL || process.env.SITE_URL || `${req.protocol}://${req.get('host')}`
          const redirectUri = new URL(oauthRedirectPath, siteUrl).toString()
          const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              code: req.query.code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }),
          })
          if (!tokenResponse.ok) {
            throw new Error(`Dropbox token exchange failed: ${tokenResponse.status}`)
          }
          const tokenData = await tokenResponse.json()
          await DropboxUserCredentials.findOneAndUpdate(
            { userId: req.user._id },
            {
              accessToken: encryptToken(tokenData.access_token),
              path: DEFAULT_DROPBOX_PATH,
            },
            { upsert: true, new: true }
          )
          res.redirect('/user/settings')
        } catch (err) {
          logger.error({ err }, 'Dropbox OAuth callback failed')
          res.status(502).send('Dropbox OAuth connection failed')
        }
      }
    )

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

          const path = normalizeDropboxPath(credentials.path)
          if (credentials.path !== path) {
            credentials.path = path
            await credentials.save()
          }

          // Get project sync state for last sync info
          const projects = await DropboxSyncProjectStates.find(
            { path },
            { projectId: 1, lastSyncAt: 1, lastSyncError: 1 }
          ).lean()

          res.json({
            connected: true,
            accessToken: 'set', // Don't expose full token
            path,
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
            { accessToken: encryptedToken, path: DEFAULT_DROPBOX_PATH },
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
      '/project/:project_id/dropbox/state',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

        try {
          const state = await DropboxSyncProjectStates.findOne({ projectId })
          if (state?.path === '/Overleaf/Dropbox') {
            state.path = DEFAULT_DROPBOX_PATH
            await state.save()
          }
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
      '/project/:project_id/dropbox/link',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id
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

          const dropboxPath = normalizeDropboxPath(credentials.path)
          if (credentials.path !== dropboxPath) {
            credentials.path = dropboxPath
            await credentials.save()
          }

          // Save project state
          const state = new DropboxSyncProjectStates({
            projectId,
            connected: true,
            path: dropboxPath,
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
      '/project/:project_id/dropbox/state',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

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
      '/project/:project_id/dropbox/pull',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

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
      '/project/:project_id/dropbox/push',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

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
      '/project/:project_id/dropbox/files',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

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
      '/project/:project_id/dropbox/conflict/resolve',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id
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
