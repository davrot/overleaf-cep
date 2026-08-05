import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { Readable } from 'node:stream'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
import NotificationsBuilder from '../../../../app/src/Features/Notifications/NotificationsBuilder.mjs'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import WebdavClient from './WebdavClient.mjs'
import { remotePath } from './WebdavPaths.mjs'
import SyncQueue from '../../../../app/src/infrastructure/SyncQueue.mjs'
import crypto from 'node:crypto'

const projectSyncQueues = new Map()
const recentlyInboundProjects = new Map()
const LEASE_MS = 60_000
const LOCK_DIRECTORY = '/.sync-locks'

function lockPath(rootPath, projectKey) {
  return `${LOCK_DIRECTORY}/${encodeURIComponent(String(projectKey))}.json`
}

async function lockEtag(client, directoryPath, path) {
  const entries = await client.list(directoryPath)
  return entries.find(entry => entry.path === path)?.etag
}

async function acquireLease(client, rootPath, projectKey) {
  const directoryPath = remotePath(rootPath, LOCK_DIRECTORY)
  await client.createDirectory(directoryPath)
    .catch(error => { if (error.status !== 405) throw error })
  const token = crypto.randomUUID()
  const lease = {
    projectKey: String(projectKey),
    token,
    expiresAt: Date.now() + LEASE_MS,
  }
  const path = remotePath(rootPath, '', lockPath('', projectKey))
  let etag
  try {
    await client.put(path, JSON.stringify(lease), {
      headers: { 'if-none-match': '*' },
    })
  } catch (error) {
    if (error.status !== 412) throw error
    let current
    try { current = JSON.parse(Buffer.from(await client.get(path)).toString()) } catch { }
    if (current?.expiresAt > Date.now()) return null
    etag = await lockEtag(client, directoryPath, path)
    if (!etag) return null
    try {
      await client.put(path, JSON.stringify(lease), { etag })
    } catch (takeoverError) {
      if (takeoverError.status === 412) return null
      throw takeoverError
    }
  }
  etag = await lockEtag(client, directoryPath, path)
  const refresh = async () => {
    if (!etag) return
    const currentEtag = await lockEtag(client, directoryPath, path)
    if (!currentEtag) return
    lease.expiresAt = Date.now() + LEASE_MS
    await client.put(path, JSON.stringify(lease), { etag: currentEtag })
    etag = await lockEtag(client, directoryPath, path)
  }
  const refreshTimer = setInterval(() => {
    refresh().catch(() => { })
  }, LEASE_MS / 3)
  return async () => {
    clearInterval(refreshTimer)
    try {
      const current = JSON.parse(Buffer.from(await client.get(path)).toString())
      if (current.token === token) {
        const currentEtag = etag || await lockEtag(client, directoryPath, path)
        if (currentEtag) await client.remove(path, { etag: currentEtag })
      }
    } catch { }
  }
}

function syncProjectQueued(userId, projectId, options = {}) {
  const key = `${userId.toString()}:${projectId.toString()}`
  const previous = projectSyncQueues.get(key) || Promise.resolve()
  const next = previous
    .catch(() => { })
    .then(() => syncProject(userId, projectId, options))
  projectSyncQueues.set(key, next)
  return next.finally(() => {
    if (projectSyncQueues.get(key) === next) projectSyncQueues.delete(key)
  })
}

async function notifyWebdav(userId, event, details) {
  try {
    await NotificationsBuilder.promises.webdavSync(userId).create(event, details)
  } catch (error) {
    logger.warn({ err: error, userId, event }, 'failed to create WebDAV notification')
  }
}

function inboundProjectKey(userId, projectId) {
  return `${userId.toString()}:${projectId.toString()}`
}

function markInboundProject(userId, projectId) {
  recentlyInboundProjects.set(inboundProjectKey(userId, projectId), Date.now() + 10_000)
}

function isRecentlyInbound(userId, projectId) {
  const key = inboundProjectKey(userId, projectId)
  const inboundUntil = recentlyInboundProjects.get(key)
  if (!inboundUntil) return false
  if (inboundUntil > Date.now()) return true
  recentlyInboundProjects.delete(key)
  return false
}

function normalizeProjectFilePath(filePath) {
  return String(filePath || '').replace(/^\/+/, '')
}

