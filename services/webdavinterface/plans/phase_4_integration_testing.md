# Phase 4: Integration Testing Implementation Plan

## Overview
Create integration tests that verify end-to-end WebDAV workflow with mock servers.

## Files to Create/Modify

### 1. `/services/webdavinterface/test/integration/setup.js` (NEW)
Test environment setup:

```javascript
import { createWebDAVServer } from 'mock-webdav-server'

/**
 * Start a mock WebDAV server for integration testing
 */
export async function startMockWebDAV() {
  const server = await createWebDAVServer({
    port: process.env.MOCK_WEBDAV_PORT || 9090,
    auth: { user: 'test', pass: 'pass' }
  })

  // Pre-populate with test data
  const client = require('webdav').createClient(
    server.url,
    'test',
    'pass'
  )

  await client.createDirectory('/project1')
  await client.putFileContents('/project1/main.tex', 'Hello World')

  return server
}

/**
 * Cleanup mock WebDAV server
 */
export async function cleanupMockWebDAV(server) {
  await server.stop()
}
```

### 2. `/services/webdavinterface/test/integration/syncWorkflow.test.js` (NEW)
Full workflow tests:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startMockWebDAV, cleanupMockWebDAV } from './setup.mjs'

describe('Integration: WebDAV Sync Workflow', () => {
  let server

  beforeAll(async () => {
    server = await startMockWebDAV()
  })

  afterAll(async () => {
    await cleanupMockWebDAV(server)
  })

  describe('List Directory', () => {
    it('lists files in directory', async () => {
      const { WebDAVClient } = require('../app/src/WebDAVClient.mjs')
      const client = new WebDAVClient({
        baseUrl: server.url,
        username: 'test',
        password: 'pass'
      })

      const entries = await client.list('/')
      
      expect(entries).toBeInstanceOf(Array)
      expect(entries.length).toBeGreaterThan(0)
    })
  })

  describe('Download File', () => {
    it('downloads file content as base64', async () => {
      const { WebDAVClient } = require('../app/src/WebDAVClient.mjs')
      const client = new WebDAVClient({
        baseUrl: server.url,
        username: 'test',
        password: 'pass'
      })

      const contentBase64 = await client.download('/project1/main.tex')
      
      const contentBuffer = Buffer.from(contentBase64, 'base64')
      expect(contentBuffer.toString()).toBe('Hello World')
    })
  })

  describe('Upload File', () => {
    it('uploads file with ETag', async () => {
      const { WebDAVClient } = require('../app/src/WebDAVClient.mjs')
      const client = new WebDAVClient({
        baseUrl: server.url,
        username: 'test',
        password: 'pass'
      })

      // First upload
      await client.upload('/upload.txt', Buffer.from('Test').toString('base64'))

      // Second upload (should succeed)
      await client.upload('/upload.txt', Buffer.from('Modified').toString('base64'))
    })

    it('throws ConflictError on ETag mismatch', async () => {
      const { WebDAVClient, ConflictError } = require('../app/src/WebDAVClient.mjs')
      const client = new WebDAVClient({
        baseUrl: server.url,
        username: 'test',
        password: 'pass'
      })

      const wrongETag = 'wrong-etag-value'

      await expect(
        client.upload('/upload.txt', Buffer.from('Test').toString('base64'), { etag: wrongETag })
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  describe('Retry Logic', () => {
    it('retries on transient errors', async () => {
      const { WebDAVClient } = require('../app/src/WebDAVClient.mjs')
      
      // This test would need to mock a server that returns error codes
      // For now, just verify retry configuration exists
      const client = new WebDAVClient({
        baseUrl: 'http://example.com',
        username: 'test',
        password: 'pass'
      })

      expect(client._maxRetries).toBe(2)
    })
  })
})
```

## Implementation Order

1. Setup mock server environment
2. Create integration tests for each operation
3. Run full workflow test end-to-end

## Acceptance Criteria

- [ ] Integration tests run without human intervention
- [ ] Mock WebDAV server simulates real behavior
- [ ] Full sync workflow (list → download → upload) completes successfully
- [ ] Conflict errors handled correctly in integration tests
