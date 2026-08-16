/**
 * Dropbox Client - Integrates with dropboxinterface microservice
 *
 * This client handles all communication with the dropboxinterface microservice,
 * using OAuth 2.0 access tokens for authentication.
 */

import https from 'node:https'
import http from 'node:http'
import logger from '@overleaf/logger'

// D2: sync file filter — build artifacts + hidden files/dirs never take part
// in Dropbox sync (import walk, push upload, remote listings, persisted
// remoteFiles). Shared so all layers apply the SAME rule.
const SYNC_EXCLUDED_EXTENSIONS = ['aux', 'log', 'out', 'toc', 'fls', 'idx', 'vrb']

/**
 * Returns true when a file (or any directory component of its path) should be
 * excluded from sync: hidden entries (name starts with '.'), transient LaTeX
 * build outputs, or .synctex.gz files.
 * @param {string} nameOrPath basename or project-relative/remote path
 */
export function isSyncExcluded(nameOrPath) {
  if (!nameOrPath || typeof nameOrPath !== 'string') return false
  const parts = nameOrPath.split('/').filter(Boolean)
  if (!parts.length) return false
  for (const part of parts) {
    if (part.startsWith('.')) return true
  }
  const base = parts[parts.length - 1]
  if (base.endsWith('.synctex.gz')) return true
  const dot = base.lastIndexOf('.')
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase()
    if (SYNC_EXCLUDED_EXTENSIONS.includes(ext)) return true
  }
  return false
}

export class DropboxClient {
  constructor({ accessToken, apiUrl }) {
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Missing or invalid OAuth access token')
    }

