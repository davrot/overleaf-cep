# WebDAV Module Analysis

## Overview
The WebDAV module in Overleaf enables synchronization with WebDAV-compliant servers (Nextcloud, ownCloud) as an alternative to GitHub sync. This module was introduced in commit b32c84b195db8fa6ba83885886c9bbf6064343f1.

## Architecture Comparison: WebDAV vs GitHub Sync

| Aspect | GitHub Sync | WebDAV Module |
|--------|-------------|---------------|
| **Protocol** | REST API (GitHub) | WebDAV protocol |
| **Auth** | OAuth2 flow (client ID + secret) | Username/password encryption |
| **Libraries** | `@octokit/rest` (custom client) | `webdav` npm package |
| **Storage** | GitHub repositories | WebDAV directory tree |
| **Sync Model** | Git push/pull with commit tracking | Hash/ETag-based file comparison |
| **Conflict Detection** | Commit divergence detection | File hash mismatch detection |

## Module Structure

### Backend Components (`services/web/modules/webdav/app/src/`)

| File | Purpose | Key Functions |
|------|---------|---------------|
| `WebdavClient.mjs` | HTTP client wrapper for WebDAV operations using `webdav` npm library | `check()`, `list()`, `createDirectory()`, `put()`, `get()`, `remove()` |
| `WebdavHandler.mjs` | High-level sync orchestration logic | `getConnectionState()`, `getProjectState()`, `pollRemoteSync()`, `pushLocalChanges()` |
| `WebdavController.mjs` | Express endpoint handlers (wrapped with `expressify`) | API controllers for pull/push/status/conflict resolution |
| `WebdavCredentials.mjs` | Per-user credential management with locking | `get()`, `save()`, `remove()`, `markProjectSynced()` |
| `WebdavPaths.mjs` | Path manipulation utilities | `remotePath()` - builds WebDAV folder paths |
| `WebdavRouter.mjs` | Express router defining API routes | Route registration for user/project endpoints |
| `WebdavTokenManager.mjs` | Credential encryption/decryption wrapper | `getUserCredentials()`, `saveUserCredentials()`, `removeUserCredentials()` |
| `WebdavHistoryManager.mjs` | Project history API integration | `latestVersion()`, `getProjectSnapshot()`, `getProjectFileBuffer()` |
| `SyncStateManager.mjs` | MongoDB CRUD for sync states | `getProjectState()`, `createProjectState()`, `updateProjectState()` |
| `ConflictResolver.mjs` | Conflict detection and resolution logic | `detectConflict()`, `resolve()`, `getConflictingVersions()` |

### Data Models (`services/web/modules/webdav/app/models/`)

| Model | Collection | Schema Fields |
|-------|------------|---------------|
| `webdavUserCredentials` | `webdavusercredentials` | `userId: ObjectId`, `credentials: String (encrypted JSON)` |
| `webdavSyncProjectStates` | `webdavsyncprojectstates` | `projectId: ObjectId`, `connected: Boolean`, `baseUrl`, `rootPath`, `username`, `lastSyncAt`, `mergeStatus`, `lastConflict`, etc. |

### Frontend Components (`services/web/modules/webdav/frontend/js/components/`)

| File | Purpose | Context |
|------|---------|---------|
| `webdav-widget.tsx` | User settings panel widget | Global settings page (no ProjectProvider needed) |
| `webdav-integration-card.tsx` | Project integrations panel card | Project view (uses useProjectContext) |
| `webdav-logo.tsx` | SVG icon component | Logo for both widgets |
| `webdav-sync-modal.tsx` | Sync operations modal | Opens from integration card click |

### Supporting Files

| File | Purpose |
|------|---------|
| `index.mjs` | Module entry point (backend) - registers router when `WEBDAV_ENABLED=true` |
| `README.md` | User-facing documentation for setup and API usage |
| `test/unit/`, `test/integration/` | Unit and integration test files |

## Configuration & Setup

### Environment Variables

