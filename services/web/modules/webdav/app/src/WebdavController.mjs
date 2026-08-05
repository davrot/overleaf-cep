import { expressify } from '@overleaf/promise-utils'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import WebdavClient from './WebdavClient.mjs'
import WebdavSync from './WebdavSync.mjs'

function userId(req) {
  return SessionManager.getLoggedInUserId(req.session)
}

async function connect(req, res) {
  const credentials = {
    baseUrl: req.body.baseUrl,
    username: req.body.username,
    password: req.body.password,
    rootPath: req.body.rootPath || Settings.webdav.rootPath,
  }
  const client = new WebdavClient(credentials)
  await client.check()
  const currentUserId = userId(req)
  await WebdavCredentials.save(currentUserId, credentials)
  await WebdavSync.pollUser(currentUserId)
  await WebdavSync.syncAllProjectsForUser(currentUserId, { force: true })
  res.sendStatus(204)
}

async function status(req, res) {
  const credentials = await WebdavCredentials.get(userId(req))
  if (!credentials) return res.json({ connected: false })
  try {
    await new WebdavClient(credentials).check()
    return res.json({
      connected: true,
      baseUrl: credentials.baseUrl,
      rootPath: credentials.rootPath,
      lastSyncAt: credentials.lastSyncAt || null,
      lastSyncError: credentials.lastSyncError || null,
      lastConflict: credentials.lastConflict || null,
    })
  } catch {
    return res.json({ connected: false, error: true })
  }
}

async function disconnect(req, res) {
  await WebdavCredentials.remove(userId(req))
  res.sendStatus(204)
}

async function syncProject(req, res) {
  await WebdavSync.syncProject(userId(req), req.params.project_id)
  res.sendStatus(204)
}

async function resolveConflict(req, res) {
  await WebdavSync.resolveConflict(
    userId(req),
    req.params.project_id,
    req.body.path,
    req.body.resolution
  )
  res.sendStatus(204)
}

async function poll(req, res) {
  const currentUserId = userId(req)
  await WebdavSync.pollUser(currentUserId)
  await WebdavSync.syncAllProjectsForUser(currentUserId)
  res.sendStatus(204)
}

export default {
  connect: expressify(connect),
  status: expressify(status),
  disconnect: expressify(disconnect),
  syncProject: expressify(syncProject),
  resolveConflict: expressify(resolveConflict),
  poll: expressify(poll),
  authentication: AuthenticationController.requireLogin(),
}