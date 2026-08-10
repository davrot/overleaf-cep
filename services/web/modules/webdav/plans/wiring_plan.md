# Wiring Plan: WebDAV Interface & DataManipulator into Web Module

## Overview
Integrate the new microservices (`webdavinterface` and `datamanipulator`) into the existing `services/web/modules/webdav` implementation.

## Current Architecture (Direct Integration)
```
WebdavSync.mjs → WebdavClient.mjs → webdav npm package
```

## New Architecture (Microservices)
```
WebdavSync.mjs → DatamanipulatorService → WebdavInterfaceService → webdav npm package
                                    ↓
                               File Ops + Checksums
```

---

## Phase 0: Integration Points

### Files to Modify in `services/web/modules/webdav/`

#### 1. `/app/src/WebDAVServiceClient.mjs` (NEW)
Wrapper that uses both microservices:

```javascript
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

/**
 * Client that orchestrates datamanipulator and webdavinterface
 */
export class WebDAVServiceClient {
  constructor() {
    this.datamanipulatorUrl = Settings.services?.datamanipulator?.api_url ||
      process.env.DATAMANIPULATOR_API_URL || 'http://localhost:4001'
    
    this.webdavInterfaceUrl = Settings.services?.webdavinterface?.api_url ||
      process.env.WEBDAVINTERFACE_API_URL || 'http://localhost:4002'
  }

  async connect(projectId, credentials) {
    // Use webdavinterface to validate connection
    const response = await fetch(`${this.webdavInterfaceUrl}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_url: credentials.server_url,
        username: credentials.username,
        password: credentials.password
      })
    })

    if (!response.ok) {
      throw new Error('Failed to connect to WebDAV server')
    }

    logger.debug({ projectId }, 'WebDAV connection established via webdavinterface')
  }

  async listFiles(projectId, credentials, path = '/') {
    const response = await fetch(`${this.webdavInterfaceUrl}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_url: credentials.server_url,
        username: credentials.username,
        password: credentials.password,
        path
      })
    })

    if (!response.ok) {
      throw new Error('Failed to list files')
    }

    return response.json()
  }

  async downloadFile(projectId, credentials, remotePath) {
    const response = await fetch(
      `${this.webdavInterfaceUrl}/file?path=${encodeURIComponent(remotePath)}`,
      {
        method: 'GET',
        headers: {
          'X-Server-URL': credentials.server_url,
          'X-Username': credentials.username
        }
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to download ${remotePath}`)
    }

    const data = await response.json()
    return Buffer.from(data.content_base64, 'base64')
  }

  async uploadFile(projectId, credentials, remotePath, contentBuffer) {
    // Calculate checksum locally for verification
    const crypto = require('crypto')
    const checksum = `sha256:${crypto.createHash('sha256').update(contentBuffer).digest('hex')}`
    
    const response = await fetch(`${this.webdavInterfaceUrl}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_url: credentials.server_url,
        username: credentials.username,
        password: credentials.password,
        path: remotePath,
        content_base64: contentBuffer.toString('base64'),
        checksum
      })
    })

    if (!response.ok) {
      throw new Error(`Failed to upload ${remotePath}`)
    }

    return response.json()
  }

  async deleteFile(projectId, credentials, remotePath) {
    const response = await fetch(
      `${this.webdavInterfaceUrl}/file?path=${encodeURIComponent(remotePath)}`,
      {
        method: 'DELETE',
        headers: {
          'X-Server-URL': credentials.server_url,
          'X-Username': credentials.username
        }
      }
    )

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete ${remotePath}`)
    }

    return { success: true }
  }

  async syncProject(projectId, credentials, localFiles) {
    // Use datamanipulator to walk local tree and compute checksums
    const localTree = await fetch(`${this.datamanipulatorUrl}/tree?project_id=${projectId}`)
    
    // Compare with remote using webdavinterface
    const remoteList = await this.listFiles(projectId, credentials)
    
    // Identify changes (diff logic in datamanipulator)
    const response = await fetch(`${this.webdavInterfaceUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_tree: localTree.entries,
        remote_files: remoteList
      })
    })

    return response.json()
  }
}
```

---

## Phase 1: Update WebdavSync.mjs

#### Modify `syncProject()` function to use microservices:

```javascript
// BEFORE (current):
const client = new WebdavClient(credentials)

// AFTER:
import { WebDAVServiceClient } from './WebDAVServiceClient.mjs'
const serviceClient = new WebDAVServiceClient()
```

---

## Phase 2: Configuration

#### Update `services/web/config/settings.defaults.js`:

```javascript
// Add new services configuration
services: {
  datamanipulator: {
    api_url: process.env.DATAMANIPULATOR_API_URL || 'http://localhost:4001'
  },
  webdavinterface: {
    api_url: process.env.WEBDAVINTERFACE_API_URL || 'http://localhost:4002'
  }
}
```

#### Add to `overleafModuleExports` if needed for frontend access.

---

## Phase 3: Testing Strategy

### Integration Tests (`test/integration/`)

1. **Mock microservices** using `mock-webdav-server` + Node.js HTTP server
2. **Test WebDAVServiceClient** with mocked endpoints
3. **Full sync workflow**: Create file locally → upload via webdavinterface → verify via datamanipulator

### Acceptance Criteria

- [ ] Lint passes: `eslint --max-warnings 0`
- [ ] Unit tests pass for WebDAVServiceClient
- [ ] Integration tests confirm microservice integration works
- [ ] No changes to existing WebDAV Sync behavior (from web app perspective)

---

## Rollout Strategy

1. **Start services**: Deploy datamanipulator and webdavinterface as separate processes
2. **Opt-in migration**: New projects use microservices, existing use direct integration
3. **Monitor logs**: Watch for errors in both old and new paths
4. **Gradual migration**: Switch fully once stable

---

## Notes

- Keep backward compatibility during transition period
- Use Settings to control which path to take (microservice vs direct)
- Consider adding health check endpoints to validate connectivity
