import { DOMParser } from '@xmldom/xmldom'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

function normalizePath(value) {
  const path = `/${value || ''}`.replace(/\\/g, '/')
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

function encodePath(value) {
  return normalizePath(value)
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
}

function child(element, localName) {
  if (!element) return null
  return Array.from(element.childNodes || []).find(
    node => node.nodeType === 1 && (node.localName || node.nodeName).endsWith(localName)
  )
}

function descendant(element, localName) {
  if (!element) return null
  return Array.from(
    element.getElementsByTagNameNS('*', localName) || []
  )[0]
}

function text(element, localName) {
  return descendant(element, localName)?.textContent || null
}

function relativePath(pathname, basePath) {
  const normalizedPath = normalizePath(pathname)
  const normalizedBase = normalizePath(basePath)
  if (normalizedPath === normalizedBase) return '/'
  if (normalizedPath.startsWith(`${normalizedBase}/`)) {
    return normalizedPath.slice(normalizedBase.length) || '/'
  }
  return normalizedPath
}

export function parseMultistatus(xml, requestedPath, basePath = '/') {
  let parseError = false
  const document = new DOMParser({
    errorHandler: {
      warning: () => {
        parseError = true
      },
      error: () => {
        parseError = true
      },
      fatalError: () => {
        parseError = true
      },
    },
  }).parseFromString(xml, 'application/xml')
  if (parseError || document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('invalid WebDAV multistatus response')
  }
  return Array.from(document.getElementsByTagNameNS('*', 'response')).map(response => {
    const href = text(response, 'href')
    const resourceType = descendant(
      descendant(response, 'resourcetype'),
      'collection'
    )
    return {
      href,
      path: href
        ? relativePath(
          decodeURIComponent(new URL(href, 'http://webdav.invalid').pathname),
          basePath
        )
        : requestedPath,
      isDirectory: Boolean(resourceType),
      etag: text(response, 'getetag'),
      modifiedAt: text(response, 'getlastmodified'),
      size: Number(text(response, 'getcontentlength') || 0),
    }
  })
}

export default class WebdavClient {
  constructor({ baseUrl, username, password, rootPath }) {
    const parsed = new URL(baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('WebDAV URL must use HTTP or HTTPS')
    }
    this.baseUrl = parsed
    this.username = username
    this.password = password
    this.rootPath = normalizePath(rootPath)
  }

  url(resourcePath = '/') {
    const url = new URL(this.baseUrl)
    const basePath = normalizePath(this.baseUrl.pathname)
    url.pathname = `${basePath}/${encodePath(resourcePath).replace(/^\//, '')}`
      .replace(/\/+/g, '/')
    return url
  }

  async request(method, resourcePath, options = {}) {
    const retryCount = Settings.webdav?.retryCount ?? 2
    const retryDelayMs = Settings.webdav?.retryDelayMs ?? 250
    for (let attempt = 0; ; attempt++) {
      const startedAt = Date.now()
      try {
        const url = this.url(resourcePath)
        logger.debug(
          {
            method,
            resourcePath,
            urlPath: url.pathname,
            attempt: attempt + 1,
          },
          'WebDAV request started'
        )
        const response = await fetch(url, {
          ...options,
          method,
          headers: {
            authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
            ...(options.headers || {}),
          },
          signal: AbortSignal.timeout(
            Settings.webdav?.requestTimeoutMs || 10_000
          ),
        })
        const durationMs = Date.now() - startedAt
        if (response.ok || response.status === 207) {
          logger.debug(
            {
              method,
              resourcePath,
              status: response.status,
              durationMs,
              attempt: attempt + 1,
            },
            'WebDAV request completed'
          )
          return response
        }
        const retryable = [408, 429, 500, 502, 503, 504].includes(response.status)
        if (!retryable) {
          const error = new Error(
            `WebDAV request failed with status ${response.status}`
          )
          error.status = response.status
          error.resourcePath = resourcePath
          throw error
        }
        if (attempt >= retryCount) {
          const error = new Error(
            `WebDAV request failed with status ${response.status}`
          )
          error.status = response.status
          error.resourcePath = resourcePath
          throw error
        }
        logger.warn(
          {
            method,
            resourcePath,
            status: response.status,
            durationMs,
            attempt: attempt + 1,
            retryInMs: retryDelayMs * 2 ** attempt,
          },
          'WebDAV request will be retried'
        )
      } catch (error) {
        if (error.status !== undefined) {
          throw error
        }
        if (attempt >= retryCount) {
          logger.error(
            {
              err: error,
              method,
              resourcePath,
              durationMs: Date.now() - startedAt,
              attempt: attempt + 1,
            },
            'WebDAV request failed'
          )
          throw error
        }
        logger.warn(
          {
            err: error,
            method,
            resourcePath,
            durationMs: Date.now() - startedAt,
            attempt: attempt + 1,
            retryInMs: retryDelayMs * 2 ** attempt,
          },
          'WebDAV request will be retried after error'
        )
      }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs * 2 ** attempt))
    }
  }

  async check() {
    await this.request('PROPFIND', this.rootPath, {
      headers: { depth: '0' },
    })
  }

  async list(resourcePath) {
    const response = await this.request('PROPFIND', resourcePath, {
      headers: {
        depth: '1',
        'content-type': 'application/xml; charset=utf-8',
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getetag/><getlastmodified/><getcontentlength/></prop></propfind>',
    })
    return parseMultistatus(
      await response.text(),
      resourcePath,
      this.baseUrl.pathname
    )
  }

  async createDirectory(resourcePath) {
    try {
      const response = await this.request('MKCOL', resourcePath)
      return response.status
    } catch (error) {
      if (error.status === 405) return 405
      throw error
    }
  }

  async put(resourcePath, body, { etag } = {}) {
    const response = await this.request('PUT', resourcePath, {
      headers: {
        'content-type': 'application/octet-stream',
        ...(etag ? { 'if-match': etag } : {}),
      },
      body,
    })
    return response.status
  }

  async get(resourcePath) {
    const response = await this.request('GET', resourcePath)
    return response.arrayBuffer()
  }

  async remove(resourcePath) {
    try {
      const response = await this.request('DELETE', resourcePath)
      return response.status
    } catch (error) {
      if (error.status === 404) return 404
      throw error
    }
  }

  async move(sourcePath, destinationPath) {
    const destination = this.url(destinationPath).toString()
    const response = await this.request('MOVE', sourcePath, {
      headers: { destination, overwrite: 'T' },
    })
    return response.status
  }
}