function putProjectFile(client, resourcePath, body, filePath, options) {
  return client.put(resourcePath, body, options).catch(error => {
    if (error.status === 412) {
      return client
        .get(resourcePath)
        .then(remoteBody => {
          const localBody = Buffer.from(body)
          if (Buffer.from(remoteBody).equals(localBody)) return 204
          error.projectPath = filePath
          throw error
        })
        .catch(() => {
          error.projectPath = filePath
          throw error
        })
    }
    error.projectPath = filePath
    throw error
  })
}

async function ensureDirectories(client, rootPath, projectName, folders) {
  await client.createDirectory(remotePath(rootPath, projectName))
  const nestedFolders = folders
    .filter(folder => folder.path !== '/')
    .sort((left, right) => {
      const lengthDifference = left.path.length - right.path.length
      return lengthDifference || left.path.localeCompare(right.path)
    })
  for (const folder of nestedFolders) {
    await client.createDirectory(remotePath(rootPath, projectName, folder.path))
  }
}

function getRequiredFolders(paths) {
  const requiredFolders = new Set(['/'])
  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean)
    parts.pop()
    let currentPath = ''
    for (const part of parts) {
      currentPath += `/${part}`
      requiredFolders.add(currentPath)
    }
  }
  return [...requiredFolders].map(path => ({ path }))
}

async function collectEntries(client, resourcePath) {
  const files = []
  const directories = []
  const entries = await client.list(resourcePath)
  for (const entry of entries) {
    if (entry.path === resourcePath || entry.path.endsWith(`${resourcePath}/`)) continue
    if (entry.isDirectory) {
      directories.push(entry)
      const nested = await collectEntries(client, entry.path)
      files.push(...nested.files)
      directories.push(...nested.directories)
    } else {
      files.push(entry)
    }
  }
  return { files, directories }
}

async function getFileBody(project, file) {
  const historyId = project.overleaf?.history?.id
  if (!historyId) throw new Error('project has no history id')
  const response = await fetch(
    `${Settings.apis.project_history.url}/project/${historyId}/blob/${file.hash}`
  )
  if (!response.ok) throw new Error(`failed to fetch project file: ${response.status}`)
  return response.arrayBuffer()
}

