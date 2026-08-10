# Phase 1: List & Download Implementation Plan

## Overview
Implement directory listing and file download operations. Extract metadata including ETags from WebDAV responses.

## Files to Create/Modify

### 1. `/services/webdavinterface/app/src/multistatus.mjs` (NEW)
Parse WebDAV multistatus XML responses:

```javascript
/**
 * Parse WebDAV multistatus XML into structured data
 * @param {string} xmlString - Raw XML response from server
 * @returns {Array} Array of file/directory entries with metadata
 */
export function parseMultistatus(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Invalid multistatus response')
  }

  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml')

    // Check for parse errors
    if (xmlDoc.querySelector('parsererror')) {
      throw new Error('Failed to parse WebDAV XML')
    }

    const entries = []
    const responses = xmlDoc.querySelectorAll('response')

    for (const response of responses) {
      const hrefEl = response.querySelector('href')
      if (!hrefEl) continue

      const href = hrefEl.textContent
      const path = parseHrefToPath(href)

      const etagEl = response.querySelector('getetag')
      const modifiedEl = response.querySelector('getlastmodified')
      const sizeEl = response.querySelector('getcontentlength')
      const resType = response.querySelector('resourcetype')

      entries.push({
        href,
        path: path.replace(/^\//, ''),
        isDirectory: !!resType?.querySelector('collection'),
        etag: etagEl?.textContent || null,
        modifiedAt: modifiedEl?.textContent
          ? new Date(modifiedEl.textContent).toISOString()
          : null,
        size: sizeEl ? parseInt(sizeEl.textContent, 10) : 0
      })
    }

    return entries
  } catch (error) {
    throw new Error(`Failed to parse multistatus: ${error.message}`)
  }
}

/**
 * Parse href value to local path
 * @param {string} href - Raw href from WebDAV response
 * @returns {string} Parsed path
 */
function parseHrefToPath(href) {
  try {
    const url = new URL(href)
    return url.pathname || '/'
  } catch (err) {
    // Fallback for relative paths
    return href.startsWith('/') ? href : `/${href}`
  }
}
```

### 2. `/services/webdavinterface/app/src/WebDAVClient.mjs` (MODIFY)
Add list and download methods:

```javascript
import { validateAuth, generateBasicAuthHeader } from './auth.mjs'
import logger from '@overleaf/logger'
import { parseMultistatus } from './multistatus.mjs'

export class WebDAVClient {
  constructor({ baseUrl, username, password }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.authHeader = generateBasicAuthHeader(username, password)
  }

  async list(resourcePath) {
    const response = await fetch(`${this.baseUrl}${resourcePath}`, {
      method: 'PROPFIND',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/xml',
        'Depth': '1'
      },
      body: `<propfind xmlns="DAV:"><allprop/></propfind>`
    })

    if (!response.ok) {
      throw new Error(`List failed for ${resourcePath}: ${response.status}`)
    }

    const xml = await response.text()
    return parseMultistatus(xml)
  }

  async download(resourcePath) {
    const response = await fetch(`${this.baseUrl}${resourcePath}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader }
    })

    if (!response.ok) {
      throw new Error(`Download failed for ${resourcePath}: ${response.status}`)
    }

    // Convert to base64 for compatibility with datamanipulator
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer).toString('base64')
  }

  async getContentType(resourcePath) {
    const response = await fetch(`${this.baseUrl}${resourcePath}`, {
      method: 'HEAD',
      headers: { Authorization: this.authHeader }
    })

    if (!response.ok) {
      throw new Error(`Get content-type failed for ${resourcePath}: ${response.status}`)
    }

    return response.headers.get('content-type')
  }
}

export default WebDAVClient
```

## Implementation Order

1. **multistatus.mjs**: XML parsing functions
2. **WebDAVClient.mjs**: Add list and download methods

## Test Plan (Vitest)

### `test/unit/multistatus.test.js`
- Parse valid multistatus response
- Handle empty responses
- Extract ETags, mtimes, sizes correctly

### `test/unit/WebDAVClient.test.js`
- List directory contents
- Download file content
- Get content type

## Acceptance Criteria

- [ ] Multistatus XML parses into structured entries
- [ ] ETag extraction from responses works
- [ ] Directory listing returns all files and directories
- [ ] File download returns base64-encoded content
- [ ] Content type detection works
