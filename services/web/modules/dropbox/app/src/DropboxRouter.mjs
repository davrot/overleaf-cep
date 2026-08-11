import { encryptToken, decryptToken } from './DropboxCredentials.mjs'
import { DropboxUserCredentials } from '../models/dropboxUserCredentials.mjs'
import { DropboxSyncProjectStates } from '../models/dropboxSyncProjectStates.mjs'
import DropboxClient from './DropboxClient.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const { ensureUserCanWriteProjectContent } = AuthorizationMiddleware
const DEFAULT_DROPBOX_PATH = ''
const LEGACY_DROPBOX_PATH = 'Overleaf Dev'

function normalizeDropboxPath(path) {
  if (path === '/Overleaf/Dropbox' || !path) return DEFAULT_DROPBOX_PATH
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep malformed custom paths unchanged.
  }
  return path === LEGACY_DROPBOX_PATH ? DEFAULT_DROPBOX_PATH : path
}

function joinDropboxPath(...parts) {
  const path = parts
    .filter(Boolean)
    .map(part => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return path ? `/${path}` : '/'
}

function relativeDropboxPath(projectPath, entry) {
  const prefix = `${projectPath.replace(/^\//, '')}/`
  const remotePath = entry.relative_path || entry.path_display || entry.name
  const relativePath = remotePath.startsWith(prefix)
    ? remotePath.slice(prefix.length)
    : entry.name
  return `/${relativePath.replace(/^\/+/, '')}`
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function ensureDropboxDirectory(client, directoryPath) {
  const parts = directoryPath.split('/').filter(Boolean)
  let currentPath = ''
  for (const part of parts) {
    currentPath = joinDropboxPath(currentPath, part)
    await client.createDirectory(currentPath)
  }
}

async function uploadProjectToDropbox({ client, projectId, rootPath }) {
  const project = await ProjectGetter.promises.getProject(projectId, { name: true })
  if (!project) throw new Error('Project not found')

  const projectPath = joinDropboxPath(rootPath, project.name)
  await ensureDropboxDirectory(client, projectPath)

  const [docs, files] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])

  let uploadedFiles = 0
  for (const [filePath, doc] of Object.entries(docs)) {
    const remotePath = joinDropboxPath(projectPath, filePath)
    await ensureDropboxDirectory(client, remotePath.split('/').slice(0, -1).join('/'))
    await client.upload(remotePath, Buffer.from(doc.lines.join('\n')).toString('base64'))
    uploadedFiles += 1
  }

  for (const [filePath, file] of Object.entries(files)) {
    const { stream } = await HistoryManager.promises.requestBlobWithProjectId(
      projectId,
      file.hash
    )
    const content = await streamToBuffer(stream)
    const remotePath = joinDropboxPath(projectPath, filePath)
    await ensureDropboxDirectory(client, remotePath.split('/').slice(0, -1).join('/'))
    await client.upload(remotePath, content.toString('base64'))
    uploadedFiles += 1
  }

  return { projectPath, uploadedFiles }
}

function isTextFile(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return (Settings.textExtensions || []).includes(extension)
}

