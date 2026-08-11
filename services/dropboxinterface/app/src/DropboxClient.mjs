/**
 * Dropbox API V2 Client Wrapper
 *
 * Handles authenticated requests to Dropbox API v2,
 * providing protocol abstractions for file operations.
 */

import { Dropbox } from 'dropbox'
import logger from '@overleaf/logger'
import { sanitizeTokenForLogging as authSanitize } from './auth.mjs'

export class DropboxClient {
  constructor({ accessToken }) {
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Missing or invalid access token')
    }

    this.accessToken = accessToken
    // Use globalThis.fetch for Node.js environment
    this.dbx = new Dropbox({
      fetch: globalThis.fetch,
      accessToken
    })
  }

  /**
   * Check authentication by fetching current account info
   */
  async check() {
    try {
      const response = await this.dbx.usersGetCurrentAccount()
      logger.debug(
        { accountId: response.result.account_id },
        'Dropbox auth verified'
      )
      return { status: 'ok', accountId: response.result.account_id }
    } catch (error) {
      logger.error({ err: error }, 'Dropbox authentication failed')
      throw this._mapDropboxError(error)
    }
  }

  /**
   * List directory contents with pagination support
   */
  async list(path = '') {
    try {
      let cursor = null
      let allEntries = []

      for (;;) {
        const response = await this.dbx.filesListFolder({
          path,
          cursor,
          recursive: false,
          include_media_info: false,
          include_deleted: false
        })

        if (response.result.entries) {
          allEntries = allEntries.concat(
            response.result.entries.map(entry => ({
              relative_path:
                entry.path_display?.replace(/^\//, '') || entry.name,
              name: entry.name,
              type: entry['.tag'] === 'folder' ? 'folder' : 'file',
              size: entry.size || 0,
              binary: true, // Assume all files are binary for safety
              checksum: null, // Use rev instead (we'll extract below)
              mtime: entry.server_modified
                ? new Date(entry.server_modified).toISOString()
                : null,
              dropbox_id: entry.id,
              rev: entry.rev || null
            }))
          )
        }

        if (!response.result.has_more) break
        cursor = response.result.cursor
      }

      logger.debug({ path, count: allEntries.length }, 'Dropbox list completed')
      return { entries: allEntries, has_more: false }
    } catch (error) {
      logger.error({ err: error, path }, 'Dropbox list folder failed')
      throw this._mapDropboxError(error)
    }
  }

  /**
   * Download file and return base64-encoded content
   */
  async download(path) {
    try {
      const response = await this.dbx.filesDownload({ path })

      if (response.result.fileBlob) {
        // Browser environment
        const reader = response.result.fileBlob.stream().getReader()
        let chunks = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
        const buffer = Buffer.concat(chunks)
        return buffer.toString('base64')
      } else if (response.result.content) {
        // Node.js environment with content in result
        return Buffer.from(response.result.content).toString('base64')
      } else {
        // Fallback: use stream
        const stream = response.getStream()
        let chunks = []
        for await (const chunk of stream) {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk)
          } else {
            chunks.push(Buffer.from(chunk))
          }
        }
        return Buffer.concat(chunks).toString('base64')
      }
    } catch (error) {
      logger.error({ err: error, path }, 'Dropbox download failed')
      const dropboxError = this._mapDropboxError(error)
      if (dropboxError.statusCode === 404) {
        return { notFound: true }
      }
      throw dropboxError
    }
  }

  /**
   * Upload file to Dropbox with revision tracking
   */
  async upload(path, contentBase64, { mode = 'overwrite', rev = null } = {}) {
    try {
      const contentBuffer = Buffer.from(contentBase64, 'base64')

      let uploadParams = {
        path,
        contents: contentBuffer,
        mode:
          mode === 'update'
            ? { '.tag': 'update', update: rev }
            : mode,
        mute: true
      }

      const response = await this.dbx.filesUpload(uploadParams)

      logger.debug({ path, size: contentBuffer.length }, 'Dropbox upload completed')
      return {
        success: true,
        revision: response.result.rev,
        dropbox_id: response.result.id
      }
    } catch (error) {
      logger.error({ err: error, path, mode }, 'Dropbox upload failed')

      const dropboxError = this._mapDropboxError(error)

      throw dropboxError
    }
  }

  /**
   * Delete file or folder from Dropbox
   */
  async delete(path) {
    try {
      void await this.dbx.filesDeleteV2({ path })

      logger.debug({ path }, 'Dropbox file deleted')
      return { success: true, deleted_path: path }
    } catch (error) {
      logger.error({ err: error, path }, 'Dropbox delete failed')
      const dropboxError = this._mapDropboxError(error)
      if (dropboxError.statusCode === 404) {
        return { success: true, notFound: true }
      }
      throw dropboxError
    }
  }

  /**
   * Create directory in Dropbox
   */
  async createDirectory(path) {
    try {
      const response = await this.dbx.filesCreateFolderV2({ path })

      logger.debug({ path }, 'Dropbox directory created')
      return {
        success: true,
        created: response.result.metadata !== null,
        modified_path: response.result.metadata?.path_display || path
      }
    } catch (error) {
      logger.error({ err: error, path }, 'Dropbox mkdir failed')
      const dropboxError = this._mapDropboxError(error)

      if (
        dropboxError.statusCode === 409 &&
        error.error?.error?.folder?.summary?.includes('same folder')
      ) {
        // Folder already exists
        return { success: true, created: false, message: 'Folder already exists' }
      }

      throw dropboxError
    }
  }

  /**
   * Move/rename file in Dropbox
   */
  async move(sourcePath, destinationPath) {
    try {
      const response = await this.dbx.filesMoveV2({
        from_path: sourcePath,
        to_path: destinationPath
      })

      logger.debug(
        { sourcePath, destinationPath },
        'Dropbox move completed'
      )
      return {
        success: true,
        old_path: sourcePath,
        new_path: response.result.metadata.path_display
      }
    } catch (error) {
      logger.error(
        { err: error, sourcePath, destinationPath },
        'Dropbox move failed'
      )
      throw this._mapDropboxError(error)
    }
  }

  /**
   * Get file metadata (includes rev for versioning)
   */
  async getMetadata(path) {
    try {
      const response = await this.dbx.filesGetMetadata({
        path,
        include_deleted: false
      })

      return {
        path_display: response.result.path_display,
        name: response.result.name,
        type: response.result['.tag'] === 'folder' ? 'folder' : 'file',
        size: response.result.size || 0,
        rev: response.result.rev || null,
        dropbox_id: response.result.id,
        mtime: response.result.server_modified
          ? new Date(response.result.server_modified).toISOString()
          : null
      }
    } catch (error) {
      logger.error({ err: error, path }, 'Dropbox metadata fetch failed')
      throw this._mapDropboxError(error)
    }
  }

  /**
   * Map Dropbox-specific errors to HTTP status codes
   */
  _mapDropboxError(error) {
    let statusCode = 500
    let message = error.message || 'Unknown Dropbox error'

    if (
      error.status === 401 ||
      error.error?.error?.access_token?.includes('invalid_access_token')
    ) {
      statusCode = 401
      message = 'Invalid or expired access token'
    } else if (
      error.status === 429 ||
      error.error?.error?.summary?.includes('rate_limit_exceeded')
    ) {
      statusCode = 429
      message =
        'Rate limit exceeded. Please wait and try again.'
    } else if (error.status === 403) {
      statusCode = 403
      message = 'Permission denied'
    } else if (
      error.status === 404 ||
      error.error?.error?.path?.includes('not_found')
    ) {
      statusCode = 404
      message = 'File or folder not found'
    } else if (error.status === 409) {
      statusCode = 409
      const conflictType =
        error.error?.error?.conflict?.summary || ''
      if (
        conflictType.includes('different_file') ||
        conflictType.includes('same_file')
      ) {
        message = 'File conflict detected'
      } else {
        message = `Conflict: ${error.error?.summary || error.message}`
      }
    } else if (error.status >= 500) {
      statusCode = 503
      message = 'Dropbox service temporarily unavailable'
    }

    const customError = new Error(message)
    customError.statusCode = statusCode
    customError.dropboxErrorCode =
      error.error?.error?.summary || null

    return customError
  }

  /**
   * Validate Dropbox access token format
   */
  static isValidToken(token) {
    if (!token || typeof token !== 'string') return false
    // Dropbox tokens start with "sl." or "dp."
    return token.startsWith('sl.') || token.startsWith('dp.')
  }

  /**
   * Sanitize token for logging (same as auth module)
   */
  static sanitizeTokenForLogging(token) {
    return authSanitize(token)
  }
}

export default DropboxClient
