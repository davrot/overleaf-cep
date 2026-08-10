import OError from '@overleaf/o-error'
import logger from '@overleaf/logger'
import crypto from 'node:crypto'

import SyncStateManager from './SyncStateManager.mjs'
import { ConflictError } from './ConflictErrors.mjs'

/**
 * Error class for when a conflict is not found in the system.
 * thrown when attempting to resolve a conflict that doesn't exist
 * or has already been resolved.
 */
class ConflictNotFoundError extends OError {
  /**
   * Creates a new ConflictNotFoundError instance.
   * 
   * @param {string} message - Human-readable error message
   * @param {Object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, { ...details, type: 'ConflictNotFoundError' })
    this.name = 'ConflictNotFoundError'
    this.details = details
  }
}

/**
 * Calculate SHA256 hash of content
 * 
 * @param {string|Buffer} content - Content to hash
 * @returns {string|null} Hex string representation of the hash, or null if input is empty/invalid
 */
function calculateHash(content) {
  if (!content) return null
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Get project's conflict state
 * Retrieves the current conflict status for a project linked to WebDAV.
 * 
 * @param {string|ObjectId} projectId - The Overleaf project ID
 * @returns {Promise<Object>} Project's conflict state document or null if no conflicts exist
 */
async function getProjectConflictState(projectId) {
  return await SyncStateManager.getProjectState(projectId)
}

/**
 * Detect if a file has a conflict based on ETag/hash comparison
 * Called after pollRemoteSync detects modified files. Checks whether the file
 * is already in conflict state or should be flagged for conflict resolution.
 * 
 * @param {Object} options - Conflict detection parameters
 * @param {string} options.projectId - Project ID
 * @param {string} options.path - File path
 * @param {string} options.localHash - Current version hash in Overleaf
 * @param {string} options.remoteETag - ETag from WebDAV server
 * @returns {Promise<Object>} Conflict detection result with 'exists' boolean and optional data
 */
async function detectConflict({ projectId, path, localHash, remoteETag }) {
  // Get project's current state
  const projectState = await SyncStateManager.getProjectState(projectId)
  
  if (!projectState) {
    throw new Error('Project not linked to WebDAV')
  }

  // Check if this file is already in conflict state
  const existingConflict = projectState.lastConflict?.path === path
  
  if (existingConflict) {
    return { exists: true, path, localHash, remoteETag }
  }

  // Store for conflict check on next poll
  await SyncStateManager.updateProjectState(projectId, {
    $push: { conflictingPaths: path },
  })

  return { exists: false, shouldCheckNextPoll: true }
}

/**
 * Get both versions of a conflicted file
 * Retrieves the local (Overleaf) and remote (WebDAV) versions of a file
 * that is currently in conflict state.
 * 
 * @param {string} projectId - Project ID
 * @param {string} path - Path of conflicting file
 * @returns {Promise<Object>} Object with 'local' and 'remote' version details
 * @throws {ConflictNotFoundError} If no active conflict exists for the given path
 */
async function getConflictingVersions(projectId, path) {
  const conflictState = await SyncStateManager.getProjectState(projectId)

  if (!conflictState || !conflictState.lastConflict || conflictState.lastConflict.path !== path) {
    throw new ConflictNotFoundError(`No active conflict for path: ${path}`, { projectId, path })
  }

  return {
    local: conflictState.lastConflict.versions.local,
    remote: conflictState.lastConflict.versions.remote,
  }
}

/**
 * Resolve a conflict by keeping one version
 * Marks a conflict as resolved and updates the project's sync state.
 * 
 * @param {string} projectId - Project ID
 * @param {string} path - Path of conflicting file
 * @param {'local'|'remote'} choice - Which version to keep
 * @returns {Promise<Object>} Resolution result with 'success: true', 'choice', and 'path'
 * @throws {ConflictNotFoundError} If no active conflict exists for the given path
 * @throws {Error} If invalid choice parameter is provided
 */
async function resolve(projectId, path, choice) {
  if (choice !== 'local' && choice !== 'remote') {
    throw new Error(`Invalid choice: ${choice}. Must be 'local' or 'remote'`)
  }

  const conflictState = await SyncStateManager.getProjectState(projectId)

  // Check if conflict still exists
  if (!conflictState || !conflictState.lastConflict || conflictState.lastConflict.path !== path) {
    throw new ConflictNotFoundError(`Conflict not found for: ${path}`, { projectId, path })
  }

  try {
    if (choice === 'local') {
      // Keep Overleaf's version - no remote change needed
      await SyncStateManager.updateProjectState(projectId, {
        mergeStatus: 'clean',
        lastSyncAt: new Date(),
        $unset: { 
          lastConflict: 1,
          conflictingPaths: 1 
        },
      })

      logger.info({ projectId, path, choice }, 'Conflict resolved: keeping local version')
    } else {
      // Keep WebDAV's version - the conflict state is cleared, next sync will pick up changes
      await SyncStateManager.updateProjectState(projectId, {
        mergeStatus: 'clean',
        lastSyncAt: new Date(),
        $unset: { 
          lastConflict: 1,
          conflictingPaths: 1 
        },
      })

      logger.info({ projectId, path, choice }, 'Conflict resolved: remote version will be synced')
    }

    return { success: true, choice, path }
  } catch (err) {
    throw OError.tag(err, `Failed to resolve conflict for ${path}`, { projectId, choice })
  }
}

export default {
  /**
   * Get project's conflict state
   * @param {string|ObjectId} projectId - Project ID
   * @returns {Promise<Object>} Project's conflict state document
   */
  getProjectConflictState,
  
  /**
   * Detect if a file has a conflict based on ETag/hash comparison
   * @param {Object} options - Conflict detection parameters
   * @param {string} options.projectId - Project ID
   * @param {string} options.path - File path
   * @param {string} options.localHash - Current version hash in Overleaf
   * @param {string} options.remoteETag - ETag from WebDAV server
   * @returns {Promise<Object>} Conflict detection result
   */
  detectConflict,
  
  /**
   * Get both versions of a conflicted file
   * @param {string} projectId - Project ID
   * @param {string} path - Path of conflicting file
   * @returns {Promise<Object>} Object with 'local' and 'remote' version details
   */
  getConflictingVersions,
  
  /**
   * Resolve a conflict by keeping one version
   * @param {string} projectId - Project ID
   * @param {string} path - Path of conflicting file
   * @param {'local'|'remote'} choice - Which version to keep
   * @returns {Promise<Object>} Resolution result with 'success: true'
   */
  resolve,
  
  /**
   * Calculate SHA256 hash of content
   * @param {string|Buffer} content - Content to hash
   * @returns {string|null} Hex string representation of the hash
   */
  calculateHash,
  
  /**
   * Error class for when a conflict is not found in the system.
   */
  ConflictNotFoundError,
  
  /**
   * Error class for WebDAV conflict errors (ETag mismatch)
   */
  ConflictError,
}