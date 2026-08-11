# Dropbox Interface Microservice Design Plan

## Overview

Create a new microservice at `/services/dropboxinterface` that provides Dropbox API V2 communication abstractions as the counterpart to `services/datamanipulator`. This service handles all HTTP-level Dropbox API interactions, while datamanipulator focuses on file tree operations and metadata.

This follows the same architectural pattern established by `services/webdavinterface`, but adapted for Dropbox's OAuth 2.0 authentication and RESTful API design.

## Core Principles

1. **Separation of Concerns**: Dropbox interface is protocol-specific; data manipulation is generic
2. **Reusability**: Any sync module (GitHub, Dropbox, custom) can use datamanipulator without Dropbox knowledge
3. **OAuth 2.0 Security**: Use official Dropbox SDK with proper access token management
4. **Streaming Support**: Handle large files without loading entirely into memory
5. **Error Handling**: Comprehensive error mapping for different Dropbox API failure modes

---

## Service Interface (Dropbox Protocol Layer)

### Endpoints (exposed by the dropboxinterface service)

```
GET  /health                          - Health check
POST /check?access_token={token}      - Verify credentials work with Dropbox
POST /list?path={p}&access_token={t}  - List directory contents
GET  /file?path={p}&access_token={t}  - Download file (base64 encoded)
POST /file?path={p}&access_token={t}  - Upload file with ETag precondition
DELETE /file?path={p}&access_token={t} - Delete file
POST /mkdir?path={p}&access_token={t}  - Create directory
POST /move?src={sp}&dst={dp}&access_token={t}  - Move/rename file
GET  /download_stream?path={p}&access_token={t} - Download as stream (for large files)
```

### Authentication Handling

```javascript
// Dropbox uses OAuth 2.0 access tokens
{
  "access_token": "sl.YourLongAccessTokenFromDropboxOAuthFlow"
}
```

**Note**: Unlike WebDAV's username/password, Dropbox requires an OAuth 2.0 access token. This means:
- Users must authenticate via Dropbox OAuth flow first (handled by web service/frontend)
- Access tokens are long-lived or refreshable via refresh tokens
- Tokens should be stored encrypted in the database

---

## Request/Response Format

### List Directory (`POST /list`)

#### Request
```json
{
  "path": "/My Folder",
  "access_token": "sl.YourAccessTokenHere"
}
```

#### Response (similar to datamanipulator metadata format)
```json
{
  "entries": [
    {
      "relative_path": "main.tex",
      "name": "main.tex",
      "type": "file",
      "size": 1234,
      "binary": false,
      "checksum": null,
      "mtime": "2024-08-09T12:00:00Z",
      "dropbox_id": "id:abc123", // Dropbox file ID for future reference
      "rev": "3a00e6b57" // Revision metadata
    }
  ],
  "has_more": false,
  "cursor": "ZtkA4Xf..."
}
```

### Get File (`GET /file`)

#### Request (headers)
```
X-Path: main.tex
X-Access-Token: sl.YourAccessTokenHere
```

#### Response
```json
{
  "relative_path": "main.tex",
  "content_base64": "Li4u", // Base64 encoded content
  "size": 1234,
  "mtime": "2024-08-09T12:00:00Z",
  "dropbox_id": "id:abc123"
}
```

### Upload File (`POST /file`)

#### Request
```json
{
  "path": "main.tex",
  "content_base64": "Li4u",
  "mode": "overwrite", // or "add" or "update"
  "client_mtime": "2024-08-09T12:05:00Z"
}
```

#### Response (on success)
```json
{
  "relative_path": "main.tex",
  "size": 1234,
  "mtime": "2024-08-09T12:05:00Z",
  "dropbox_id": "id:abc123",
  "rev": "3a00e6b57" // Revision string for conflict detection
}
```

### Delete File (`DELETE /file`)

#### Request (headers)
```
X-Path: main.tex
X-Access-Token: sl.YourAccessTokenHere
```

#### Response
```json
{
  "success": true,
  "deleted_path": "main.tex"
}
```

---

## Integration with DataManipulator

### Architecture Flow

```
web service -> datamanipulator -> dropboxinterface
```

### Data Flow

1. **Pull from Dropbox**:
   - `dropboxinterface`: List files in root folder -> return metadata with rev (revision)
   - `datamanipulator`: Compare local tree vs remote, detect changes using rev as checksum
   - `dropboxinterface`: Download only changed files (efficient batch)
   - `datamanipulator`: Write to project directory

2. **Push to Dropbox**:
   - `datamanipulator`: Walk local tree, compute checksums
   - `datamanipulator`: Compare with remote metadata (rev), identify changes
   - `dropboxinterface`: Upload only changed files using `mode: "update"`
   - `datamanipulator`: Update local state