```bash
# Required to enable the module
WEBDAV_ENABLED=true

# Optional (encryption settings)
WEBDAV_TOKEN_CIPHER_PASSWORD="your-secure-password-minimum-16-chars"  # Default: auto-generated
WEBDAV_TOKEN_CIPHER_FILE="/var/lib/overleaf/data/.webdav-token-cipher.json"

# Retry behavior (default values)
WEBDAV_RETRY_COUNT=3
WEBDAV_RETRY_DELAY_MS=100
```

### Integration with Overleaf UI

The module integrates at two key points in `services/web/config/settings.defaults.js`:

```javascript
// 1. User Settings Page - Shows WebDAV configuration widget
integrationLinkingWidgets: [
  Path.resolve(__dirname, '../modules/github-sync/frontend/js/components/github-sync-widget.tsx'),
  Path.resolve(__dirname, '../modules/webdav/frontend/js/components/webdav-widget.tsx'),  // ✅ User settings
]

// 2. Project Integrations Panel - Shows WebDAV sync card in project sidebar
integrationPanelComponents: [
  Path.resolve(__dirname, '../modules/github-sync/frontend/js/components/github-integration-card.tsx'),
  Path.resolve(__dirname, '../modules/webdav/frontend/js/components/webdav-integration-card.tsx'),  // ✅ Project view
]
```

The filter logic in `integrations-panel.tsx` ensures the card only shows when enabled:

```javascript
const integrationPanelComponents = allIntegrationPanelComponents.filter(
  ({ path }) =>
    (getMeta('ol-gitBridgeEnabled') || !path.includes('git-bridge')) &&
    (getMeta('ol-ExposedSettings').githubSyncEnabled || !path.includes('github-sync')) &&
    (getMeta('ol-ExposedSettings').zoteroEnabled || !path.includes('zotero')) &&
    (getMeta('ol-ExposedSettings').webdavEnabled || !path.includes('webdav'))  // ✅ WebDAV filter
)
```

## API Endpoints

### User Connection Management (Protected: `ensureUserCanWriteProjectContent` not required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/user/webdav/status` | Get connection status and last sync info for current user |
| POST | `/user/webdav/connect` | Save WebDAV credentials (baseUrl, username, password, rootPath) |
| POST | `/user/webdav/disconnect` | Remove WebDAV connection |

**Response Example:**
```json
{
  "connected": true,
  "baseUrl": "https://nextcloud.example.com/remote.php/dav/files/alice",
  "rootPath": "/Overleaf",
  "lastSyncAt": "2026-08-15T14:32:11.000Z"
}
```

### Project Synchronization (Protected: `ensureUserCanWriteProjectContent`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/project/:id/webdav/state` | Get project's WebDAV sync state and status |
| POST | `/project/:id/webdav/pull` | Poll remote WebDAV for changes and pull into Overleaf |
| POST | `/project/:id/webdav/push` | Push local Overleaf changes to WebDAV server |
| GET | `/project/:id/webdav/files` | List files in project's WebDAV folder |
| POST | `/project/:id/webdav/link` | Link a project to WebDAV (creates sync state) |
| POST | `/project/:id/webdav/conflict/resolve` | Resolve conflict by keeping local or remote version |

### Conflict Resolution Request Body

```json
{
  "path": "/report.tex",
  "choice": "local"  // or "remote"
}
```

## Sync Process Flow

### Pull (Remote → Overleaf)

1. User clicks "Pull remote changes" in sync modal
2. `WebdavHandler.pollRemoteSync(projectId)` is called:
   - Gets project's WebDAV connection state (`rootPath`, `username`)
   - Fetches project owner's credentials from `WebdavTokenManager`
   - Builds remote path: `{rootPath}/{projectName}/`
   - Lists all files in remote folder
3. For each remote file:
   - Downloads file content and calculates SHA256 hash
   - Compares with local version hash (from project history)
   - If hashes differ, stores conflict state (both versions stored)
4. Updates `lastSyncAt` timestamp if no conflicts
5. Returns success/error status

### Push (Overleaf → Remote)

1. User clicks "Push local changes"
2. `WebdavHandler.pushLocalChanges(userId, projectId)` is called:
   - Gets current Overleaf project version via `WebdavHistoryManager`
   - Builds remote path with project name
   - For each file in project:
     - Fetches file content from history
     - Uploads to WebDAV with ETag check (optimistic concurrency)
