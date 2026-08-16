import { encryptToken, decryptToken } from './DropboxCredentials.mjs'
import { DropboxUserCredentials } from '../models/dropboxUserCredentials.mjs'
import { DropboxSyncProjectStates } from '../models/dropboxSyncProjectStates.mjs'
import DropboxClient, { isSyncExcluded } from './DropboxClient.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { Readable } from 'node:stream'

const { ensureUserCanWriteProjectContent } = AuthorizationMiddleware
const DEFAULT_DROPBOX_PATH = '/'
const LEGACY_DROPBOX_PATH = 'Overleaf Dev'

// C1: content hash (hex) of the EXACT bytes that last entered the project via
// this integration (or, for local content, the bytes currently in the project).
const sha256 = data => createHash('sha256').update(data).digest('hex')

// C1: normalize a project-relative key (strip leading slashes) for lookups.
const normKey = p => String(p || '').replace(/^\/+/, '')

/**
 * BUG1 (user-reported: modal showed "/A5 test" but the files live in
 * "Apps/Overleaf Dev/A5 test"): combine the owner's configured root folder
 * (credentials doc `path`, e.g. "Apps/Overleaf Dev" — may be percent-encoded)
 * with the project state path (e.g. "/A5 test") into the full path exactly as
 * it appears in the Dropbox UI: no leading slash, spaces decoded.
 * A root of "/" or empty yields the state path alone (a plain sandbox root
 * has no displayable name the API exposes).
 * @param {string|null|undefined} rootPath credentials.path
 * @param {string|null|undefined} statePath project state path ("/<project>[/…]")
 * @returns {string}
 */
export function joinDisplayPath(rootPath, statePath) {
  let stateClean = String(statePath || '').replace(/^\/+/, '')
  try {
    stateClean = decodeURIComponent(stateClean)
  } catch {
    // keep as-is on malformed percent-encoding
  }
  if (!stateClean) return ''
  let rootClean = String(rootPath || '').replace(/^\/+|\/+$/g, '')
  try {
    rootClean = decodeURIComponent(rootClean)
  } catch {
    // keep as-is on malformed percent-encoding
  }
  if (!rootClean) return stateClean
  return `${rootClean}/${stateClean}`
}

export function resolveDisplayRoot(activePath, legacyPath, fallback = 'Apps/Overleaf Dev') {
  const configured = activePath || legacyPath
  return configured && configured !== '/' ? configured : fallback
}

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

async function uploadProjectToDropbox({
  client,
  projectId,
  rootPath,
  previousRemoteFiles = null,
  remoteRemoteFiles = null,
}) {
  const project = await ProjectGetter.promises.getProject(projectId, { name: true })
  if (!project) throw new Error('Project not found')

  const projectPath = joinDropboxPath(rootPath, project.name)
  await ensureDropboxDirectory(client, projectPath)

  const [docs, files] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])

  // D2: sync file filter — excluded files must never be pushed (nor counted).
  const localDocs = Object.fromEntries(
    Object.entries(docs).filter(([p]) => !isSyncExcluded(p))
  )
  const localFilesList = Object.fromEntries(
    Object.entries(files).filter(([p]) => !isSyncExcluded(p))
  )

  // DBX-08: conflict gate — never push a local version over a remote file whose
  // rev changed since the last sync (both sides edited → conflict, recorded,
  // remote NOT clobbered; user resolves via conflict/resolve).
  const isConflictedLocalPush = filePath => {
    const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
    const prevRev = previousRemoteFiles?.[normalized]?.rev
    const currentRev = remoteRemoteFiles?.[normalized]?.rev
    return Boolean(prevRev && currentRev && prevRev !== currentRev)
  }

  let uploadedFiles = 0
  const conflicts = []
  // C1: sha256 of each file's content AS PUSHED, so the state can later tell
  // "local unchanged since last sync" from "local edited".
  const localHashes = {}
  for (const [filePath, doc] of Object.entries(localDocs)) {
    if (isConflictedLocalPush(filePath)) {
      conflicts.push(filePath)
      continue
    }
    const text = doc.lines.join('\n')
    const remotePath = joinDropboxPath(projectPath, filePath)
    await ensureDropboxDirectory(client, remotePath.split('/').slice(0, -1).join('/'))
    await client.upload(remotePath, Buffer.from(text).toString('base64'))
    localHashes[`/${filePath}`] = sha256(text)
    uploadedFiles += 1
  }

  for (const [filePath, file] of Object.entries(localFilesList)) {
    if (isConflictedLocalPush(filePath)) {
      conflicts.push(filePath)
      continue
    }
    const { stream } = await HistoryManager.promises.requestBlobWithProjectId(
      projectId,
      file.hash
    )
    const content = await streamToBuffer(stream)
    const remotePath = joinDropboxPath(projectPath, filePath)
    await ensureDropboxDirectory(client, remotePath.split('/').slice(0, -1).join('/'))
    await client.upload(remotePath, content.toString('base64'))
    localHashes[`/${filePath}`] = sha256(content)
    uploadedFiles += 1
  }

  return { projectPath, projectName: project.name, uploadedFiles, conflicts, localHashes }
}