async function importProjectFromDropbox({
  client,
  projectId,
  userId,
  rootPath,
  legacyRootPath,
}) {
  const project = await ProjectGetter.promises.getProject(projectId, { name: true })
  if (!project) throw new Error('Project not found')

  let projectPath = joinDropboxPath(rootPath, project.name)
  let listing
  try {
    listing = await client.list(projectPath, { recursive: true })
  } catch (err) {
    if (!legacyRootPath || !err.message?.includes('Not found')) throw err
    projectPath = joinDropboxPath(legacyRootPath, project.name)
    listing = await client.list(projectPath, { recursive: true })
  }
  const entries = (listing.entries || []).filter(entry => entry.type === 'file')
  const remoteFiles = Object.fromEntries(
    entries.map(entry => [
      relativeDropboxPath(projectPath, entry),
      {
        rev: entry.rev,
        size: entry.size,
        modifiedAt: entry.client_modified || entry.server_modified,
      },
    ])
  )
  let importedFiles = 0
  const temporaryFiles = []

  try {
    for (const entry of entries) {
      const remotePath = entry.relative_path || entry.path_display
      const relativePath = relativeDropboxPath(projectPath, entry)
      const result = await client.download(`/${remotePath}`)
      if (!result?.content_base64) {
        throw new Error(`Dropbox returned no content for ${remotePath}`)
      }
      const content = Buffer.from(result.content_base64, 'base64')

      if (isTextFile(relativePath)) {
        await EditorController.promises.upsertDocWithPath(
          projectId,
          relativePath,
          content.toString('utf8').split('\n'),
          'dropbox',
          userId
        )
      } else {
        const temporaryFile = path.join(
          os.tmpdir(),
          `overleaf-dropbox-${Date.now()}-${importedFiles}`
        )
        temporaryFiles.push(temporaryFile)
        await fs.writeFile(temporaryFile, content)
        await EditorController.promises.upsertFileWithPath(
          projectId,
          relativePath,
          temporaryFile,
          null,
          'dropbox',
          userId
        )
      }
      importedFiles += 1
    }
  } finally {
    await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true })))
  }

  return { projectPath, importedFiles, remoteFiles }
}

async function importNewProjectFromDropbox({ client, userId, projectName, rootPath }) {
  const projectPath = joinDropboxPath(rootPath, projectName)
  const listing = await client.list(projectPath, { recursive: true })
  const entries = (listing.entries || []).filter(entry => entry.type === 'file')
  let importedFiles = 0
  for (const entry of entries) {
    const relativePath = relativeDropboxPath(projectPath, entry)
    const remotePath = entry.relative_path || entry.path_display
    const result = await client.download(`/${remotePath}`)
    if (!result?.content_base64) {
      throw new Error(`Dropbox returned no content for ${remotePath}`)
    }
    await TpdsUpdateHandler.promises.newUpdate(
      userId,
      null,
      projectName,
      relativePath,
      Readable.from([Buffer.from(result.content_base64, 'base64')]),
      'dropbox'
    )
    importedFiles += 1
  }
  return { importedFiles }
}

async function getDropboxRemoteFiles(client, projectPath) {
  const listing = await client.list(projectPath, { recursive: true })
  return Object.fromEntries(
    (listing.entries || [])
      .filter(entry => entry.type === 'file')
      .map(entry => [relativeDropboxPath(projectPath, entry), {
        rev: entry.rev,
        size: entry.size,
        modifiedAt: entry.client_modified || entry.server_modified,
      }])
  )
}