3. Updates sync state on success
4. Returns success/error status

### Conflict Detection Strategy

- **Hash-based comparison** using SHA256 of file content
- Uses `lastSyncVersion` to know which Overleaf version was last synced
- Remote ETags are not reliable across WebDAV servers, so hashes are primary method
- When conflict detected: stores both versions in `lastConflict` field

## Security Considerations

### Credential Handling

1. **Encryption**: Credentials encrypted using `@overleaf/access-token-encryptor`
   - Configurable via `WEBDAV_TOKEN_CIPHER_PASSWORD` env var
   - Falls back to auto-generated key stored in `WEBDAV_TOKEN_CIPHER_FILE`

2. **Storage**:
   ```javascript
   {
     "userId": ObjectId,
     "credentials": "base64-encoded-encrypted-json-string"
   }
   ```

3. **Access Control**:
   - Credentials only decrypted when needed for sync operations
   - Not exposed to frontend (only baseUrl, rootPath, username shown in UI)
   - User can only access their own credentials

### Authorization

All project endpoints use `ensureUserCanWriteProjectContent` middleware:
```javascript
// From WebdavRouter.mjs
webRouter.post(
  '/project/:project_id/webdav/pull',
  ensureUserCanWriteProjectContent,  // ✅ Required write permission
  WebdavController.pullRemoteChanges
)
```

## Key Differences from GitHub Sync

| Feature | GitHub Sync | WebDAV Module |
|---------|-------------|---------------|
| **Sync Trigger** | Manual (export/import/merge) | Manual (pull/push buttons) |
| **Version Tracking** | Git commit hash | Overleaf version number + file hashes |
| **Auto-sync** | ❌ None | ❌ None (manual only) |
| **Conflict Resolution** | Manual merge workflow | Keep local/remote choice |
| **Server Requirements** | GitHub account | Any WebDAV server |

## Development & Testing

### Running Tests
```bash
# Unit tests for client logic
npm test services/web/modules/webdav/test/unit/src/WebdavClient.test.mjs

# Unit tests for sync state management
npm test services/web/modules/webdav/test/unit/src/SyncStateManager.test.mjs

# Integration tests for API routes
npm test services/web/modules/webdav/test/integration/src/WebdavRoutes.test.mjs
```

### Testing Environment Setup

1. Start local WebDAV server (e.g., using Nextcloud Docker):
   ```bash
   docker run -d --name nextcloud \
     -e OVERWRITE_HOST=nextcloud.local \
     -p 8080:80 \
     nextcloud:latest
   ```

2. Configure environment:
   ```bash
   export WEBDAV_ENABLED=true
   export WEBDAV_TOKEN_CIPHER_PASSWORD="test-password-123"
   ```

3. Connect user and link a project via UI or API

## Future Enhancements

### Possible Improvements

1. **Auto-sync option**: Add toggle for periodic polling (currently manual only)
2. **Bi-directional real-time sync**: Use WebDAV events/webhooks if supported
3. **Conflict visualization**: Show diff view when conflict detected
4. **File filtering**: Configurable include/exclude patterns
5. **Bandwidth throttling**: User-configurable upload/download limits

### Bug Tracking

| Issue | Status |
|-------|--------|
| Missing frontend import modal (ImportFromWebdav) | 📝 To implement |
| ETag handling inconsistent across servers | ⚠️ Known limitation |

## Deployment Checklist

- [ ] Set `WEBDAV_ENABLED=true` in environment
- [ ] Configure `WEBDAV_TOKEN_CIPHER_PASSWORD` (or ensure `/var/lib/overleaf/data/.webdav-token-cipher.json` persisted)
- [ ] Verify WebDAV server URL format: `https://server.tld/remote.php/dav/files/USERNAME`
- [ ] Test connection with test user credentials
- [ ] Link a test project and verify pull/push operations

## Bug Fixes Applied (Post-initial analysis)

### 1. ProjectGetter Promises Issue (Fixed)
**Problem:** `ProjectGetter.getProject` was called without `.promises` causing `TypeError [ERR_INVALID_ARG_TYPE]`