function isTextFile(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return (Settings.textExtensions || []).includes(extension)
}

function isDropboxNotFound(error) {
  // Typed status first (DropboxClient errors carry the HTTP status); the
  // message fallback keeps compatibility with other error sources.
  if (error?.status === 404) return true
  return /not found/i.test(error?.message || '')
}

/**
 * Per-project sync lock (DBX-04): serializes pull/push/conflict-resolution
 * for a project so concurrent operations cannot tear the state doc or
 * interleave remote list/replace sequences.
 */
const projectSyncLocks = new Map()
async function withProjectSyncLock(projectId, task) {
  const key = projectId.toString()
  const previous = projectSyncLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => {
    release = resolve
  })
  projectSyncLocks.set(key, current)
  try {
    await previous.catch(() => {})
    return await task()
  } finally {
    release()
    if (projectSyncLocks.get(key) === current) projectSyncLocks.delete(key)
  }
}

function normalizeDropboxPathMap(map = {}) {
  // Normalize keys to NO leading slash
  const out = {}
  for (const [path, metadata] of Object.entries(map || {})) {
    out[path.startsWith('/') ? path.slice(1) : path] = metadata
  }
  return out
}

function toRemoteFilesArray(remoteFiles = {}) {
  if (Array.isArray(remoteFiles)) return remoteFiles
  if (remoteFiles instanceof Map) remoteFiles = Object.fromEntries(remoteFiles)
  return Object.entries(remoteFiles).map(([path, metadata]) => ({
    path,
    ...metadata,
  }))
}

/**
 * BUG2 (CRITICAL, user-reported: push skipped ALL remote deletions with
 * "remote identity changed" even though nothing changed on Dropbox):
 * pure planner for guarded deletions. A remote file that was part of a
 * previous sync (stored entry with a rev baseline) and is absent locally is
 * eligible for remote deletion ONLY when the current remote listing shows
 * the SAME rev. Any other case — remote rev changed, unknown/missing rev,
 * or absent from the current listing — goes to `skipped` so the caller
 * records a conflict instead of deleting data the user (or someone else)
 * modified on Dropbox.
 * @param {Array} storedEntries array of {path, rev, ...} from state.remoteFiles
 * @param {Set<string>} localFilePaths currently-existing local files, slash-less
 * @param {Object} currentRemoteMap slashed-normalized current remote listing
 *   (keys slash-less; values {rev, size, modifiedAt})
 * @returns {{ deletions: {path: string}[], skipped: {path: string, remoteRev: string | null}[] }}
 */
export function planRemoteDeletions(storedEntries, localFilePaths, currentRemoteMap) {
  const deletions = []
  const skipped = []
  for (const entry of storedEntries || []) {
    const rel = entry?.path ? normKey(entry.path) : ''
    if (!rel) continue
    if (localFilePaths && localFilePaths.has(rel)) continue // still exists locally
    const currentRev = currentRemoteMap?.[rel]?.rev
    // RF.4 key-shape notes preserved: stored entry paths and listing keys are
    // carried with a leading slash; both sides are normalized here, and the
    // caller MUST pass a listing taken against the PROJECT folder (relative
    // keys) — a root-folder listing would shift every key by the project name
    // and this guard would skip every deletion (the original live bug).
    if (!entry?.rev || !currentRev || currentRev !== entry.rev) {
      skipped.push({ path: rel, remoteRev: currentRev || null })
    } else {
      deletions.push({ path: rel })
    }
  }
  return { deletions, skipped }
}

// H16: update (or create) the remoteFiles entry for a project-relative path,
// matching either key style (with/without leading slash).
function updateRemoteFileEntry(state, relKey, patch) {
  if (!Array.isArray(state.remoteFiles)) state.remoteFiles = []
  let entry = state.remoteFiles.find(
    f => f && normKey(f.path) === normKey(relKey)
  )
  if (!entry) {
    entry = { path: `/${relKey}` }
    state.remoteFiles.push(entry)
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) entry[key] = value
  }
  return entry
}