async function reconcileDropboxDeletions({ userId, projectName, previousFiles, remoteFiles }) {
  const previousEntries = previousFiles instanceof Map
    ? Object.fromEntries(previousFiles.entries())
    : previousFiles
  if (!previousEntries || Object.keys(previousEntries).length === 0) return 0
  const currentPaths = new Set(Object.keys(remoteFiles))
  let deletedFiles = 0
  for (const filePath of Object.keys(previousEntries)) {
    if (currentPaths.has(filePath)) continue
    await TpdsUpdateHandler.promises.deleteUpdate(
      userId,
      null,
      projectName,
      filePath,
      'dropbox'
    )
    deletedFiles += 1
  }
  return deletedFiles
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
          if (state) {
            const dropboxPath = normalizeDropboxPath(state.path)
            if (state.path !== dropboxPath) {
              state.path = dropboxPath
              await state.save()
            }
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

          const importResult = await importProjectFromDropbox({
            client,
            projectId,
            userId,
            rootPath: dropboxPath,
            legacyRootPath: LEGACY_DROPBOX_PATH,
          })
          const syncResult = await uploadProjectToDropbox({
            client,
            projectId,
            rootPath: dropboxPath,
          })
          const remoteFiles = await getDropboxRemoteFiles(client, syncResult.projectPath)
          state.lastSyncAt = new Date()
          state.lastSyncError = undefined
          state.remoteFiles = remoteFiles
          await state.save()

          res.json({ success: true, path: state.path, ...importResult, ...syncResult })
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
          }).select('path connected remoteFiles')
          if (!state || !state.connected) {
            return res.status(409).json({
              error: 'Project not linked to Dropbox',
            })
          }

          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.status(409).json({ error: 'Dropbox credentials not found' })
          }

          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          const client = new DropboxClient({ accessToken })
          const dropboxPath = normalizeDropboxPath(state.path)
          if (state.path !== dropboxPath) {
            state.path = dropboxPath
            await state.save()
          }
          let importResult
          try {
            importResult = await importProjectFromDropbox({
              client,
              projectId,
              userId,
              rootPath: dropboxPath,
              legacyRootPath: LEGACY_DROPBOX_PATH,
            })
          } catch (err) {
            if (!err.message?.includes('Not found')) throw err
            await ProjectDeleter.promises.markAsDeletedByExternalSource(projectId)
            await state.updateOne({
              remoteFiles: {},
              lastSyncAt: new Date(),
              lastSyncError: null,
            })
            return res.json({
              success: true,
              message: 'Remote project deleted',
              deletedProject: true,
            })
          }
          const project = await ProjectGetter.promises.getProject(projectId, { name: true })
          const deletedFiles = await reconcileDropboxDeletions({
            userId,
            projectName: project.name,
            previousFiles: state.remoteFiles,
            remoteFiles: importResult.remoteFiles,
          })
          await state.updateOne({
            remoteFiles: importResult.remoteFiles,
            lastSyncAt: new Date(),
            lastSyncError: null,
          })

          res.json({ success: true, message: 'Pull completed', deletedFiles, ...importResult })
        } catch (err) {
          await DropboxSyncProjectStates.updateOne(
            { projectId },
            { $set: { lastSyncError: err.message } }
          )
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

          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.status(409).json({ error: 'Dropbox credentials not found' })
          }

          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          const client = new DropboxClient({ accessToken })
          const dropboxPath = normalizeDropboxPath(state.path)
          if (state.path !== dropboxPath) {
            state.path = dropboxPath
            await state.save()
          }
          const syncResult = await uploadProjectToDropbox({
            client,
            projectId,
            rootPath: dropboxPath,
          })
          const remoteFiles = await getDropboxRemoteFiles(client, syncResult.projectPath)
          await state.updateOne({
            remoteFiles,
            lastSyncAt: new Date(),
            lastSyncError: null,
          })

          res.json({ success: true, message: 'Push completed', ...syncResult })
        } catch (err) {
          await DropboxSyncProjectStates.updateOne(
            { projectId },
            { $set: { lastSyncError: err.message } }
          )
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
          const dropboxPath = normalizeDropboxPath(state.path)
          if (state.path !== dropboxPath) {
            state.path = dropboxPath
            await state.save()
          }
          const result = await client.list(dropboxPath)

          res.json({
            path: dropboxPath,
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

    webRouter.post('/project/new/dropbox', async (req, res) => {
      const userId = req.user?._id || req.user?.id
      if (!userId) return res.status(401).json({ error: 'Unauthorized' })
      const { projectName, rootPath } = req.body
      if (!projectName) {
        return res.status(400).json({ error: 'projectName is required' })
      }
      try {
        const credentials = await DropboxUserCredentials.findOne({ userId })
        if (!credentials) {
          return res.status(409).json({ error: 'Dropbox credentials not found' })
        }
        const client = new DropboxClient({
          accessToken: decryptToken(credentials.accessToken),
        })
        const result = await importNewProjectFromDropbox({
          client,
          userId,
          projectName,
          rootPath: normalizeDropboxPath(rootPath ?? credentials.path),
        })
        res.json({ success: true, message: 'Import completed', ...result })
      } catch (err) {
        logger.error({ err, userId, projectName }, 'Dropbox new project import failed')
        res.status(500).json({ error: err.message || 'Import failed' })
      }
    })
  },
}
