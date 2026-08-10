# Phase 0: HTTP Client Implementation Plan

## Overview
Implement a core HTTP client for WebDAV protocol interactions. This is the foundation for all other phases.

## Files to Create/Modify

### 1. `/services/webdavinterface/app/src/auth.mjs` (NEW)
Authentication handling:

```javascript
export function generateBasicAuthHeader(username, password) {
  const credentials = `${username}:${password}`
  return `Basic ${Buffer.from(credentials).toString('base64')}`
}

export function validateAuth(auth) {
  if (!auth || !auth.username || !auth.password) {
    throw new Error('Missing authentication credentials')
  }
}

export function sanitizeUrlForLogging(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch (err) {
    return url
  }
}
```

### 2. `/services/webdavinterface/app/src/HttpClient.mjs` (NEW)
Core HTTP client with GET/PUT/POST/DELETE/MKCOL support.

## Implementation Order

1. auth.mjs: Create authentication utilities
2. HttpClient.mjs: Implement request method with error handling

## Acceptance Criteria

- [ ] Auth header generates Base64-encoded credentials correctly
- [ ] All HTTP methods work (GET, PUT, POST, DELETE)
- [ ] Error handling maps status codes to appropriate errors
- [ ] ETag precondition works with If-Match header