async function importProjectFromDropbox({
  client,
  projectId,
  userId,
  rootPath,
  legacyRootPath,
  previousRemoteFiles = null,
}) {
  const project = await ProjectGetter.promises.getProject(projectId, { name: true })
  if (!project) throw new Error('Project not found')

  let projectPath = joinDropboxPath(rootPath, project.name)
  let listing
  try {
    listing = await client.list(projectPath, { recursive: true })
  } catch (err) {
    if (!isDropboxNotFound(err)) throw err
    if (legacyRootPath) {
      const legacyProjectPath = joinDropboxPath(legacyRootPath, project.name)
      try {
        projectPath = legacyProjectPath
        listing = await client.list(projectPath, { recursive: true })
      } catch (legacyError) {
        if (!isDropboxNotFound(legacyError)) throw legacyError
        projectPath = joinDropboxPath(rootPath, project.name)
        listing = { entries: [] }
      }
    } else {
      listing = { entries: [] }
    }
  }
  const entries = (listing.entries || []).filter(
    entry => entry.type === 'file' && !isSyncExcluded(relativeDropboxPath(projectPath, entry))
  )
  const remoteFiles = Object.fromEntries(
    entries.map(entry => [
      relativeDropboxPath(projectPath, entry),
      {
        rev: entry.rev,
        size: entry.size,
        modifiedAt: entry.client_modified || entry.server_modified,
        // Carry the previous local-hash forward for unchanged files so the
        // "local edited?" gate keeps working across pulls (C1).
        localHash: previousRemoteFiles?.[relativeDropboxPath(projectPath, entry)]?.localHash,
      },
    ])
  )

  // C1: local-change gate — we need the CURRENT project content to compare
  // against the hashes we stored when that content last entered the project.
  // Text files: sha256 of lines joined (the exact bytes push/pull use);
  // binary files: the filestore hash, which is the sha256 of the blob
  // (content-addressed store).
  const [localDocs, localFilesMap] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])
  const currentLocalHash = relKey => {
    if (localDocs && relKey in localDocs) {
      return sha256((localDocs[relKey]?.lines || []).join('\n'))
    }
    if (localFilesMap && relKey in localFilesMap) {
      return localFilesMap[relKey]?.hash || null
    }
    return null
  }

  let importedFiles = 0
  let skippedUnchanged = 0
  let skippedConflicts = 0
  const conflicts = []
  const temporaryFiles = []

  try {
    for (const entry of entries) {
      const remotePath = entry.relative_path || entry.path_display
      const relativePath = relativeDropboxPath(projectPath, entry)

      // ARC-09: skip files whose rev is unchanged since the last sync —
      // re-upserting every file on every pull destroyed local revisions and
      // caused needless history churn.
      const previous = previousRemoteFiles?.[relativePath]
      if (previous?.rev && entry.rev && previous.rev === entry.rev) {
        skippedUnchanged += 1
        continue
      }

      // C1 (user's #1 data-safety issue): the remote file CHANGED (rev
      // differs). Before applying it, check whether the LOCAL file was edited
      // since it last came from Dropbox. If local is unchanged (or absent) the
      // remote change is the only change → safe to apply. If local was edited
      // too → BOTH sides changed → do NOT apply; record a conflict instead.
      const relKey = normKey(relativePath)
      const storedLocalHash = previous?.localHash || null
      if (storedLocalHash) {
        const currentHash = currentLocalHash(relKey)
        if (currentHash !== null && currentHash !== storedLocalHash) {
          conflicts.push({
            path: relKey,
            remoteRev: entry.rev,
            localHash: currentHash,
            remoteHash: null,
            at: new Date(),
          })
          skippedConflicts += 1
          continue
        }
      }

      const result = await client.download(`/${remotePath}`)
      if (!result?.content_base64) {
        throw new Error(`Dropbox returned no content for ${remotePath}`)
      }
      const content = Buffer.from(result.content_base64, 'base64')

      // C1: hash of the EXACT content about to enter the project (text = utf8
      // bytes, binary = raw bytes) — becomes the new stored localHash.
      const appliedHash = isTextFile(relativePath)
        ? sha256(content.toString('utf8'))
        : sha256(content)

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
      if (remoteFiles[relativePath]) {
        remoteFiles[relativePath] = { ...remoteFiles[relativePath], localHash: appliedHash }
      } else {
        remoteFiles[relativePath] = { path: relativePath, localHash: appliedHash }
      }
    }
  } finally {
    await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true })))
  }

  return { projectPath, importedFiles, skippedUnchanged, skippedConflicts, conflicts, remoteFiles }
}

