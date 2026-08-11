/**
 * Dropbox Client - Integrates with dropboxinterface microservice
 *
 * This client handles all communication with the dropboxinterface microservice,
 * using OAuth 2.0 access tokens for authentication.
 */

import https from 'https'
import http from 'http'
import logger from '@overleaf/logger'

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
  async _request(path, options) {
    const url = `${this.apiUrl}${path}`

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const headers = { ...(options.headers || {}) }
      if (this.accessToken && !headers['X-Access-Token']) {
        headers['X-Access-Token'] = this.accessToken
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
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const jsonData = data ? JSON.parse(data) : {}
              resolve(jsonData)
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error(`Dropbox: Unauthorized - ${data}`))
            } else if (res.statusCode === 404) {
              reject(new Error(`Dropbox: Not found - ${path}`))
            } else if (res.statusCode >= 500) {
              reject(new Error(`Dropbox: Service error (${res.statusCode}) - ${data}`))
            } else {
              reject(new Error(`Dropbox: Error (${res.statusCode}) - ${data}`))
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
