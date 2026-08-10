# Phase 2: Upload with Concurrency Control Implementation Plan

## Overview
Implement upload operations with ETag-based concurrency control (optimistic locking). Throw proper errors for conflicts.

## Files to Create/Modify

### 1. `/services/webdavinterface/app/src/errors.mjs` (NEW)
Custom error classes:

```javascript
/**
 * WebDAV-specific errors
 */
export class WebdavError extends Error {
  constructor(message, { status } = {}) {
    super(message)
    this.name = 'WebdavError'
    this.status = status
  }
}

/**
 * Authentication/credentials error
 */
export class AuthError extends WebdavError {
  constructor(message) {
    super(message, { status: 401 })
    this.name = 'AuthError'
  }
}

/**
 * Resource not found
 */
export class NotFoundError extends WebdavError {
  constructor(resourcePath) {
    super(`Resource not found: ${resourcePath}`, { status: 404 })
    this.name = 'NotFoundError'
    this.resourcePath = resourcePath
  }
}

/**
 * File modification conflict (ETag mismatch)
 */
export class ConflictError extends WebdavError {
  constructor(message, { expectedETag, actualETag } = {}) {
    super(message, { status: 412 })
    this.name = 'ConflictError'
    this.expectedETag = expectedETag
    this.actualETag = actualETag
  }
}

/**
 * Resource locked (another process has it open)
 */
export class LockedError extends WebdavError {
  constructor(resourcePath) {
    super(`Resource is locked: ${resourcePath}`, { status: 423 })
    this.name = 'LockedError'
    this.resourcePath = resourcePath
  }
}

/**
 * Network/transport error
 */
export class NetworkError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'NetworkError'
    this.cause = cause
  }
}
```

### 2. `/services/webdavinterface/app/src/WebDAVClient.mjs` (MODIFY)
Add upload with concurrency control:

```javascript
import { validateAuth, generateBasicAuthHeader } from './auth.mjs'
import logger from '@overleaf/logger'
import {
  AuthError,
  NotFoundError,
  ConflictError,
  LockedError,
  NetworkError
} from './errors.mjs'

export class WebDAVClient {
  constructor({ baseUrl, username, password }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.authHeader = generateBasicAuthHeader(username, password)
  }

  async upload(resourcePath, contentBase64, { etag } = {}) {
    const response = await fetch(`${this.baseUrl}${resourcePath}`, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/octet-stream'
      },
      body: Buffer.from(contentBase64, 'base64')
    })

    // Handle precondition failed (ETag mismatch)
    if (response.status === 412) {
      const serverEtag = response.headers.get('etag')
      throw new ConflictError(
        `Upload conflict for ${resourcePath}: ETag mismatch`,
        { expectedETag: etag, actualETag: serverEtag }
      )
    }

    // Map other status codes to errors
    if (response.status === 401) {
      throw new AuthError(`Authentication failed for ${resourcePath}`)
    }
    if (response.status === 404) {
      throw new NotFoundError(resourcePath)
    }
    if (response.status === 423) {
      throw new LockedError(resourcePath)
    }

    if (!response.ok) {
      throw new WebdavError(
        `Upload failed for ${resourcePath}: ${response.status}`,
        { status: response.status }
      )
    }

    logger.debug({ resourcePath }, 'WebDAV upload completed')
    return { success: true, status: response.status }
  }

  async download(resourcePath) {
    const response = await fetch(`${this.baseUrl}${resourcePath}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader }
    })

    if (!response.ok) {
      throw new WebdavError(`Download failed for ${resourcePath}: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer).toString('base64')
  }
}

export default WebDAVClient
```

## Implementation Order

1. **errors.mjs**: Create custom error classes
2. **WebDAVClient.mjs**: Add upload with ETag precondition handling

## Test Plan (Vitest)

### `test/unit/errors.test.js`
- ConflictsError includes expected and actual ETags
- NotFoundError has resourcePath property
- NetworkError wraps original error

### `test/unit/WebDAVClient.test.js` (additional tests)
- Upload without ETag: Should succeed
- Upload with matching ETag: Should succeed  
- Upload with wrong ETag: Throws ConflictError with both values
- Upload with missing resource: Throws NotFoundError

## Acceptance Criteria

- [ ] Upload succeeds when ETag is not provided or matches
- [ ] Upload fails with 412 and throws ConflictError on ETag mismatch
- [ ] ConflictError includes both expectedETag and actualETag
- [ ] Error mapping for all status codes works correctly
- [ ] Stream upload for large files (optional enhancement)
