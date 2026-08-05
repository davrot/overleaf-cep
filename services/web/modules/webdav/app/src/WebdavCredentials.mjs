import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import WebdavUserCredentials from './models/webdavUserCredentials.mjs'
import { decrypt, encrypt } from './WebdavTokenEncryption.mjs'

const { normalizeQuery } = Mongo
const credentialLocks = new Map()

async function withUserLock(userId, operation) {
  const key = userId.toString()
  const previous = credentialLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => {
    release = resolve
  })
  credentialLocks.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (credentialLocks.get(key) === current) credentialLocks.delete(key)
  }
}

async function get(userId) {
  const record = await WebdavUserCredentials.findOne(
    normalizeQuery({ userId })
  ).lean()
  if (!record) return null
  return decrypt(record.credentials)
}

async function saveUnlocked(userId, credentials) {
  const encrypted = await encrypt(credentials)
  await WebdavUserCredentials.findOneAndUpdate(
    normalizeQuery({ userId }),
    { $set: { credentials: encrypted } },
    { upsert: true }
  )
}

async function save(userId, credentials) {
  return withUserLock(userId, () => saveUnlocked(userId, credentials))
}

async function remove(userId) {
  await withUserLock(userId, () =>
    WebdavUserCredentials.deleteOne(normalizeQuery({ userId }))
  )
}

async function getLinkedUserIds() {
  const records = await WebdavUserCredentials.find({}, { userId: 1 }).lean()
  return records.map(record => record.userId.toString())
}

async function markProjectSynced(userId, projectName) {
  await withUserLock(userId, async () => {
    const credentials = await get(userId)
    if (!credentials) return
    const syncedProjects = new Set(credentials.syncedProjects || [])
    syncedProjects.add(projectName)
    await saveUnlocked(userId, {
      ...credentials,
      syncedProjects: [...syncedProjects],
    })
  })
}

async function forgetProject(userId, projectName) {
  await withUserLock(userId, async () => {
    const credentials = await get(userId)
    if (!credentials) return
    const syncedProjects = (credentials.syncedProjects || []).filter(
      name => name !== projectName
    )
    const remoteState = { ...(credentials.remoteState || {}) }
    delete remoteState[projectName]
    await saveUnlocked(userId, { ...credentials, syncedProjects, remoteState })
  })
}

async function updateRemoteState(userId, projectName, entries) {
  await withUserLock(userId, async () => {
    const credentials = await get(userId)
    if (!credentials) return
    await saveUnlocked(userId, {
      ...credentials,
      remoteState: {
        ...(credentials.remoteState || {}),
        [projectName]: entries,
      },
    })
  })
}

async function renameProject(userId, oldProjectName, newProjectName) {
  await withUserLock(userId, async () => {
    const credentials = await get(userId)
    if (!credentials) return
    const syncedProjects = new Set(credentials.syncedProjects || [])
    syncedProjects.delete(oldProjectName)
    syncedProjects.add(newProjectName)
    const remoteState = { ...(credentials.remoteState || {}) }
    if (remoteState[oldProjectName] && !remoteState[newProjectName]) {
      remoteState[newProjectName] = remoteState[oldProjectName]
    }
    delete remoteState[oldProjectName]
    await saveUnlocked(userId, {
      ...credentials,
      syncedProjects: [...syncedProjects],
      remoteState,
    })
  })
}

async function updateSyncStatus(userId, status) {
  await withUserLock(userId, async () => {
    const credentials = await get(userId)
    if (!credentials) return
    await saveUnlocked(userId, { ...credentials, ...status })
  })
}

export default {
  get,
  save,
  remove,
  getLinkedUserIds,
  markProjectSynced,
  forgetProject,
  updateRemoteState,
  renameProject,
  updateSyncStatus,
}