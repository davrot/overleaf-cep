# WebDAV Interface Microservice Design Plan

## Overview

Create a microservice at `/services/webdavinterface` that provides WebDAV server communication abstractions as the counter-part to `services/datamanipulator`. This service handles all HTTP-level WebDAV protocol interactions, while datamanipulator focuses on file tree operations and metadata.

## Core Principles

1. **Separation of Concerns**: WebDAV interface is protocol-specific; data manipulation is generic
2. **Reusability**: Any sync module (GitHub, custom) can use datamanipulator without WebDAV knowledge
3. **Error Handling**: Comprehensive error codes for different WebDAV failure modes
4. **Streaming**: Support large files without loading entirely into memory

---

## Service Interface (WebDAV Protocol Layer)

### Endpoints (exposed by the webdavinterface service)

```
GET  /health                          - Health check
POST /check?server_url={url}          - Verify server connectivity
POST /list?server_url={url}&path={p}  - List directory contents
GET  /file?server_url={url}&path={p}  - Download file (base64 encoded)
POST /file?server_url={url}&path={p}  - Upload file with ETag precondition
DELETE /file?server_url={url}&path={p} - Delete file
POST /mkdir?server_url={url}&path={p} - Create directory
POST /move?src={sp}&dst={dp}          - Move/rename file within server
```

### Authentication Handling

```javascript
// All endpoints accept auth parameters:
{
  "server_url": "https://nextcloud.example.com/remote.php/dav",
  "username": "user@example.com",
  "password": "app_password_token"
}
```

### Request/Response Format

#### List Directory (`POST /list`)
```json
// Request
{
  "server_url": "...",
  "path": "/project/",
  "auth": { "username": "...", "password": "..." }
}

// Response (similar to datamanipulator metadata format)
{
  "entries": [
    {
      "relative_path": "main.tex",
      "name": "main.tex",
      "type": "file",
      "size": 1234,
      "binary": false,
      "checksum": null,  // WebDAV doesn't provide checksums directly
      "mtime": "2024-08-09T12:00:00Z"
    }
  ]
}
```

#### Get File (`GET /file`)
```json
// Response
{
  "relative_path": "main.tex",
  "content_base64": "...",
  "size": 1234,
  "mtime": "2024-08-09T12:00:00Z"
}
```

#### Upload File (`POST /file`)
```json
// Request
{
  "server_url": "...",
  "path": "main.tex",
  "content_base64": "...",
  "etag": null  // or existing ETag for precondition
}

// Response (on success)
{
  "relative_path": "main.tex",
  "size": 1234,
  "mtime": "2024-08-09T12:05:00Z"
}
```

---

## Integration with DataManipulator

### Current Architecture (WebDAV integrated into web service)
```
web service -> WebdavClient.mjs -> datamanipulator (in web module)
```

### Future Architecture (separate microservices)
```
web service -> datamanipulator -> webdavinterface
```

### Data Flow

1. **Pull from WebDAV**:
   - webdavinterface: List files on server → return metadata
   - datamanipulator: Compare with local tree, detect changes
   - webdavinterface: Download only changed files (ETag-based)
   - datamanipulator: Write to project directory

2. **Push to WebDAV**:
   - datamanipulator: Walk local tree, compute checksums
   - datamanipulator: Compare with remote, identify changes
   - webdavinterface: Upload only changed files (ETag-based)

---

## Key Design Decisions

### 1. ETag Handling
- WebDAV servers provide ETags via `getetag` property in multistatus responses
- Format: `"weak/strong" "hash-value"`
- For conflict detection, extract the hash part and compare with datamanipulator checksums
- If ETag differs from expected → 412 Precondition Failed

### 2. Streaming for Large Files
```javascript
// Use Readable streams instead of loading entire file into memory
const stream = await webdavInterface.downloadStream(serverUrl, path)
await fs.createWriteStream(localPath).write(stream)
```

### 3. Retry Logic
- Transient errors (423 Locked, 502/503/504): Automatic retry with exponential backoff
- Permanent errors (401 Unauthorized, 404 Not Found): Fail immediately

### 4. Error Codes
```javascript
// WebdavInterfaceErrorTypes enum:
const Errors = {
  SERVER_NOT_FOUND: 'SERVER_NOT_FOUND',
  AUTH_FAILED: 'AUTH_FAILED',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  CONFLICT: 'CONFLICT',  // ETag mismatch
  LOCKED: 'LOCKED',      // File locked by another process
  NETWORK_ERROR: 'NETWORK_ERROR'
}
```

---

## Implementation Phases

**Phase 0**: Core HTTP Client
- Create `webdavClient.mjs` with authenticate, request methods
- Basic GET/PUT/DELETE/MKCOL support

**Phase 1**: List & Download
- Directory listing with ETag extraction
- File download with contenttype detection

**Phase 2**: Upload with Concurrency Control
- PUT with `If-Match` precondition
- ConflictError on 412 response

**Phase 3**: Advanced Features
- Move/rename operations
- Streaming for large files
- Retry logic with backoff

---

## Test Strategy (Vitest)

### Unit Tests (`test/unit/`)
- `client.test.js`: HTTP request/response handling
- `authentication.test.js`: Auth header generation
- `errors.test.js`: Error code parsing and mapping

### Integration Tests (`test/integration/`)
- Mock WebDAV server using `mock-webdav-server`
- Test full sync workflow: list → download → upload

## Dependencies

```json
{
  "webdav": "^6.1.0",  // Reuse existing web dav client
  "@overleaf/logger": "*"
}
```

## Acceptance Criteria

1. All unit tests pass with Vitest (100% coverage target)
2. Lint passes: `eslint --max-warnings 0`
3. Correctly parses WebDAV multistatus responses
4. ETag extraction and precondition handling works
5. Error codes map to standardized types
