import { WebdavSyncProjectStates } from '../models/webdavSyncProjectStates.mjs'

/**
 * Module for managing project synchronization state in MongoDB.
 * Provides CRUD operations for WebDAV sync states.
 *
 * @module SyncStateManager
 */

/**
 * Get a project's WebDAV sync state document.
 *
 * @param {string|ObjectId} projectId - The Overleaf project ID to look up
 * @param {Object} [projection={}] - Optional MongoDB projection object (field: 1/0)
 * @returns {Promise<Object|null>} Project sync state document or null if none exists
 * 
 * @example
 * // Get full state
 * const state = await SyncStateManager.getProjectState(projectId)
 * console.log(state.lastSyncAt, state.syncStatus)
 *
 * @example
 * // Get specific fields only
 * const state = await SyncStateManager.getProjectState(projectId, {
 *   lastSyncAt: 1,
 *   syncStatus: 1,
 *   _id: 0
 * })
 */
async function getProjectState(projectId, projection = {}) {
  return await WebdavSyncProjectStates.findOne({ projectId }, projection).lean()
}

/**
 * Create a new project sync state document.
 *
 * @param {string|ObjectId} projectId - The Overleaf project ID
 * @param {Object} data - Initial sync state data (username, lastSyncAt, etc.)
 * @returns {Promise<Object>} The created MongoDB document with _id and all fields
 * 
 * @example
 * const state = await SyncStateManager.createProjectState(projectId, {
 *   username: 'alice',
 *   lastSyncAt: new Date(),
 *   syncStatus: 'idle'
 * })
 */
async function createProjectState(projectId, data) {
  return await WebdavSyncProjectStates.create({
    projectId,
    ...data
  })
}

/**
 * Update a project's sync state document.
 *
 * @param {string|ObjectId} projectId - The Overleaf project ID
 * @param {Object} data - Data to merge into the document (uses $set in MongoDB)
 * @returns {Promise<Object>} MongoDB update result with matched/modified count
 * 
 * @example
 * // Update only last sync time
 * await SyncStateManager.updateProjectState(projectId, {
 *   lastSyncAt: new Date(),
 *   lastSyncError: null
 * })
 */
async function updateProjectState(projectId, data) {
  return await WebdavSyncProjectStates.updateOne(
    { projectId },
    { $set: data }
  )
}

/**
 * Remove all sync state documents for a project.
 *
 * @param {string|ObjectId} projectId - The Overleaf project ID
 * @returns {Promise<Object>} MongoDB delete result with deleted count
 */
async function removeProjectState(projectId) {
  return await WebdavSyncProjectStates.deleteMany({ projectId })
}

export default {
  /**
   * Get a project's sync state.
   * @param {string|ObjectId} projectId - The Overleaf project ID
   * @param {Object} [projection={}] - Optional MongoDB projection object
   * @returns {Promise<Object|null>} Project sync state or null
   */
  getProjectState,
  
  /**
   * Create a new project sync state.
   * @param {string|ObjectId} projectId - The Overleaf project ID
   * @param {Object} data - Initial sync state data
   * @returns {Promise<Object>} Created document
   */
  createProjectState,
  
  /**
   * Update a project's sync state.
   * @param {string|ObjectId} projectId - The Overleaf project ID
   * @param {Object} data - Data to merge into the document
   * @returns {Promise<Object>} MongoDB update result
   */
  updateProjectState,
  
  /**
   * Remove sync state for a project.
   * @param {string|ObjectId} projectId - The Overleaf project ID
   * @returns {Promise<Object>} MongoDB delete result
   */
  removeProjectState,
}