async function syncProject(userId, projectId, { force = false } = {}) {
  const startedAt = Date.now()
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) throw new Error('WebDAV is not connected')
  const hadSyncIssue = Boolean(
    credentials.lastSyncError || credentials.lastConflict
  )
  const project = await ProjectGetter.promises.getProject(projectId, {
    name: 1,
    overleaf: 1,
  })
  if (!project) throw new Error('project not found')

  const client = new WebdavClient(credentials)
  const rootPath = credentials.rootPath || Settings.webdav.rootPath
  let releaseLease
  for (let attempt = 0; attempt < 12 && !releaseLease; attempt++) {
    releaseLease = await acquireLease(client, rootPath, projectId)
    if (!releaseLease) {
      logger.info(
        { userId, projectId, attempt: attempt + 1 },
        'WebDAV project lease is busy; waiting before retry'
      )
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  if (!releaseLease) {
    const error = new Error('WebDAV project lease is busy')
    error.code = 'WEBDAV_LEASE_BUSY'
    throw error
  }
  try {
    logger.info(
      { userId, projectId, projectName: project.name, rootPath, force },
      'WebDAV project sync started'
    )
    await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
    const [{ docs, files }, entities] = await Promise.all([
      Promise.all([
        ProjectEntityHandler.promises.getAllDocs(projectId),
        ProjectEntityHandler.promises.getAllFiles(projectId),
      ]).then(([docs, files]) => ({ docs, files })),
      ProjectEntityHandler.promises.getAllEntities(projectId),
    ])

    const projectRoot = remotePath(rootPath, project.name)
    const normalizedWebdavRoot = `/${rootPath || ''}`
      .replace(/\/+/g, '/')
      .replace(/\/$/, '')
    if (projectRoot.replace(/\/$/, '') === normalizedWebdavRoot) {
      throw new Error(`refusing to sync project at WebDAV root: ${project.name}`)
    }
    const requiredFolders = getRequiredFolders([
      ...Object.keys(docs),
      ...Object.keys(files),
    ])
    await ensureDirectories(
      client,
      rootPath,
      project.name,
      [...entities.folders, ...requiredFolders]
    )
    const localPaths = new Set([
      ...Object.keys(docs),
      ...Object.keys(files),
    ])
    const localInventoryIsEmpty = localPaths.size === 0
    const existingRemote = await collectEntries(
      client,
      projectRoot
    )
    const previousRemoteByPath = new Map(
      Object.entries(credentials.remoteState?.[project.name] || {}).map(
        ([filePath, state]) => [remotePath(rootPath, project.name, filePath), state]
      )
    )
    const hasPreviousRemoteState = previousRemoteByPath.size > 0
    if (!localInventoryIsEmpty) {
      for (const entry of existingRemote.files) {
        const relativePath = entry.path.slice(projectRoot.length) || '/'
        if (!localPaths.has(relativePath)) {
          const previous = previousRemoteByPath.get(entry.path)
          if (!hasPreviousRemoteState || !previous) continue
          if (previous?.etag && entry.etag && previous.etag !== entry.etag) {
            const error = new Error(
              `remote WebDAV file changed before local deletion: ${relativePath}`
            )
            error.status = 412
            error.projectPath = relativePath
            throw error
          }
          await client.remove(entry.path)
        }
      }
      for (const directory of existingRemote.directories.sort(
        (left, right) => right.path.length - left.path.length
      )) {
        const relativePath = directory.path.slice(projectRoot.length) || '/'
        const localDirectory = entities.folders.some(folder => folder.path === relativePath)
        if (!localDirectory && hasPreviousRemoteState) {
          const containsTrackedFile = [...previousRemoteByPath.keys()].some(
            path => path.startsWith(`${directory.path}/`)
          )
          if (containsTrackedFile) await client.remove(directory.path)
        }
      }
    }
    for (const [filePath, doc] of Object.entries(docs)) {
      const resourcePath = remotePath(rootPath, project.name, filePath)
      await putProjectFile(client, resourcePath, doc.lines.join('\n'), filePath, {
        etag: force ? undefined : previousRemoteByPath.get(resourcePath)?.etag,
      })
    }
    for (const [filePath, file] of Object.entries(files)) {
      const resourcePath = remotePath(rootPath, project.name, filePath)
      await putProjectFile(
        client,
        resourcePath,
        await getFileBody(project, file),
        filePath,
        { etag: force ? undefined : previousRemoteByPath.get(resourcePath)?.etag }
      )
    }
    const syncedRemote = await collectEntries(client, projectRoot)
    await WebdavCredentials.updateRemoteState(
      userId,
      project.name,
      Object.fromEntries(
        syncedRemote.files.map(entry => [
          entry.path.slice(projectRoot.length) || '/',
          {
            ...(credentials.remoteState?.[project.name]?.[
              entry.path.slice(projectRoot.length) || '/'
            ] || {}),
            etag: entry.etag,
            modifiedAt: entry.modifiedAt,
            size: entry.size,
          },
        ])
      )
    )
    await WebdavCredentials.updateSyncStatus(userId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
      lastConflict: null,
    })
    if (hadSyncIssue) {
      await notifyWebdav(userId, 'recovered', { projectName: project.name, projectId })
    }
    await WebdavCredentials.markProjectSynced(userId, project.name)
    logger.info(
      {
        userId,
        projectId,
        projectName: project.name,
        localDocCount: Object.keys(docs).length,
        localFileCount: Object.keys(files).length,
        localFolderCount: entities.folders.length,
        remoteFileCount: existingRemote.files.length,
        remoteDirectoryCount: existingRemote.directories.length,
        durationMs: Date.now() - startedAt,
      },
      'WebDAV project sync completed'
    )
  } finally {
    await releaseLease()
  }
}