    this.accessToken = accessToken
    this.apiUrl = apiUrl || process.env.DROPBOXINTERFACE_API_URL || 'http://localhost:4003'
  }

  /**
   * Make HTTP request to dropboxinterface microservice
   */
  /**
   * Retry wrapper (DI-04): the Dropbox API is rate-limited; 429 and 5xx
   * responses are transient and are retried with exponential backoff.
   */
  async _request(path, options) {
    const maxAttempts = 3
    let lastError
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this._requestOnce(path, options)
      } catch (error) {
        lastError = error
        const status = error?.status
        const transient =
          status === 429 || status === 502 || status === 503 || status === 504
        if (!transient || attempt === maxAttempts - 1) throw error
        const delay = 250 * Math.pow(2, attempt)
        logger.warn(
          { status, attempt: attempt + 1, delayMs: delay, path },
          'Dropbox request transiently failed; retrying'
        )
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    throw lastError
  }

  async _requestOnce(path, options) {
    const url = `${this.apiUrl}${path}`

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const headers = { ...(options.headers || {}) }
      if (this.accessToken && !headers['X-Access-Token']) {
        headers['X-Access-Token'] = this.accessToken
      }
      // Service-to-service auth (ARC-02): forwarded when configured; the
      // interface accepts unauthenticated calls (with a warning) when the
      // token is unset, so existing deployments keep working.
      if (process.env.SHARED_SERVICE_TOKEN) {
        headers['x-service-token'] = process.env.SHARED_SERVICE_TOKEN
      }
      if (options.body) {
        headers['Content-Type'] = 'application/json'
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method || 'GET',
        headers: headers,
      }

      logger.debug({ url: reqOptions.path, method: reqOptions.method }, 'Dropbox API request')

      const req = httpModule.request(reqOptions, res => {
        let data = ''

        res.on('data', chunk => { data += chunk })

        res.on('end', () => {
          const fail = (message) => {
            const error = new Error(message)
            error.status = res.statusCode
            reject(error)
          }
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const jsonData = data ? JSON.parse(data) : {}
              resolve(jsonData)
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              fail(`Dropbox: Unauthorized - ${data}`)
            } else if (res.statusCode === 404) {
              fail(`Dropbox: Not found - ${path}`)
            } else if (res.statusCode === 429) {
              fail(`Dropbox: Rate limited (429) - ${data}`)
            } else if (res.statusCode >= 500) {
              fail(`Dropbox: Service error (${res.statusCode}) - ${data}`)
            } else {
              fail(`Dropbox: Error (${res.statusCode}) - ${data}`)
            }
          } catch (parseError) {
            reject(parseError)
          }
        })
      })

      req.on('error', error => {
        logger.error({ err: error, url }, 'Dropbox HTTP request failed')
        reject(error)
      })

      if (options.body) {
        req.write(JSON.stringify(options.body))
      }

      req.end()
    })
  }

  /**
   * Check connection to dropboxinterface microservice
   */
  async checkConnection() {
    try {
      const result = await this._request('/check', {
        method: 'POST',
        body: { access_token: this.accessToken },
      })

      logger.debug({ apiUrl: this.apiUrl }, 'Dropbox connection check successful')
      return result
    } catch (error) {
      logger.error(
        { err: error, url: `${this.apiUrl}/check` },
        'Dropbox connection check failed'
      )
      throw error
    }
  }

  /**
   * List directory contents in Dropbox
   */
  async list(path = '', { recursive = false } = {}) {
    try {
      const result = await this._request('/list', {
        method: 'POST',
        body: { path, recursive, access_token: this.accessToken },
      })

      logger.debug({ path, count: result.entries?.length }, 'Dropbox list completed')
      return result
    } catch (error) {
      logger.error(
        { err: error, path, url: `${this.apiUrl}/list` },
        'Dropbox list failed'
      )
      throw error
    }
  }

  /**
   * Download file from Dropbox (returns base64 content)
   */
  async download(path) {
    try {
      const result = await this._request(`/file?path=${encodeURIComponent(path)}`, {
        method: 'GET',
      })

      logger.debug({ path }, 'Dropbox file downloaded')
      return result
    } catch (error) {
      logger.error(
        { err: error, path, url: `${this.apiUrl}/file` },
        'Dropbox download failed'
      )
      throw error
    }
  }

  /**
   * Upload file to Dropbox with revision checking
   */
  async upload(path, contentBase64, { mode = 'overwrite', rev } = {}) {
    try {
      const result = await this._request('/file', {
        method: 'POST',
        body: {
          path,
          content_base64: contentBase64,
          mode: rev ? 'update' : mode,
          rev,
        },
      })

      logger.debug(
        { path, revision: result.revision },
        'Dropbox file uploaded'
      )
      return result
    } catch (error) {
      logger.error(
        { err: error, path, url: `${this.apiUrl}/file` },
        'Dropbox upload failed'
      )
      throw error
    }
  }

  /**
   * Delete file from Dropbox
   */
  async delete(path) {
    try {
      const result = await this._request(`/file?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      })

      logger.debug({ path }, 'Dropbox file deleted')
      return result
    } catch (error) {
      logger.error(
        { err: error, path, url: `${this.apiUrl}/file` },
        'Dropbox delete failed'
      )
      throw error
    }
  }

  /**
   * Create directory in Dropbox
   */
  async createDirectory(path) {
    try {
      const result = await this._request('/mkdir', {
        method: 'POST',
        body: { path, access_token: this.accessToken },
      })

      logger.debug({ path }, 'Dropbox directory created')
      return result
    } catch (error) {
      logger.error(
        { err: error, path, url: `${this.apiUrl}/mkdir` },
        'Dropbox mkdir failed'
      )
      throw error
    }
  }

  /**
   * Move/rename file in Dropbox
   */
  async move(sourcePath, destinationPath) {
    try {
      const result = await this._request('/move', {
        method: 'POST',
        body: { src: sourcePath, dst: destinationPath, access_token: this.accessToken },
      })

      logger.debug(
        { sourcePath, destinationPath },
        'Dropbox file moved'
      )
      return result
    } catch (error) {
      logger.error(
        { err: error, sourcePath, destinationPath },
        'Dropbox move failed'
      )
      throw error
    }
  }

  /**
   * Get user's current Dropbox account info
   */
  async getAccountInfo() {
    try {
      const result = await this._request('/check', {
        method: 'POST',
        body: { access_token: this.accessToken },
      })

      return result
    } catch (error) {
      logger.error(
        { err: error, url: `${this.apiUrl}/check` },
        'Dropbox account info fetch failed'
      )
      throw error
    }
  }
}

export default DropboxClient