**Error Logs:**
```
TypeError [ERR_INVALID_ARG_TYPE]: The last argument must be of type function. Received an instance of Object
    at getProjectName (file:///overleaf/services/web/modules/webdav/app/src/WebdavHandler.mjs:426:40)
    at Object.pollRemoteSync (file:///overleaf/services/web/modules/webdav/app/src/WebdavHandler.mjs:113:38)
```

**Fix:** Changed all `ProjectGetter.getProject(projectId, projection)` calls to use the promise-based API:
```javascript
const projectDoc = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
```

**Files Modified:**
- `services/web/modules/webdav/app/src/WebdavHandler.mjs` (lines 113, 422)
- `services/web/modules/webdav/app/src/WebdavController.mjs` (line 162)

### 2. Unlink Project Endpoint Missing (Fixed)
**Problem:** The frontend modal tried to call DELETE `/project/:id/webdav/state` but no route existed, resulting in a 403 CSRF error because the endpoint wasn't registered.

**Error Logs:**
```
"message":"invalid csrf token","name":"ForbiddenError","code":"EBADCSRFTOKEN"
"method":"DELETE","url":"/project/6a739c84a3f83f115b507f85/webdav/state"
```

**Fix:** Added the missing unlink endpoint:
- `services/web/modules/webdav/app/src/WebdavController.mjs`: Added `unlinkProject` controller function with Express wrapper
- `services/web/modules/webdav/app/src/WebdavRouter.mjs`: Added DELETE route for unproject unlinked

```javascript
// In WebdavRouter.mjs
webRouter.delete(
  '/project/:project_id/webdav/state',
  ensureUserCanWriteProjectContent,
  WebdavController.unlinkProject
)
```

### 3. ProjectGetter Promises Consistency (Fixed)
**Problem:** The `getProjectName` function in `WebdavController.mjs` was using the old callback-style API.

**Fix:** Updated to use `ProjectGetter.promises.getProject()` consistently throughout all files.

**Files Modified:**
- `services/web/modules/webdav/app/src/WebdavHandler.mjs` (lines 113, 422)
- `services/web/modules/webdav/app/src/WebdavController.mjs` (line 162)

### 2. Unlink Project Endpoint Missing (Fixed)
**Problem:** The frontend modal tried to call DELETE `/project/:id/webdav/state` but no route existed, resulting in a 403 CSRF error because the endpoint wasn't registered.

**Error Logs:**
```
"message":"invalid csrf token","name":"ForbiddenError","code":"EBADCSRFTOKEN"
"method":"DELETE","url":"/project/6a739c84a3f83f115b507f85/webdav/state"
```

**Fix:** Added the missing unlink endpoint:
- `services/web/modules/webdav/app/src/WebdavController.mjs`: Added `unlinkProject` controller function with Express wrapper
- `services/web/modules/webdav/app/src/WebdavRouter.mjs`: Added DELETE route for unproject unlinked

```javascript
// In WebdavRouter.mjs
webRouter.delete(
  '/project/:project_id/webdav/state',
  ensureUserCanWriteProjectContent,
  WebdavController.unlinkProject
)
```

### 3. ProjectGetter Promises Consistency (Fixed)
**Problem:** The `getProjectName` function in `WebdavController.mjs` was using the old callback-style API.

**Fix:** Updated to use `ProjectGetter.promises.getProject()` consistently throughout all files.

## Related Files & References

### Core Module Files
- `/services/web/modules/webdav/index.mjs` - Module entry point
- `/services/web/modules/webdav/app/src/WebdavRouter.mjs` - API routes
- `/services/web/config/settings.defaults.js` - Integration configuration (lines 1096, 1187)

### Overleaf Infrastructure Files (for understanding context)
- `/services/web/app/src/infrastructure/ExpressLocals.mjs` - Exposes `webdavEnabled` to frontend
- `/services/web/frontend/js/features/integrations-panel/integrations-panel.tsx` - Frontend filter logic

### GitHub Sync (Point of Comparison)
- `/services/web/modules/github-sync/index.mjs`
- `/services/web/config/settings.defaults.js` (GitHub Sync integration lines)
