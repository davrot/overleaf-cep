import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import { fetchJson, fetchStream } from '@overleaf/fetch-utils'

const urlBase = `${Settings.apis.project_history.url}/project`

/**
 * Module for interacting with Overleaf project history API.
 * Provides methods to retrieve files and versions from project snapshots,
 * which is used when syncing WebDAV changes into Overleaf.
 *
 * @module WebdavHistoryManager
 */

/**
 * Get the latest version number of a project.
 *
 * @param {string} projectId - The Overleaf project ID
 * @returns {Promise<number>} The current version number of the project
 * 
 * @throws {OError} If the request fails or project not found
 * 
 * @example
 * const version = await WebdavHistoryManager.latestVersion('abc123')
 * console.log(`Latest version: ${version}`)
 */
async function latestVersion(projectId) {
  try {
    const url = `${urlBase}/${projectId}/version`
    const json = await fetchJson(url)
    return json.version
  } catch (err) {
    logger.error({ err, projectId }, 'Failed to get project version')
    throw OError.tag(err, 'Failed to get latest project version', { projectId })
  }
}

/**
 * Get a complete snapshot of all project files at a specific version.
 *
 * @param {string} projectId - The Overleaf project ID
 * @param {number} version - The version number to retrieve
 * @returns {Promise<Object>} Object mapping file paths to file metadata:
 *                            `{ "path/to/file.tex": { hash: "abc..." }, ... }`
 * 
 * @throws {OError} If the request fails or project/version not found
 * 
 * @example
 * const snapshot = await WebdavHistoryManager.getProjectSnapshot(projectId, 5)
 * Object.keys(snapshot)  // [".project", "main.tex", "references.bib"]
 */
async function getProjectSnapshot(projectId, version) {
  try {
    const url = `${urlBase}/${projectId}/version/${version}`
    const snapshot = await fetchJson(url)
    return snapshot.files || {}
  } catch (err) {
    logger.error({ err, projectId, version }, 'Failed to get project snapshot')
    throw OError.tag(err, 'Failed to get project snapshot', { projectId, version })
  }
}

/**
 * Get an array of all file paths at a specific project version.
 *
 * @param {string} projectId - The Overleaf project ID
 * @param {number} version - The version number to retrieve
 * @returns {Promise<Array<string>>} Array of file paths (relative to project root)
 * 
 * @throws {OError} If the request fails or project/version not found
 * 
 * @example
 * const paths = await WebdavHistoryManager.getPathsAtVersion(projectId, 3)
 * // [".project", "main.tex", "appendix.aux", "figures/diagram.pdf"]
 */
async function getPathsAtVersion(projectId, version) {
  try {
    const url = `${urlBase}/${projectId}/paths/version/${version}`
    const json = await fetchJson(url)
    // The API may return either { paths: [...] } or just the array directly
    if (Array.isArray(json)) {
      return json
    }
    return json.paths || []
  } catch (err) {
    logger.error({ err, projectId, version }, 'Failed to get file paths')
    throw OError.tag(err, 'Failed to get file paths at version', { projectId, version })
  }
}

/**
 * Get the complete content of a specific file from a project snapshot.
 *
 * @param {string} projectId - The Overleaf project ID
 * @param {number} version - The version number containing the desired file
 * @param {string} filePath - Path to the file within the project (e.g., "main.tex")
 * @returns {Promise<Buffer>} File content as a Buffer object
 * 
 * @throws {OError} If the request fails or file not found at that version
 * 
 * @example
 * const texSource = await WebdavHistoryManager.getProjectFileBuffer(
 *   projectId,
 *   5,
 *   'main.tex'
 * )
 * console.log(texSource.toString('utf8'))  // Print TeX content
 */
async function getProjectFileBuffer(projectId, version, filePath) {
  try {
    const url = `${urlBase}/${projectId}/version/${version}/${encodeURIComponent(filePath)}`
    const stream = await fetchStream(url)
    
    // Convert stream to buffer
    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    
    return Buffer.concat(chunks)
  } catch (err) {
    logger.error({ err, projectId, version, filePath }, 'Failed to get file from history')
    throw OError.tag(err, 'Failed to fetch file from history', { projectId, version, filePath })
  }
}

export default {
  /**
   * Get the latest project version number.
   * @param {string} projectId - The Overleaf project ID
   * @returns {Promise<number>} Latest version number
   */
  latestVersion,
  
  /**
   * Get project snapshot (file hashes) at a specific version.
   * @param {string} projectId - The Overleaf project ID
   * @param {number} version - The version number to retrieve
   * @returns {Promise<Object>} Snapshot object mapping paths to metadata
   */
  getProjectSnapshot,
  
  /**
   * Get all file paths at a specific version.
   * @param {string} projectId - The Overleaf project ID
   * @param {number} version - The version number to retrieve
   * @returns {Promise<Array<string>>} Array of filepaths
   */
  getPathsAtVersion,
  
  /**
   * Get file content from history as a Buffer.
   * @param {string} projectId - The Overleaf project ID
   * @param {number} version - The version number containing the file
   * @param {string} filePath - Path to the file within the project
   * @returns {Promise<Buffer>} File content as Buffer
   */
  getProjectFileBuffer,
}