### Conflict Detection

Dropbox uses **revision strings** (`rev`) for file versioning:
- Format: `"3a00e6b57"` (hexadecimal hash)
- Changes to file content change the rev
- Used like WebDAV ETags for precondition checks

---

## Key Design Decisions

### 1. Revision String Handling
- Dropbox `rev` property serves as checksum equivalent
- Extract from metadata responses: `metadata.rev`
- Compare with local checksums in datamanipulator
- If rev differs from expected → upload with `mode: "update"`

### 2. Upload Modes
Dropbox API V2 supports three modes:
- `"add"`: Only add new file (fails if exists)
- `"overwrite"`: Replace existing file (default for non-conflict scenarios)
- `"update"`: Only update if rev matches (conflict detection)

**Strategy**: Use `"overwrite"` for initial sync, `"update"` with rev check for incremental updates

### 3. Streaming for Large Files
```javascript
// Use Dropbox download stream API
const response = await dbx.filesDownload({ path })
const readableStream = response.getStream()
await fs.createWriteStream(localPath).write(readableStream)
```

### 4. Retry Logic
- **Transient errors** (rate limited, temporary failures): Automatic retry with exponential backoff
- **Permanent errors** (invalid token, permission denied): Fail immediately

```javascript
// Dropbox-specific retry conditions:
if (error.status === 429 || error.error?.error === 'rate_limit_exceeded') {
  // Retry with backoff
}
```

### 5. Error Codes Mapping

| Dropbox Error | HTTP Status | WebDAV Equivalent | Meaning |
|--------------|-------------|-------------------|---------|
| `.rate_limit_exceeded` | 429 | 423 Locked | Too many requests |
| `invalid_access_token` | 401 | 401 Unauthorized | Token expired/invalid |
| `path/not_found` | 404 | 404 Not Found | File/folder doesn't exist |
| `path/parent_not_found` | 404 | 409 Conflict | Parent folder missing |
| `conflict/file` | 409 | 412 Precondition Conflic | Upload rev mismatch |

---

## Implementation Phases

### Phase 0: Core SDK Integration
- Initialize Dropbox client with official `dropbox` npm package
- Implement authentication validation
- Basic health check endpoint

### Phase 1: List & Download
- Directory listing with metadata extraction (rev, size, mtime)
- File download with content type detection

### Phase 2: Upload with Revision Control
- PUT with `mode: "update"` and rev precondition
- ConflictError on rev mismatch
- Base64 encoding/decoding helper

### Phase 3: Advanced Features
- Move/rename operations (`filesMoveV2`)
- Folder creation (`filesCreateFolderV2`)
- Streaming for large files
- Batch operations (list folderContinue, etc.)

### Phase 4: Error Handling & Retry
- Comprehensive error mapping
- Exponential backoff retry logic
- Graceful degradation

---

## Dependencies

```json
{
  "dropbox": "^10.44.0", // Official Dropbox JavaScript SDK (supports V2 API)
  "@overleaf/logger": "*"
}
```

**Why official Dropbox SDK?**
- Maintained by Dropbox
- Full TypeScript support
- Handles OAuth flows and token refresh
- Comprehensive error handling
- Active community support

---

## Test Strategy (Vitest)

### Unit Tests (`test/unit/`)
```bash
├── dropboxClient.test.mjs      # Core client operations
├── auth.test.js                # Token validation helpers
├── errors.test.js              # Error code mapping
└── upload.test.mjs             # Upload with rev checking
```

### Integration Tests (`test/integration/`)
- Mock Dropbox API server or use test sandbox account
- Test full sync workflow: list → download → upload → delete

---

## File Structure

```
services/dropboxinterface/
├── app/
│   ├── src/
│   │   ├── DropboxClient.mjs  # Core client (analog to WebDAVClient)
│   │   ├── auth.mjs           # Token validation helpers
│   │   ├── server.mjs         # Express HTTP interface
│   │   └── index.mjs          # Entry point
│   └── test/
│       ├── unit/              # Unit tests
│       └── integration/       # Integration tests
├── package.json
├── vitest.config.mjs
└── plan_dropboxinterface.md    # This document
```

---

## Dropbox API V2 Key Methods

### Files Operations
```javascript
// List folder contents
const response = await dbx.filesListFolder({
  path: '',
  recursive: false,
  include_media_info: false
})

// Download file (returns stream)
const downloadResponse = await dbx.filesDownload({ path })

// Upload file
await dbx.filesUpload({
  path: '/path/to/file.txt',
  contents: Buffer.from(content),
  mode: 'overwrite' // or 'add', 'update'
})

// Delete file
await dbx.filesDeleteV2({ path })

// Create folder
await dbx.filesCreateFolderV2({ path })

// Move/rename
await dbx.filesMoveV2({
  from_path: '/old/path',
  to_path: '/new/path'
})
```