async function resolveConflict(userId, projectId, filePath, resolution) {
  if (!['keep-local', 'keep-remote'].includes(resolution)) {
    throw new Error('invalid WebDAV conflict resolution')
  }
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) throw new Error('WebDAV is not connected')
  const project = await ProjectGetter.promises.getProject(projectId, {
    name: 1,
    overleaf: 1,
  })
  if (!project) throw new Error('project not found')

  const client = new WebdavClient(credentials)
  const rootPath = credentials.rootPath || Settings.webdav.rootPath
  const projectRoot = remotePath(rootPath, project.name)
  const releaseLease = await acquireLease(client, rootPath, projectId)
  if (!releaseLease) throw new Error('WebDAV project is currently being synchronized')
  try {
    const localFilePath = normalizeProjectFilePath(
      filePath.startsWith(`${projectRoot}/`)
        ? filePath.slice(projectRoot.length)
        : filePath
    )
    const resourcePath = remotePath(rootPath, project.name, localFilePath)
    if (resolution === 'keep-remote') {
      markInboundProject(userId, projectId)
      try {
        const body = await client.get(resourcePath)
        await TpdsUpdateHandler.promises.newUpdate(
          userId,
          projectId,
          project.name,
          localFilePath,
          Readable.from([Buffer.from(body)]),
          'webdav'
        )
      } catch (error) {
        if (error.status !== 404) throw error
        await TpdsUpdateHandler.promises.deleteUpdate(
          userId,
          projectId,
          project.name,
          localFilePath,
          'webdav'
        )
      }
      await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
    } else {
      await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
      const [docs, files] = await Promise.all([
        ProjectEntityHandler.promises.getAllDocs(projectId),
        ProjectEntityHandler.promises.getAllFiles(projectId),
      ])
      if (docs[localFilePath]) {
        await client.put(resourcePath, docs[localFilePath].lines.join('\n'))
      } else if (files[localFilePath]) {
        await client.put(resourcePath, await getFileBody(project, files[localFilePath]))
      } else {
        throw new Error(`local WebDAV conflict path not found: ${localFilePath}`)
      }
    }
    const remoteEntries = await collectEntries(client, projectRoot)
    const remoteEntry = remoteEntries.files.find(
      entry => entry.path === resourcePath
    )
    if (remoteEntry) {
      const remoteState = { ...(credentials.remoteState || {}) }
      remoteState[project.name] = {
        ...(remoteState[project.name] || {}),
        [localFilePath]: {
          etag: remoteEntry.etag,
          modifiedAt: remoteEntry.modifiedAt,
          size: remoteEntry.size,
        },
      }
      await WebdavCredentials.updateRemoteState(
        userId,
        project.name,
        remoteState[project.name]
      )
    }
    await WebdavCredentials.updateSyncStatus(userId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
      lastConflict: null,
    })
  } finally {
    await releaseLease()
  }
}

async function syncProjectForLinkedUsers(projectId) {
  const projectKey = projectId.toString()
  const users = await WebdavCredentials.getLinkedUserIds()
  await Promise.all(users.map(async userId => {
    if (isRecentlyInbound(userId, projectId)) return
    const projects = await ProjectGetter.promises.findAllUsersProjects(
      userId,
      '_id name archived trashed'
    )
    const writableProjects = [
      ...projects.owned,
      ...projects.readAndWrite,
    ].filter(project => !ProjectHelper.isArchivedOrTrashed(project, userId))
    if (writableProjects.some(project => project._id.toString() === projectKey)) {
      await SyncQueue.enqueue('webdav', userId, projectId)
    }
  }))
}

async function syncProjectOnOpen(userId, projectId) {
  if (!userId || !projectId) return
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) return
  await pollUser(userId)
  await syncProjectQueued(userId, projectId)
}

async function syncAllProjectsForUser(userId, { force = false } = {}) {
  const projects = await ProjectGetter.promises.findAllUsersProjects(
    userId,
    '_id name archived trashed'
  )
  const writableProjects = [
    ...projects.owned,
    ...projects.readAndWrite,
  ].filter(project => !ProjectHelper.isArchivedOrTrashed(project, userId))
  const results = await Promise.allSettled(
    writableProjects.map(project =>
      syncProjectQueued(userId, project._id, { force })
    )
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      const project = writableProjects[index]
      const conflict = result.reason?.status === 412
      await WebdavCredentials.updateSyncStatus(userId, {
        lastSyncError: conflict
          ? 'A remote file changed before it could be synchronized.'
          : result.reason?.message || 'sync failed',
        lastConflict: conflict
          ? {
            projectId: project._id.toString(),
            projectName: project.name,
            path: result.reason.projectPath || null,
            detectedAt: new Date().toISOString(),
          }
          : null,
      })
      await notifyWebdav(userId, conflict ? 'conflict' : 'failure', {
        projectId: project._id,
        projectName: project.name,
        path: conflict ? result.reason.projectPath : undefined,
      })
      logger.error(
        {
          err: result.reason,
          userId,
          projectId: project._id,
          resourcePath: result.reason?.resourcePath,
          status: result.reason?.status,
        },
        'WebDAV initial project sync failed'
      )
    }
  }
  logger.info(
    { userId, projectCount: writableProjects.length },
    'WebDAV initial project sync complete'
  )
}

