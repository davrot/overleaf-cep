import { createClient } from 'webdav'
import { validateAuth } from './auth.mjs'
import logger from '@overleaf/logger'

/**
 * Normalizes a file path for WebDAV compatibility.
 */

export class WebDAVClient {
  constructor({ baseUrl, username, password }) {
    if (!validateAuth({ username, password })) {
      throw new Error('Missing authentication credentials')
    }
    
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this._maxRetries = 2
    this._retryDelayMs = 100
    
    const parsed = new URL(this.baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('WebDAV URL must use HTTP or HTTPS')
    }

    const urlStr = `${parsed.protocol}//${parsed.username ? `${parsed.username}:${parsed.password}@` : ''}${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
    
    this.client = createClient(urlStr, { username, password })
  }

  async _executeWithRetry(operation) {
    let lastError
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        
        if (
          error.status === 423 ||
          error.status === 502 ||
          error.status === 503 ||
          error.status === 504
        ) {
          const delay = this._retryDelayMs * Math.pow(2, attempt)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          throw error
        }
      }
    }
    throw lastError
  }

  async list(resourcePath) {
    try {
      const items = await this.client.getDirectoryContents(resourcePath)
      
      return items.map(item => ({
        href: item.basename,
        path: item.basename,
        isDirectory: item.type === 'directory',
        etag: null,
        modifiedAt: item.lastmod ? new Date(item.lastmod).toISOString() : null,
        size: item.size || 0
      }))
    } catch (error) {
      logger.error({ err: error, resourcePath }, 'WebDAV list failed')
      throw error
    }
  }

  async download(resourcePath) {
    try {
      const content = await this.client.getFileContents(resourcePath)
      
      if (typeof content === 'string') {
        return Buffer.from(content, 'utf8').toString('base64')
      }
      return Buffer.from(content).toString('base64')
    } catch (error) {
      logger.error({ err: error, resourcePath }, 'WebDAV download failed')
      throw error
    }
  }

  async upload(resourcePath, contentBase64, { etag } = {}) {
    const contentBuffer = Buffer.from(contentBase64, 'base64')
    
    try {
      await this.client.putFileContents(resourcePath, contentBuffer, {
        overwrite: true,
        contentType: 'application/octet-stream',
        headers: etag ? { 'If-Match': etag } : undefined
      })
      
      logger.debug({ resourcePath }, 'WebDAV upload completed')
      return { success: true }
    } catch (error) {
      if (error.status === 412 || error.message?.includes('Precondition')) {
        const conflictError = new Error(`Upload conflict: ETag mismatch`)
        conflictError.cause = error
        throw conflictError
      }
      
      logger.error({ err: error, resourcePath }, 'WebDAV upload failed')
      throw error
    }
  }

  async delete(resourcePath) {
    try {
      await this.client.deleteFile(resourcePath)
      logger.debug({ resourcePath }, 'WebDAV file deleted')
      return { success: true }
    } catch (error) {
      if (error.status === 404 || error.message?.includes('NOT_FOUND')) {
        logger.debug({ resourcePath }, 'WebDAV file already removed')
        return { success: true, notFound: true }
      }
      
      logger.error({ err: error, resourcePath }, 'WebDAV delete failed')
      throw error
    }
  }

  async createDirectory(resourcePath) {
    try {
      await this.client.createDirectory(resourcePath)
      logger.debug({ resourcePath }, 'WebDAV directory created')
      return { success: true, created: true }
    } catch (error) {
      if (error.status === 405 || error.message?.includes('ALREADY_EXISTS')) {
        logger.debug({ resourcePath }, 'WebDAV directory already exists')
        return { success: true, created: false }
      }
      
      logger.error({ err: error, resourcePath }, 'WebDAV mkdir failed')
      throw error
    }
  }

  async move(sourcePath, destinationPath) {
    try {
      await this.client.moveFile(sourcePath, destinationPath, {
        overwrite: true,
      })
      logger.debug({ sourcePath, destinationPath }, 'WebDAV move completed')
      return { success: true }
    } catch (error) {
      logger.error({ err: error, sourcePath, destinationPath }, 'WebDAV move failed')
      throw error
    }
  }

  async check() {
    try {
      const exists = await this.client.exists(this.baseUrl)
      if (!exists) {
        throw new Error('Root path does not exist')
      }
      logger.debug({ rootPath: this.baseUrl }, 'WebDAV check completed')
    } catch (error) {
      logger.error({ err: error, rootPath: this.baseUrl }, 'WebDAV check failed')
      throw error
    }
  }
}

export default WebDAVClient