### Metadata Access
```javascript
// Get file metadata (includes rev)
const metadata = await dbx.filesGetMetadata({ path })

// List folder with pagination
let response = await dbx.filesListFolder({ path })
while (response.has_more) {
  response = await dbx.filesListFolderContinue({ cursor: response.cursor })
}
```

---

## OAuth 2.0 Flow

The Dropbox interface **does not handle OAuth flow** — that's handled by the web service:

1. User clicks "Connect to Dropbox" in web UI
2. Web service redirects user to Dropbox OAuth consent screen
3. Dropbox returns authorization code
4. Web service exchanges code for access token (server-side)
5. Web service stores encrypted token in database
6. Web service passes token to datamanipulator/dropboxinterface

**DropboxInterface responsibility:**
- Accept valid access token as parameter
- Fail gracefully if token is invalid/expired
- Support refresh tokens (optional future enhancement)

---

## Security Considerations

1. **Token Storage**: Access tokens must be stored encrypted in database
2. **Token Validation**: Validate token format before each API call
3. **Rate Limiting**: Dropbox enforces aggressive rate limits; implement backoff
4. **Audit Logging**: Log successful operations, redact tokens in logs
5. **CORS Policy**: If exposed via HTTP, enforce strict origin validation

---

## Configuration (in services/web/config/settings.defaults.js)

```javascript
dropboxinterface: {
  api_url: process.env.DROPBOXINTERFACE_API_URL || 'http://localhost:4003',
  // Optional: Default app settings if shared across all instances
}

// Existing dropbox setting remains for web service configuration:
dropboxAppName: process.env.DROPBOX_APP_NAME,
```

---

## Acceptance Criteria

1. ✅ All unit tests pass with Vitest (target 95%+ coverage)
2. ✅ Lint passes: `eslint --max-warnings 0` with zero warnings
3. ✅ Correctly extracts Dropbox metadata (rev, size, mtime, dropbox_id)
4. ✅ Upload fails with conflict error when rev doesn't match
5. ✅ Error codes map to standardized types (see table above)
6. ✅ Handles batch listing with pagination (`filesListFolderContinue`)
7. ✅ Supports streaming downloads for large files

---

## Next Steps After Design Approval

1. Create `services/dropboxinterface/` directory structure
2. Initialize npm package and add dependency on `dropbox`
3. Implement `DropboxClient.mjs` (analog to `WebDAVClient.mjs`)
4. Implement auth helpers (`auth.mjs`)
5. Implement HTTP server endpoints (`server.mjs`)
6. Write unit tests for each module
7. Implement integration tests with mock Dropbox API
8. Update service registration in services.js if needed

---

## Comparison: WebDAV vs Dropbox Interface

| Feature | WebDAVInterface | DropboxInterface |
|---------|----------------|------------------|
| **Auth** | Basic Auth (username/password) | OAuth 2.0 (access token) |
| **Versioning** | ETags (via `getetag` property) | Revision strings (`rev`) |
| **SDK Used** | `webdav` npm package | `dropbox` npm package |
| **API Style** | REST with PROPFIND/MKCOL/LOCK | Pure RESTful JSON API |
| **Error Handling** | Standard HTTP errors | Dropbox-specific error codes |
| **Streaming** | Via webdav client streams | Via `response.getStream()` |
| **Rate Limits** | Server-dependent | Aggressive (10k calls/hour free tier) |

---

## Future Enhancements

1. **Refresh Token Support**: Handle token expiration gracefully
2. **Webhook Support**: Receive Dropbox file change notifications
3. **Batch Operations**: Efficiently sync multiple files in one request
4. **Change Detection**: Use `filesListFolderGetLatestCursor` for delta sync
5. **Team Folders**: Support team space access (.team-namespace)
6. **Paper Integration**: Sync .paper documents

---

## References

- [Dropbox Official SDK (dropbox-sdk-js)](https://github.com/dropbox/dropbox-sdk-js)
- [Dropbox API Documentation](https://www.dropbox.com/developers/documentation/http/documentation)
- [File MetadataFields in response](https://www.dropbox.com/developers/documentation/http/documentation#files-get_metadata)
- [Files Upload Documentation](https://www.dropbox.com/developers/documentation/http/documentation#files-upload)
- [WebDAV Interface Reference](../webdavinterface/plan_webdavinterface.md) (for comparison)

---

**Status**: Draft for review  
**Created**: 2024-08-10  
**Prerequisite**: Approval of architecture and dependencies