async function importNewProjectFromDropbox({
  client,
  userId,
  projectName,
  rootPath,
  projectId,
}) {
  const projectPath = joinDropboxPath(rootPath, projectName)
  const listing = await client.list(projectPath, { recursive: true })
  const allEntries = (listing.entries || []).filter(entry => entry.type === 'file')
  // Import-into-EXISTING project (projectId set): same filters + safety gates
  // as pull. Fresh project import (no projectId): filter only.
  const entries = allEntries.filter(
    entry => !isSyncExcluded(relativeDropboxPath(projectPath, entry))
  )
  let localDocs = null
  let localFilesMap = null
  if (projectId) {
    const [docs, files] = await Promise.all([
      ProjectEntityHandler.promises.getAllDocs(projectId),
      ProjectEntityHandler.promises.getAllFiles(projectId),
    ])
    localDocs = docs
    localFilesMap = files
  }
  const currentLocalHash = relKey => {
    if (!localDocs && !localFilesMap) return null
    if (localDocs && relKey in localDocs) {
      return sha256((localDocs[relKey]?.lines || []).join('\n'))
    }
    if (localFilesMap && relKey in localFilesMap) {
      return localFilesMap[relKey]?.hash || null
    }
    return null
  }
  const conflicts = []
  let skippedConflicts = 0
  let importedFiles = 0
  for (const entry of entries) {
    const relativePath = relativeDropboxPath(projectPath, entry)
    const remotePath = entry.relative_path || entry.path_display
    if (projectId) {
      // C1 gate: never import a changed remote file over a locally edited one.
      const relKey = normKey(relativePath)
      const currentHash = currentLocalHash(relKey)
      if (currentHash !== null) {
        // There is local content; without a stored baseline (first import into
        // an existing project) treat as conflict rather than clobber.
        conflicts.push({
          path: relKey,
          remoteRev: entry.rev,
          localHash: currentHash,
          remoteHash: null,
          at: new Date(),
        })
        skippedConflicts += 1
        continue
      }
    }
    const result = await client.download(`/${remotePath}`)
    if (!result?.content_base64) {
      throw new Error(`Dropbox returned no content for ${remotePath}`)
    }
    const content = Buffer.from(result.content_base64, 'base64')
    // DBX-13: keep the SAME text-vs-binary classification as the
    // link/pull flows (upsertDoc for text, upsertFile for binary).
    if (projectId && isTextFile(relativePath)) {
      await EditorController.promises.upsertDocWithPath(
        projectId,
        relativePath,
        content.toString('utf8').split('\n'),
        'dropbox',
        userId
      )
    } else if (projectId) {
      const temporaryFile = path.join(
        os.tmpdir(),
        `overleaf-dropbox-import-${Date.now()}-${importedFiles}`
      )
      await fs.writeFile(temporaryFile, content)
      await EditorController.promises.upsertFileWithPath(
        projectId,
        relativePath,
        temporaryFile,
        null,
        'dropbox',
        userId
      )
      await fs.rm(temporaryFile, { force: true })
    } else {
      await TpdsUpdateHandler.promises.newUpdate(
        userId,
        null,
        projectName,
        relativePath,
        Readable.from([Buffer.from(result.content_base64, 'base64')]),
        'dropbox'
      )
    }
    importedFiles += 1
  }
  return { importedFiles, conflicts, skippedConflicts }
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

/**
 * Express router for Dropbox-related API endpoints.
 */
export { normalizeDropboxPath }
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

          const path = normalizeDropboxPath(credentials.path)
          if (credentials.path !== path) {
            credentials.path = path
            await credentials.save()
          }

          // Include last-sync info for linked project state(s)
          const projects = await DropboxSyncProjectStates.find(
            { path, connected: true },
            {
              projectId: 1,
              lastSyncAt: 1,
              lastSyncError: 1,
              path: 1,
              projectName: 1,
              projectPath: 1,
            }
          ).lean()

          return res.json({
            connected: true,
            path,
            // U3: per-project entries with the full project-level path.
            projects: projects.map(p => ({
              projectId: p.projectId,
              path: p.path,
              projectName: p.projectName || null,
              projectPath: p.projectPath || null,
              lastSyncAt: p.lastSyncAt,
              lastSyncError: p.lastSyncError,
            })),
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
            logger.warn({}, 'Dropbox token does not start with sl. - may be invalid')
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
          // First unlink all projects associated with this user's Dropbox account
          const credentials = await DropboxUserCredentials.findOne({ userId })
          let pathToUnlink = '/'
          if (credentials) {
            pathToUnlink = normalizeDropboxPath(credentials.path)
            // H6: scope the delete to the ACTING user. The state docs carry
            // `ownerId` (the linking user, always set at link time); a legacy
            // doc without it is left in place (safe direction: never delete
            // another user's link just because paths happen to match).
            await DropboxSyncProjectStates.deleteMany({ path: pathToUnlink, ownerId: userId })
          }
          
          // Then delete the user's credentials
          await DropboxUserCredentials.deleteOne({ userId })
          res.json({ success: true, unlinkedProjects: pathToUnlink })
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
            // DBX-14: normalize in memory only (no write-on-read)
            state.path = normalizeDropboxPath(state.path)
            // Project files live under <state.path>/<project name> (same join
            // rule as push/pull/import) — expose that full path for display.
            // BUG1 (round 2): the display path must be the FULL Dropbox path
            // e.g. "Apps/Overleaf Dev/A5 test". The owner's active credentials
            // doc often has no `path` (OAuth link didn't store one); the legacy
            // collection may. The app sandbox folder ("Apps/<App name>") is not
            // visible via the API, so fall back to the fork's app-folder name.
            try {
              const owner = state.ownerId || userId
              let project = null
              try {
                project = await ProjectGetter.promises.getProject(projectId, { name: true })
              } catch {
                project = null // display-only — fall back to state.path
              }
              const projName = project?.name
              const activeDoc = await DropboxUserCredentials.findOne(
                { userId: owner },
                { path: 1 }
              ).lean().catch(() => null)
              let legacyDoc = null
              try {
                legacyDoc = await DropboxUserCredentials.collection.db
                  .collection('dropboxusercredentials')
                  .findOne({ userId: owner }, { projection: { _id: 0, path: 1 } })
              } catch {
                legacyDoc = null
              }
              const rootPath = resolveDisplayRoot(activeDoc?.path, legacyDoc?.path)
              const displayTarget =
                state.path && state.path !== '/'
                  ? state.path
                  : projName
                    ? joinDropboxPath(state.path, projName)
                    : null
              state.projectPath = projName
                ? joinDropboxPath(state.path, projName)
                : state.path
              state.fullPath = joinDisplayPath(rootPath, displayTarget)
            } catch {
              // display-only fields — modal falls back to projectPath/path
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
      ensureUserCanWriteProjectContent,
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

          // Save project state (upsert: exactly ONE state doc per project;
          // ownerId scopes unlink/user-expire cleanup to the linking user)
          // H5: remember whether this request CREATED the doc so a failed
          // initial push can roll it back (no orphan "linked" state).
          const statePreExisted = Boolean(
            await DropboxSyncProjectStates.findOne({ projectId }).lean()
          )
          const state = await DropboxSyncProjectStates.findOneAndUpdate(
            { projectId },
            {
              $set: { connected: true, path: dropboxPath, ownerId: userId },
              $setOnInsert: { mergeStatus: 'clean' },
            },
            { upsert: true, new: true }
          )

          try {
            const syncResult = await uploadProjectToDropbox({
              client,
              projectId,
              rootPath: dropboxPath,
            })
            const remoteFiles = await getDropboxRemoteFiles(client, syncResult.projectPath)
            // C1: persist the sha256 of each file as pushed (keyed with a
            // leading slash, same key style as getDropboxRemoteFiles).
            for (const [hashPath, hashValue] of Object.entries(syncResult.localHashes || {})) {
              if (remoteFiles[hashPath]) {
                remoteFiles[hashPath] = { ...remoteFiles[hashPath], localHash: hashValue }
              }
            }
            state.lastSyncAt = new Date()
            state.lastSyncError = undefined
            state.remoteFiles = toRemoteFilesArray(remoteFiles)
            // U3: store the full project-level path for display without a
            // project fetch on every state read.
            state.projectName = syncResult.projectName
            state.projectPath = syncResult.projectPath
            await state.save()

            res.json({ success: true, path: state.path, ...syncResult })
          } catch (linkErr) {
            // H5/RF.6: ANY failure in the post-upsert window (failed push, failed
            // re-listing, failed state save) must not leave behind a
            // "linked" state doc created by THIS request (and only this request).
            if (!statePreExisted) {
              await DropboxSyncProjectStates.deleteOne({ projectId, ownerId: userId })
            }
            throw linkErr
          }
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
      ensureUserCanWriteProjectContent,
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
          return await withProjectSyncLock(projectId, async () => {
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
          // DBX-14: don't write on read — just use the normalized local copy
          // (state docs are normalized at creation time)
          state.path = dropboxPath
          let importResult
          try {
            importResult = await importProjectFromDropbox({
              client,
              projectId,
              userId,
              rootPath: dropboxPath,
              legacyRootPath: LEGACY_DROPBOX_PATH,
              previousRemoteFiles: Object.fromEntries(
                (state.remoteFiles || []).map(file => [file.path, file])
              ),
            })
          } catch (err) {
            if (!isDropboxNotFound(err)) throw err
            // ARC-06: a missing remote folder is NOT confirmation that the
            // Overleaf project should be deleted (it may be a wrong path,
            // a revoked token or an incomplete listing). Unlink the state,
            // report the issue, and let the user decide.
            await state.updateOne({
              connected: false,
              remoteFiles: [],
              lastSyncAt: new Date(),
              lastSyncError: 'Remote project folder not found (pull aborted; project NOT deleted)',
            })
            return res.json({
              success: false,
              message: 'Remote project folder not found. The project was NOT deleted; check the Dropbox path or re-link.',
              remoteMissing: true,
            })
          }

          // Note: reconciliation of deletions is intentionally skipped for pull operations.
          // Pull should only ADD/UPDATE files from Dropbox, not delete local files.
          // Deletion reconciliation happens in push operations instead.
          // C1: record pull-side conflicts (both sides changed → remote NOT
          // applied to those files).
          const pullConflicts = importResult.conflicts || []
          await state.updateOne({
            remoteFiles: toRemoteFilesArray(importResult.remoteFiles),
            lastSyncAt: new Date(),
            mergeStatus: pullConflicts.length ? 'conflict' : 'clean',
            lastConflict: pullConflicts.length
              ? {
                  path: pullConflicts[0].path,
                  localVersion: pullConflicts[0].localHash || 'local HEAD',
                  localHash: pullConflicts[0].localHash || null,
                  remoteRev: pullConflicts[0].remoteRev || null,
                  timestamp: new Date(),
                }
              : null,
            conflicts: pullConflicts,
            lastSyncError: pullConflicts.length
              ? `${pullConflicts.length} file(s) changed on both sides (first: ${pullConflicts[0].path}); remote version NOT imported`
              : null,
          })

          res.json({
            success: true,
            message: pullConflicts.length
              ? `Pull completed with ${pullConflicts.length} conflict(s) (conflicting files NOT imported)`
              : 'Pull completed',
            conflictCount: pullConflicts.length,
            conflicts: pullConflicts,
            skippedFiles: importResult.skippedConflicts || 0,
            ...importResult,
          })
          })
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
          return await withProjectSyncLock(projectId, async () => {
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
          // DBX-14: don't write on read — just use the normalized local copy
          // (state docs are normalized at creation time)
          state.path = dropboxPath
          // Snapshot remote state BEFORE push (for guarded deletion + conflict
          // gate).
          // BUG2 fix: the snapshot MUST be taken against the PROJECT folder
          // (<root>/<project name>), because state.remoteFiles, the C1 gate
          // and the deletion guard all use PROJECT-RELATIVE keys. The old
          // code listed the ROOT directory, so every key was shifted by the
          // project name ('A5 test/main.tex'), every guard lookup missed,
          // and push reported "remote identity changed" for every file
          // (skipping all deletions) while simultaneously disabling the
          // remote-changed push gate.
          const project = await ProjectGetter.promises.getProject(projectId, { name: true })
          if (!project) throw new Error('Project not found')
          const prePushProjectPath = joinDropboxPath(dropboxPath, project.name)
          let remoteBeforePush = {}
          try {
            remoteBeforePush = await getDropboxRemoteFiles(client, prePushProjectPath)
          } catch (err) {
            // Remote folder missing (deleted since last sync, or never
            // created yet): nothing to reconcile against. Treat as empty —
            // safe direction: the guard below deletes nothing and records
            // conflicts instead. Uploads below still create the folder.
            if (!isDropboxNotFound(err)) throw err
            logger.warn(
              { projectId, projectPath: prePushProjectPath },
              'push: pre-push remote project folder not found; snapshotting as empty'
            )
          }
          const previousRemoteMap = normalizeDropboxPathMap(
            Object.fromEntries(
              toRemoteFilesArray(state.remoteFiles)
                .filter(f => f && f.path)
                .map(f => [f.path, f])
            )
          )
          const remoteRemoteMap = normalizeDropboxPathMap(remoteBeforePush)

          const syncResult = await uploadProjectToDropbox({
            client,
            projectId,
            rootPath: dropboxPath,
            previousRemoteFiles: previousRemoteMap,
            remoteRemoteFiles: remoteRemoteMap,
          })
          const remoteFiles = await getDropboxRemoteFiles(client, syncResult.projectPath)
          // C1: persist the sha256 of each file as pushed (the baseline the
          // pull-side "local edited?" gate compares against).
          for (const [hashPath, hashValue] of Object.entries(syncResult.localHashes || {})) {
            if (remoteFiles[hashPath]) {
              remoteFiles[hashPath] = { ...remoteFiles[hashPath], localHash: hashValue }
            }
          }

          // Guarded deletion reconciliation (safety rule: a partial/changed remote
          // listing must never drive blind deletions). Only delete a remote file when ALL hold:
          //   1. it was part of a PREVIOUS sync (state.remoteFiles),
          //   2. it no longer exists locally,
          //   3. its remote identity (rev) is unchanged since that previous sync.
          // If the remote changed (or identity is unknown), skip deletion and record conflict.
          const localEntities = await ProjectEntityHandler.promises.getAllEntities(projectId)
          // RF.4: entity paths carry a leading slash ('/main.tex'); the
          // reconciliation loop compares against slash-less relative keys,
          // so normalize the local set to the same key style (the old
          // mixed-style `has()` check never matched and defeated this guard).
          const localFilePaths = new Set([
            ...Object.keys(localEntities.docs || {}),
            ...Object.keys(localEntities.files || {}),
          ].map(p => (p && p.startsWith('/') ? p.slice(1) : p)))

          let deletedFromRemote = 0
          const skippedDeletions = []
          const skippedDeletionConflicts = []
          const previousEntries = toRemoteFilesArray(state.remoteFiles).filter(f => f && f.path)
          // BUG2: pure planner — delete ONLY when the current remote rev
          // equals the stored baseline; everything else is recorded as a
          // conflict instead of being deleted.
          const deletionPlan = planRemoteDeletions(previousEntries, localFilePaths, remoteRemoteMap)
          for (const plan of deletionPlan.deletions) {
            const remotePath = joinDropboxPath(syncResult.projectPath, plan.path)
            try {
              await client.delete(remotePath)
              deletedFromRemote += 1
              logger.debug({ projectId, filePath: plan.path }, 'deleted from Dropbox during push')
            } catch (err) {
              if (!isDropboxNotFound(err)) {
                logger.warn({ err, projectId, filePath: plan.path }, 'failed to delete file from Dropbox during push')
              }
            }
          }
          for (const plan of deletionPlan.skipped) {
            skippedDeletions.push(plan.path)
            // Record the skipped deletion as a resolvable conflict: entry.rev
            // is updated when the user resolves (keep-local unblocks the
            // deletion on the next push; keep-remote re-imports the file).
            skippedDeletionConflicts.push({
              path: plan.path,
              remoteRev: plan.remoteRev || null,
              localHash: null,
              remoteHash: null,
              at: new Date(),
            })
          }
          if (skippedDeletions.length) {
            logger.warn({ projectId, skippedDeletions }, 'push: skipped remote deletions; remote identity changed since last sync (conflicts recorded)')
          }

          const pushConflicts = syncResult.conflicts || []
          // The push result OWNS the conflicts array going forward: content
          // conflicts + guarded-deletion skips together; clean runs clear it.
          const allConflicts = [...pushConflicts, ...skippedDeletionConflicts]
          if (allConflicts.length) {
            const firstConflict = allConflicts[0]
            const firstRel = normKey(firstConflict.path)
            await state.updateOne({
              remoteFiles: toRemoteFilesArray(remoteFiles),
              lastSyncAt: new Date(),
              mergeStatus: 'conflict',
              lastConflict: {
                path: firstConflict.path,
                localVersion: 'local HEAD',
                localHash: null,
                remoteRev: firstConflict.remoteRev || remoteRemoteMap[firstRel]?.rev || null,
                timestamp: new Date(),
              },
              lastSyncError: `${allConflicts.length} conflict(s) (first: ${firstConflict.path}); changed files NOT pushed/NOT deleted`,
              conflicts: allConflicts,
            })
          } else {
            await state.updateOne({
              remoteFiles: toRemoteFilesArray(remoteFiles),
              lastSyncAt: new Date(),
              mergeStatus: 'clean',
              lastConflict: null,
              lastSyncError: null,
              conflicts: [],
            })
          }

          res.json({
            ...syncResult,
            success: true,
            // Explicit keys AFTER the spread: syncResult.conflicts only covers
            // upload-side conflicts; the response must report ALL recorded
            // conflicts (upload + guarded-deletion skips).
            message: allConflicts.length
              ? `Push completed with ${allConflicts.length} conflict(s) (conflicting files NOT pushed/NOT deleted)`
              : 'Push completed',
            deletedFiles: deletedFromRemote,
            skippedDeletions,
            conflictCount: allConflicts.length,
            conflicts: allConflicts,
          })
          })
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
          // DBX-14: don't write on read — just use the normalized local copy
          // (state docs are normalized at creation time)
          state.path = dropboxPath
          const result = await client.list(dropboxPath)

          res.json({
            path: dropboxPath,
            entries: (result.entries || []).filter(
              entry => entry.type !== 'file' || !isSyncExcluded(
                relativeDropboxPath(dropboxPath, entry)
              )
            ),
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
        const { choice, filePath } = req.body || {}

        if (!['keep-local', 'keep-remote'].includes(choice)) {
          return res.status(400).json({
            error: 'choice must be "keep-local" or "keep-remote"',
          })
        }

        try {
          return await withProjectSyncLock(projectId, async () => {
          const state = await DropboxSyncProjectStates.findOne({
            projectId,
          })
          if (!state || !state.connected) {
            return res.status(409).json({ error: 'Project not linked to Dropbox' })
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

          // keep-local: the local Overleaf content already wins. H16 (and C1
          // consistency): record the LOCAL content hash as the new baseline and
          // the remote rev as "seen", so the ARC-09 gate treats it as synced
          // and the NEXT PUSH carries the local version out to Dropbox. Then
          // remove this path from the recorded conflicts (keep others).
          if (choice === 'keep-local') {
            const targetPath = filePath || state.lastConflict?.path || (state.conflicts || [])[0]?.path
            if (targetPath) {
              const relKey = normKey(targetPath)
              let localHash = null
              try {
                if (isTextFile(relKey)) {
                  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
                  if (docs && relKey in docs) {
                    localHash = sha256((docs[relKey].lines || []).join('\n'))
                  }
                } else {
                  const files = await ProjectEntityHandler.promises.getAllFiles(projectId)
                  localHash = files?.[relKey]?.hash || null
                }
              } catch {
                localHash = null
              }
              const conflictEntry = (state.conflicts || []).find(c => normKey(c.path) === relKey)
              const remoteRev = conflictEntry?.remoteRev || state.lastConflict?.remoteRev || null
              updateRemoteFileEntry(state, relKey, {
                localHash: localHash ?? undefined,
                rev: remoteRev ?? undefined,
              })
            }
            const remainingConflicts = ((state.conflicts || [])).filter(
              c => !targetPath || normKey(c.path) !== normKey(targetPath)
            )
            await state.updateOne({
              mergeStatus: 'clean',
              lastConflict: null,
              lastSyncError: null,
              lastSyncAt: new Date(),
              conflicts: remainingConflicts,
              remoteFiles: toRemoteFilesArray(state.remoteFiles),
            })
            logger.info({ projectId, filePath }, 'conflict resolved: keep-local')
            return res.json({
              success: true,
              message: 'Conflict resolved - keeping local version',
              conflicts: remainingConflicts,
              note: 'The local version wins; push to publish it to Dropbox.',
            })
          }

          // keep-remote: force-apply the Dropbox version for the named file
          // (bypassing the C1 gate by construction: this route IS the
          // resolution), then H16 bookkeeping — refresh the rev, store the sha256
          // of what we wrote as the new localHash baseline, and drop the path
          // from the recorded conflicts.
          const client = new DropboxClient({ accessToken })
          const dropboxPath = normalizeDropboxPath(state.path)
          const targetPath = filePath || state.lastConflict?.path || (state.conflicts || [])[0]?.path

          let appliedPath = null
          let appliedHash = null
          let latestRev = null
          let remoteFilesAfter = null
          if (filePath) {
            const projectDoc = await ProjectGetter.promises.getProject(projectId, { name: true })
            const cleanFilePath = filePath.startsWith('/') ? filePath.slice(1) : filePath
            const remoteFullPath = joinDropboxPath(
              dropboxPath,
              projectDoc?.name || '',
              cleanFilePath
            )
            let result
            try {
              result = await client.download(remoteFullPath)
            } catch (err) {
              if (!isDropboxNotFound(err)) throw err
              return res.status(404).json({ error: `Remote file not found: ${filePath}` })
            }
            const content = Buffer.from(result?.content_base64 || '', 'base64')
            appliedHash = isTextFile(cleanFilePath) ? sha256(content.toString('utf8')) : sha256(content)
            if (isTextFile(cleanFilePath)) {
              await EditorController.promises.upsertDocWithPath(
                projectId,
                cleanFilePath,
                content.toString('utf8').split('\n'),
                'dropbox',
                userId
              )
            } else {
              const temporaryFile = path.join(
                os.tmpdir(),
                `overleaf-dropbox-resolve-${Date.now()}`
              )
              await fs.writeFile(temporaryFile, content)
              await EditorController.promises.upsertFileWithPath(
                projectId,
                cleanFilePath,
                temporaryFile,
                null,
                'dropbox',
                userId
              )
              await fs.rm(temporaryFile, { force: true })
            }
            appliedPath = cleanFilePath
            // H16: refresh the entry (rev from the latest remote listing of
            // the PROJECT folder + localHash of what we just wrote).
            const projectFolder = joinDropboxPath(dropboxPath, projectDoc?.name || '')
            let latestMap = null
            try {
              latestMap = await getDropboxRemoteFiles(client, projectFolder)
            } catch {
              latestMap = null
            }
            latestRev =
              latestMap?.[cleanFilePath]?.rev || latestMap?.[`/${cleanFilePath}`]?.rev || null
          } else {
            const importResult = await importProjectFromDropbox({
              client,
              projectId,
              userId,
              rootPath: dropboxPath,
              legacyRootPath: LEGACY_DROPBOX_PATH,
              previousRemoteFiles: {},
            })
            remoteFilesAfter = importResult.remoteFiles
            if (targetPath) {
              const relKey = normKey(targetPath)
              latestRev = importResult.remoteFiles?.[`/${relKey}`]?.rev || importResult.remoteFiles?.[relKey]?.rev || null
              appliedHash = importResult.remoteFiles?.[`/${relKey}`]?.localHash || importResult.remoteFiles?.[relKey]?.localHash || null
            }
          }

          if (targetPath) {
            updateRemoteFileEntry(state, normKey(targetPath), {
              localHash: appliedHash ?? undefined,
              rev: latestRev ?? undefined,
            })
          }

          const remainingConflicts = ((state.conflicts || [])).filter(
            c => !targetPath || normKey(c.path) !== normKey(targetPath)
          )

          await state.updateOne({
            mergeStatus: 'clean',
            lastConflict: null,
            lastSyncError: null,
            lastSyncAt: new Date(),
            conflicts: remainingConflicts,
            remoteFiles: toRemoteFilesArray(remoteFilesAfter || state.remoteFiles),
          })

          logger.info({ projectId, filePath, choice }, 'conflict resolved: keep-remote')
          res.json({
            success: true,
            message: `Conflict resolved - keeping Dropbox version${appliedPath ? ` (file: ${appliedPath})` : ' (whole project)'}`,
            conflicts: remainingConflicts,
          })
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
