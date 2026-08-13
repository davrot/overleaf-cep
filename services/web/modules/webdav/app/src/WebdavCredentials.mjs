import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { WebdavUserCredentials } from '../models/webdavUserCredentials.mjs'
import { decrypt, encrypt } from './WebdavTokenEncryption.mjs'
import { WebdavSyncProjectStates } from '../models/webdavSyncProjectStates.mjs'

const { normalizeQuery } = Mongo
const credentialLocks = new Map()

/**
 * Executes an operation with a per-user lock to prevent race conditions.
 * Used when updating user credentials to avoid concurrent modification issues.
 * 
 * @param {string} userId - The user ID to lock on
 * @param {function} operation - Async function to execute while holding the lock
 * @returns {Promise<any>} Result of the operation
 */
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

/**
 * Get user's WebDAV credentials from the database.
 * Returns null if no credentials exist for the user.
 *
 * @param {string} userId - The Overleaf user ID
 * @returns {Promise<Object|null>} Decrypted credentials object or null
 */
async function get(userId) {
  const record = await WebdavUserCredentials.findOne(
    normalizeQuery({ userId })
  ).lean()
  if (!record) return null
  return decrypt(record.credentials)
}

/**
 * Encrypts and saves user's WebDAV credentials without acquiring a lock.
 * Should be called within an existing withUserLock context.
 *
 * @param {string} userId - The Overleaf user ID
 * @param {Object} credentials - Credentials to encrypt (baseUrl, username, password/token)
 */
async function saveUnlocked(userId, credentials) {
  const encrypted = await encrypt(credentials)
  await WebdavUserCredentials.findOneAndUpdate(
    normalizeQuery({ userId }),
    { $set: { credentials: encrypted } },
    { upsert: true }
  )
}

/**
 * Encrypts and saves user's WebDAV credentials with proper locking.
 *
 * @param {string} userId - The Overleaf user ID
 * @param {Object} credentials - Credentials to encrypt (baseUrl, username, password-token)
 */
async function save(userId, credentials) {
  return withUserLock(userId, () => saveUnlocked(userId, credentials))
}

/**
 * Remove user's WebDAV credentials from the database.
 *
 * @param {string} userId - The Overleaf user ID
 */
async function remove(userId) {
  // First unlink all projects associated with this user's WebDAV accounts
  const credentials = await get(userId)
  if (credentials) {
    // Extract usernames to find linked projects
    const username = credentials.username
    
    // Unlink all projects that use this WebDAV username
    const syncStates = await WebdavSyncProjectStates.find({
      'connected': true,
      path: { $regex: new RegExp(`^.*${username}.*$`, 'i') }
    }).lean()
    
    for (const state of syncStates) {
      await WebdavSyncProjectStates.deleteOne({ projectId: state.projectId })
      logger.debug(
        { userId, projectId: state.projectId },
        'on disconnect: unlinked project due to credential removal'
      )
    }
  }
  
  // Then delete credentials
  await withUserLock(userId, () =>
    WebdavUserCredentials.deleteOne(normalizeQuery({ userId }))
  )
}

/**
 * Get all users with linked WebDAV accounts.
 *
 * @returns {Promise<Array<string>>} Array of user IDs as strings
 */
async function getLinkedUserIds() {
  const records = await WebdavUserCredentials.find({}, { userId: 1 }).lean()
  return records.map(record => record.userId.toString())
}

/**
 * Marks a project as synced in the user's credentials.
 * Adds the project name to the syncedProjects list to prevent re-syncing on poll.
 *
 * @param {string} userId - The Overleaf user ID
 * @param {string} projectName - Name of the project that was synced
 */
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

/**
 * Removes a project from the user's synced projects list.
 *
 * @param {string} userId - The Overleaf user ID
 * @param {string} projectName - Name of the project to forget
 */
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

/**
 * Updates the remote file state (ETags) for a project.
 * Used to track which files were synchronized during sync operations.
 *
 * @param {string} userId - The Overleaf user ID
 * @param {string} projectName - Name of the project
 * @param {Array} entries - Array of file entry objects with path and ETag info
 */
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

/**
 * Updates credential sync status (not full state update).
 *
 * @param {string} userId - The Overleaf user ID
 * @param {Object} status - Status object to merge into credentials
 */
async function updateSyncStatus(userId, status) {
  await withUserLock(userId, async () => {
    const credentials = await get(userId)
    if (!credentials) return
    await saveUnlocked(userId, { ...credentials, ...status })
  })
}

export default {
  /**
   * Get user's WebDAV credentials from the database.
   * @param {string} userId - The Overleaf user ID
   * @returns {Promise<Object|null>} Decrypted credentials object or null
   */
  get,
  
  /**
   * Encrypts and saves user's WebDAV credentials with proper locking.
   * @param {string} userId - The Overleaf user ID
   * @param {Object} credentials - Credentials to encrypt (baseUrl, username, password/token)
   */
  save,
  
  /**
   * Remove user's WebDAV credentials from the database.
   * @param {string} userId - The Overleaf user ID
   */
  remove,
  
  /**
   * Get all users with linked WebDAV accounts.
   * @returns {Promise<Array<string>>} Array of user IDs as strings
   */
  getLinkedUserIds,
  
  /**
   * Marks a project as synced in the user's credentials.
   * @param {string} userId - The Overleaf user ID
   * @param {string} projectName - Name of the project that was synced
   */
  markProjectSynced,
  
  /**
   * Removes a project from the user's synced projects list.
   * @param {string} userId - The Overleaf user ID
   * @param {string} projectName - Name of the project to forget
   */
  forgetProject,
  
  /**
   * Updates the remote file state (ETags) for a project.
   * @param {string} userId - The Overleaf user ID
   * @param {string} projectName - Name of the project
   * @param {Array} entries - Array of file entry objects with path and ETag info
   */
  updateRemoteState,
  
  /**
   * Updates credential sync status.
   * @param {string} userId - The Overleaf user ID
   * @param {Object} status - Status object to merge into credentials
   */
  updateSyncStatus,
}