async function moveEntityForLinkedUsers(params) {
  if (!params.newProjectName) {
    await syncProjectForLinkedUsers(params.projectId)
    return
  }

  const users = await WebdavCredentials.getLinkedUserIds()
  const results = await Promise.allSettled(
    users.map(async userId => {
      const projects = await ProjectGetter.promises.findAllUsersProjects(
        userId,
        '_id archived trashed'
      )
      const writableProjects = [
        ...projects.owned,
        ...projects.readAndWrite,
      ].filter(project => !ProjectHelper.isArchivedOrTrashed(project, userId))
      if (
        !writableProjects.some(
          project => project._id.toString() === params.projectId.toString()
        )
      ) {
        return
      }

      const credentials = await WebdavCredentials.get(userId)
      if (!credentials) return
      const client = new WebdavClient(credentials)
      const rootPath = credentials.rootPath || Settings.webdav.rootPath
      try {
        await client.move(
          remotePath(rootPath, params.projectName),
          remotePath(rootPath, params.newProjectName)
        )
      } catch (error) {
        if (error.status !== 404) throw error
      }
      await syncProjectQueued(userId, params.projectId)
      await WebdavCredentials.renameProject(
        userId,
        params.projectName,
        params.newProjectName
      )
    })
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason, projectId: params.projectId },
        'WebDAV move sync failed'
      )
    }
  }
}

async function deleteProjectForUsers({ projectId, projectName, userIds }) {
  const results = await Promise.allSettled(
    userIds.map(async userId => {
      const credentials = await WebdavCredentials.get(userId)
      if (!credentials || !credentials.syncedProjects?.includes(projectName)) {
        return
      }
      const client = new WebdavClient(credentials)
      const rootPath = credentials.rootPath || Settings.webdav.rootPath
      const resourcePath = remotePath(rootPath, projectName)
      try {
        await client.remove(resourcePath)
        logger.info(
          { userId, projectId, projectName, resourcePath },
          'WebDAV project folder deleted'
        )
      } catch (error) {
        logger.error(
          { err: error, userId, projectId, projectName, resourcePath },
          'WebDAV project folder deletion failed'
        )
        throw error
      } finally {
        await WebdavCredentials.forgetProject(userId, projectName)
      }
    })
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason, userId: userIds[index], projectId, projectName },
        'WebDAV project deletion sync failed'
      )
    }
  }
}

async function walk(client, resourcePath, callback) {
  let entries
  try {
    entries = await client.list(resourcePath)
  } catch (error) {
    if (error.status === 404) {
      logger.info(
        { resourcePath },
        'WebDAV folder disappeared while polling; skipping it'
      )
      return
    }
    throw error
  }
  for (const entry of entries) {
    if (
      entry.path === resourcePath ||
      !entry.path.startsWith(`${resourcePath}/`)
    ) {
      continue
    }
    if (entry.isDirectory) {
      await walk(client, entry.path, callback)
    } else {
      try {
        await callback(entry)
      } catch (error) {
        if (error.status === 404) {
          logger.info(
            { resourcePath: entry.path },
            'WebDAV file disappeared while polling; skipping it'
          )
          continue
        }
        throw error
      }
    }
  }
}

