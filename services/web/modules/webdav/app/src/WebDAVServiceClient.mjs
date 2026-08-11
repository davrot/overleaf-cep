import logger from '@overleaf/logger'

function toBuffer(body) {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  return Buffer.from(body, 'utf8')
}

/**
 * Client that orchestrates datamanipulator and webdavinterface microservices
 * This is a drop-in replacement for WebdavClient with the same interface
 */
export class WebDAVServiceClient {
  constructor(credentials) {
    // Support both the old {baseUrl, username, password} format and new {server_url, username, password}
    const serverUrl = credentials?.server_url || credentials?.baseUrl || credentials?.url
    if (!serverUrl) throw new Error('WebDAV configuration missing server_url')
    
    this.baseUrl = serverUrl.replace(/\/$/, '')
    this.username = credentials.username
    this.password = credentials.password
    
    this.datamanipulatorUrl = process.env.DATAMANIPULATOR_API_URL || 'http://localhost:4001'
    
    this.webdavInterfaceUrl = process.env.WEBDAVINTERFACE_API_URL || 'http://localhost:4002'
    
    // Retry configuration
    this._maxRetries = 2
    this._retryDelayMs = 100
  }

  /**
   * Validate connection using webdavinterface
   */
  async check() {
    // Validate that required credentials are present
    if (!this.baseUrl || !this.username) {
      throw new Error('WebDAV configuration missing required fields: server_url and username')
    }

    // If password is empty, validation will fail in webdavinterface but we should still proceed
    // This allows existing projects without passwords to be linked (password can be added later)

    try {
      const response = await fetch(`${this.webdavInterfaceUrl}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: this.baseUrl,
          username: this.username,
          password: this.password
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to connect to WebDAV server: ${errorText}`)
      }

      logger.debug({ rootPath: '/' }, 'WebDAV check completed')
    } catch (err) {
      logger.error({ err, rootPath: '/' }, 'WebDAV check failed')
      throw err
    }
  }

  /**
   * List directory contents using webdavinterface
   */
  async list(resourcePath) {
    try {
      const response = await fetch(`${this.webdavInterfaceUrl}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: this.baseUrl,
          username: this.username,
          password: this.password,
          path: resourcePath
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to list ${resourcePath}: ${errorText}`)
      }

      const data = await response.json()
      return data.entries || []
    } catch (err) {
      logger.error({ err, resourcePath }, 'WebDAV list failed')
      throw err
    }
  }

  /**
   * Create directory using webdavinterface
   */
  async createDirectory(resourcePath) {
    try {
      const response = await fetch(`${this.webdavInterfaceUrl}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: this.baseUrl,
          username: this.username,
          password: this.password,
          path: resourcePath
        })
      })

      if (!response.ok && response.status !== 405) {
        const errorText = await response.text()
        throw new Error(`Failed to create directory ${resourcePath}: ${errorText}`)
      }

      logger.debug({ resourcePath }, 'WebDAV mkdir completed')
      return { status: response.status }
    } catch (err) {
      logger.error({ err, resourcePath }, 'WebDAV mkdir failed')
      throw err
    }
  }

  /**
   * Get file content using webdavinterface
   */
  async get(resourcePath) {
    try {
      const url = `${this.webdavInterfaceUrl}/file?path=${encodeURIComponent(resourcePath)}`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Server-URL': this.baseUrl,
          'X-Username': this.username,
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get ${resourcePath}: ${errorText}`)
      }

      const data = await response.json()
      return Buffer.from(data.content_base64, 'base64')
    } catch (err) {
      logger.error({ err, resourcePath }, 'WebDAV get failed')
      throw err
    }
  }

  /**
   * Put/upload file using webdavinterface with ETag support
   */
  async put(resourcePath, body, { etag } = {}) {
    try {
      const response = await fetch(`${this.webdavInterfaceUrl}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: this.baseUrl,
          username: this.username,
          password: this.password,
          path: resourcePath,
          content_base64: toBuffer(body).toString('base64'),
          etag
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        
        // Handle ETag conflict (412 Precondition Failed)
        if (response.status === 412) {
          throw Object.assign(new Error(`Precondition failed for ${resourcePath}`), { status: 412, resourcePath })
        }
        
        throw new Error(`Failed to put ${resourcePath}: ${errorText}`)
      }

      logger.debug({ resourcePath }, 'WebDAV put completed')
      return { status: response.status }
    } catch (err) {
      logger.error({ err, resourcePath }, 'WebDAV put failed')
      throw err
    }
  }

  /**
   * Remove/delete file using webdavinterface
   */
  async remove(resourcePath) {
    try {
      const url = `${this.webdavInterfaceUrl}/file?path=${encodeURIComponent(resourcePath)}`
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'X-Server-URL': this.baseUrl,
          'X-Username': this.username,
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
        }
      })

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text()
        throw new Error(`Failed to remove ${resourcePath}: ${errorText}`)
      }

      logger.debug({ resourcePath }, 'WebDAV remove completed')
      return { status: response.status }
    } catch (err) {
      logger.error({ err, resourcePath }, 'WebDAV remove failed')
      throw err
    }
  }

  /**
   * Move file within server using webdavinterface
   */
  async move(sourcePath, destinationPath) {
    try {
      const response = await fetch(`${this.webdavInterfaceUrl}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: this.baseUrl,
          username: this.username,
          password: this.password,
          src: sourcePath,
          dst: destinationPath
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to move ${sourcePath} -> ${destinationPath}: ${errorText}`)
      }

      logger.debug({ sourcePath, destinationPath }, 'WebDAV move completed')
      return { status: response.status }
    } catch (err) {
      logger.error({ err, sourcePath, destinationPath }, 'WebDAV move failed')
      throw err
    }
  }

  /**
   * Execute operation with retry logic for transient errors
   */
  async _executeWithRetry(operation) {
    let lastError
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        
        // Retry on transient errors
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

  /**
   * Wrapper methods with retry support
   */
  async checkRetry() { return this._executeWithRetry(() => this.check()) }
  async listRetry(resourcePath) { return this._executeWithRetry(() => this.list(resourcePath)) }
  async mkdirRetry(resourcePath) { return this._executeWithRetry(() => this.createDirectory(resourcePath)) }
  async getRetry(resourcePath) { return this._executeWithRetry(() => this.get(resourcePath)) }
  async putRetry(resourcePath, body, options = {}) { return this._executeWithRetry(() => this.put(resourcePath, body, options)) }
  async removeRetry(resourcePath) { return this._executeWithRetry(() => this.remove(resourcePath)) }
}

export default WebDAVServiceClient