async function pollUser(userId) {
  const startedAt = Date.now()
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) return
  const client = new WebdavClient(credentials)
  const rootPath = credentials.rootPath || Settings.webdav.rootPath
  let changedFileCount = 0
  let deletedFileCount = 0
  logger.info({ userId, rootPath }, 'WebDAV poll started')
  const rootEntries = await client.list(rootPath)
  const normalizedRootPath = `/${rootPath || ''}`
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  const remoteProjectNames = new Set()
  for (const project of rootEntries.filter(
    entry => entry.isDirectory && entry.path.replace(/\/$/, '') !== normalizedRootPath
  )) {
    const projectName = project.path.split('/').filter(Boolean).pop()
    if (projectName === LOCK_DIRECTORY.slice(1)) continue
    remoteProjectNames.add(projectName)
    const projectRoot = project.path.replace(/\/$/, '')
    const projects = await ProjectGetter.promises.findUsersProjectsByName(
      userId,
      projectName
    )
    const localProject = projects.length === 1
      ? await ProjectGetter.promises.getProject(projects[0]._id, {
        overleaf: 1,
      })
      : null
    const releaseLease = await acquireLease(
      client,
      rootPath,
      localProject?._id || projectName
    )
    if (!releaseLease) continue
    try {
      const localEntities = localProject
        ? await Promise.all([
          ProjectEntityHandler.promises.getAllDocs(localProject._id),
          ProjectEntityHandler.promises.getAllFiles(localProject._id),
        ])
        : [null, null]
      const localDocs = localEntities[0]
      const localFiles = localEntities[1]
      if (projects.length === 1) markInboundProject(userId, projects[0]._id)
      const remotePaths = new Set()
      const previousState = credentials.remoteState?.[projectName] || {}
      const nextState = {}
      await walk(client, projectRoot, async entry => {
        const relativePath = entry.path.slice(projectRoot.length) || '/'
        remotePaths.add(relativePath)
        const state = {
          etag: entry.etag,
          modifiedAt: entry.modifiedAt,
          size: entry.size,
        }
        nextState[relativePath] = state
        if (
          previousState[relativePath]?.etag &&
          previousState[relativePath].etag === state.etag
        ) {
          return
        }
        if (
          !state.etag &&
          previousState[relativePath]?.modifiedAt === state.modifiedAt &&
          previousState[relativePath]?.size === state.size
        ) {
          nextState[relativePath] = state
          return
        }
        changedFileCount++
        let body
        try {
          body = await client.get(entry.path)
        } catch (error) {
          if (error.status === 423) {
            logger.info(
              { userId, projectName, path: relativePath },
              'WebDAV file is locked; deferring remote update'
            )
            return
          }
          throw error
        }
        const localBody = localDocs?.[relativePath]
          ? Buffer.from(localDocs[relativePath].lines.join('\n'))
          : localFiles?.[relativePath] && localProject
            ? Buffer.from(await getFileBody(localProject, localFiles[relativePath]))
            : null
        if (localBody && localBody.equals(Buffer.from(body))) {
          nextState[relativePath] = state
          return
        }
        nextState[relativePath] = state
        await TpdsUpdateHandler.promises.newUpdate(
          userId,
          null,
          projectName,
          relativePath,
          Readable.from([Buffer.from(body)]),
          'webdav'
        )
      })

      if (projects.length === 1) {
        await ProjectDeleter.promises.unmarkAsDeletedByExternalSource(
          projects[0]._id
        )
        const entities = await ProjectEntityHandler.promises.getAllEntities(
          projects[0]._id
        )
        for (const entity of entities.docs) {
          if (nextState[entity.path]) {
            nextState[entity.path].entityId = entity.doc._id.toString()
            nextState[entity.path].type = 'doc'
          }
        }
        for (const entity of entities.files) {
          if (nextState[entity.path]) {
            nextState[entity.path].entityId = entity.file._id.toString()
            nextState[entity.path].type = 'file'
          }
        }
        const hasPreviousRemoteState = Object.keys(previousState).length > 0
        for (const entity of [...entities.docs, ...entities.files]) {
          if (hasPreviousRemoteState && !remotePaths.has(entity.path)) {
            deletedFileCount++
          }
        }
      }
      await WebdavCredentials.updateRemoteState(userId, projectName, nextState)
      await WebdavCredentials.markProjectSynced(userId, projectName)
    } finally {
      await releaseLease()
    }
  }

  for (const projectName of credentials.syncedProjects || []) {
    if (remoteProjectNames.has(projectName)) continue
    const projects = await ProjectGetter.promises.findUsersProjectsByName(
      userId,
      projectName
    )
    const activeProjects = projects.filter(
      project => !ProjectHelper.isArchivedOrTrashed(project, userId)
    )
    if (activeProjects.length === 1) {
      await ProjectDeleter.promises.markAsDeletedByExternalSource(
        activeProjects[0]._id
      )
      await notifyWebdav(userId, 'deleted', {
        projectName,
        projectId: activeProjects[0]._id.toString(),
      })
    }
    await WebdavCredentials.forgetProject(userId, projectName)
  }
  await WebdavCredentials.updateSyncStatus(userId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  })
  logger.info(
    {
      userId,
      rootPath,
      remoteProjectCount: remoteProjectNames.size,
      changedFileCount,
      deletedFileCount,
      durationMs: Date.now() - startedAt,
    },
    'WebDAV poll completed'
  )
}

export default {
  syncProject,
  resolveConflict,
  syncAllProjectsForUser,
  syncProjectForLinkedUsers,
  moveEntityForLinkedUsers,
  deleteProjectForUsers,
  syncProjectOnOpen,
  pollUser,
}