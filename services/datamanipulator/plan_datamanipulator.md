# DataManipulator Microservice Design Plan

## Overview

Create a reusable microservice at `/services/datamanipulator` that provides file tree operations (list, read, write) with automatic binary detection and metadata for sync operations. This service should be consumable by any sync module (WebDAV, GitHub, custom) without needing to handle file type specifics.

## Core Principles

1. **Text extension configuration**: Load Overleaf's `defaultTextExtensions` from config at startup (not hardcoded)
2. **Binary-agnostic**: Handle both text and binary files transparently
3. **Metadata-rich**: Include checksums, modification times for diff detection
3. **Sync-ready**: Provide data structure optimized for merge/conflict resolution
4. **Testable**: Automated test suite (no human intervention required)

---

## Service Interface

### Endpoints

```
GET  /files?project_id={id}&path={relative_path}  - List files/directories
GET  /file?project_id={id}&path={relative_path}   - Get file content + metadata
POST /file?project_id={id}&path={relative_path}   - Write/create file
DELETE /file?project_id={id}&path={relative_path} - Delete file/folder
POST /tree?project_id={id}                        - Get full project tree
POST /compare                                     - Compare two trees (for merge)
```

### Request/Response Format

#### List Files (`GET /files`)
```json
{
  "project_id": "abc123",
  "path": "/subfolder/",
  "files": [
    {
      "name": "main.tex",
      "type": "file",
      "size": 1234,
      "binary": false,
      "relative_path": "subfolder/main.tex",
      "checksum": "sha256:abc123...",
      "mtime": "2024-08-09T12:00:00Z"
    },
    {
      "name": "figures",
      "type": "directory",
      "relative_path": "subfolder/figures"
    }
  ]
}
```

#### Get File (`GET /file`)
```json
{
  "project_id": "abc123",
  "path": "main.tex",
  "content_base64": "...",  // Base64-encoded for binary safety
  "size": 1234,
  "binary": false,
  "checksum": "sha256:abc123...",
  "mtime": "2024-08-09T12:00:00Z"
}
```

#### Compare Trees (`POST /compare`)
```json
{
  "left_tree": { /* full tree from project A */ },
  "right_tree": { /* full tree from project B */ }
}

// Returns:
{
  "conflicts": [ ...Array of files with different checksums ],
  "only_in_left": [ ...Files only in left tree ],
  "only_in_right": [ ...Files only in right tree ],
  "identical": [ ...Files unchanged between both ]
}
```

---

## File Metadata Requirements for Sync

### Essential Metadata (For All Files)
| Field | Purpose |
|-------|---------|
| `relative_path` | Unique identifier within project |
| `size` | Quick comparison, progress indicators |
| `checksum` | Detect content changes (SHA256) |
| `mtime` | Last modification time (fallback when checksum matches) |

### Sync-Optimized Metadata
For efficient sync operations, include:

| Field | Purpose |
|-------|---------|
| `etag` | Weak ETag for HTTP caching (format: `"version-timestamp"`). Use `SHA256(content)|mtime` combination |
| `text_file` | Inferred from extension: uses Overleaf's `defaultTextExtensions` list |

### Optional but Recommended
| Field | Purpose |
|-------|---------|
| `binary` | Boolean: whether file is binary (avoids text processing errors) |
| `encoding` | For text files: UTF-8, Latin-1, etc. |
| `depth` | Directory nesting level (for tree visualization) |

---

## File Type Detection

### Text Files Classification (Overleaf-CEP Definitive)

Files are classified as **text** if their extension matches Overleaf's `defaultTextExtensions` from `services/web/config/settings.defaults.js`:
```
tex, latex, sty, cls, bst, bib, bibtex, txt, tikz, mtx, rtx, md,
asy, lbx, bbx, cbx, m, lco, dtx, ins, ist, def, clo, ldf, rmd, qmd,
lua, py, gv, mf, yml, yaml, lhs, lean, lean4, hs, mk, xmpdata, cfg, rnw, ltx, inc
```

**All other file types are considered binary.** This classification is authoritative and should be loaded from `Settings.textExtensions` at startup time.

---

## ETag Strategy for Sync Operations

For sync modules to efficiently detect changes without re-downloading, include ETags:

### ETag Format
```
ETag = "<checksum>|<mtime>"
Example: "sha256:abc123...|2024-08-09T12:00:00Z"
```

### Why ETag Instead of Just Checksum?
1. **Modified time precision**: Checksums don't detect file moves/rename operations
2. **HTTP caching**: ETags are standard for conditional requests (`If-None-Match`)
3. **Conflict detection**: When `remote_etag != local_etag`, both versions need review

### Sync Operation Flow
```
1. Client sends: GET /tree?project_id=X
   Server responds with: { entries: [{ relative_path, checksum, mtime, etag }] }

2. On modify: PUT /file?path=x.tex (with If-None-Match header containing remote_etag)

3. If etags match → overwrite allowed (no conflicts)
4. If etags differ → conflict detected (both versions need review)


### Overleaf-CEP Text Extensions (Authoritative)

All extensions in `services/web/config/settings.defaults.js` `defaultTextExtensions` are treated as **text files**:
```
tex, latex, sty, cls, bst, bib, bibtex, txt, tikz, mtx, rtx, md,
asy, lbx, bbx, cbx, m, lco, dtx, ins, ist, def, clo, ldf, rmd, qmd,
lua, py, gv, mf, yml, yaml, lhs, lean, lean4, hs, mk, xmpdata, cfg, rnw, ltx, inc
```

**All other file types are considered binary by default.**

### Binary Detection Strategy

For unknown extensions (not in the text list), use content-based heuristics:

1. **Content scan**: Read first N bytes
2. **Null byte check**: >5% null = binary
3. **UTF-8 validation**: If invalid, try Latin-1
4. **Fallback**: Any non-text is binary

---

## Test Strategy

### Unit Tests (`test/unit/`)
Test using Vitest (Overleaf's unit test framework with `vitest run`).

1. **textExtensionDetection.test.js**
   - Verify `Settings.textExtensions` is loaded at startup
   - Test each extension in Overleaf's default list returns text type
   - Unknown extensions fall back to binary detection

2. **binaryDetection.test.js** (content-based)
   - Null byte detection (>5% null = binary)
   - UTF-8 decode validation
   - Latin-1 fallback for valid byte sequences

3. **treeNavigation.test.js**
   - List root directory contents
   - Recurse into nested directories
   - Skip `node_modules` and hidden directories
   - Handle missing paths gracefully

4. **fileOperations.test.js**
   - Read text file (UTF-8)
   - Read binary file as base64-encoded buffer
   - Write new file with correct encoding
   - Overwrite existing path
   - Delete file and directory (recursive)

### Integration Tests (`test/integration/`)
Test full sync workflows:

1. **syncWorkflow.test.js** (Automated, no human intervention)
   ```
   Setup:
   - Create test project with known files
   - Upload: main.tex, references.bib, figures/diagram.png
   
   Test 1: Full Tree Download
   - Get /tree?project_id=X
   - Verify all files present with correct checksums
   - Verify mtime is set
   
   Test 2: Incremental Update (simulated sync)
   - Modify main.tex on "remote"
   - Get updated tree
   - Compare checksums → detect change
   - Download only changed files
   
   Test 3: Conflict Detection
   - Project A has file with checksum X
   - Project B (different source) has same path but checksum Y
   - /compare returns conflict for this file
   
   Test 4: Binary File Sync
   - Upload PNG image to "remote"
   - Download viaDataManipulator
   - Verify checksum matches original
   ```

2. **edgeCases.test.js**
   - Empty project (no files)
   - Project with nested directories (depth > 5)
   - Filenames with special characters (spaces, unicode)
   - Files over 10MB (memory limits)

### Mocking Strategy

Use Docker Compose to run tests against:
- **Local file system** (mock "remote")
- **Temporary container** with webdav server
- **Mock S3/GitHub API** for integration tests

---

## Implementation Plan

All tests use **Vitest** (Overleaf's unit test framework): `yarn test` runs `vitest run`

### Phase 0: Configuration Integration (Priority)
1. [ ] Import and cache `Settings.textExtensions` at service startup
2. [ ] Create utility module `textExtensions.mjs` with exported functions:
   - `getTextExtensions(): Set<string>` - Returns cached text extensions set
   - `isTextExtension(filepath): boolean` - Checks extension against text list
3. [ ] Unit test verifies dynamic config loading (mock Settings during tests)

**Note:** Do NOT hardcode text extensions - always use Settings.textExtensions from Overleaf config.
This ensures sync service stays in sync if Overleaf updates its text file list.
### Phase 1: Core API (`/services/datamanipulator`)
**Tests:** `test/unit/fileUtils.test.js`, `test/unit/treeCompare.test.js`
1. [ ] File tree listing with metadata (Vitest unit tests)
2. [ ] Binary detection (extension + content) - use Settings.textExtensions
3. [ ] File read/write operations (unit tests for text and binary)
4. [ ] Checksum calculation (SHA256) - unit test edge cases

### Phase 1.5: Integration Tests (`test/integration/`)
**Tests:** `test/integration/syncWorkflow.test.js` (Vitest + mock web server)
1. [ ] Full tree export/import workflow
2. [ ] Incremental sync with checksum comparison
3. [ ] Conflict detection when same path differs

### Phase 2: Compare/Merge
1. [ ] Tree comparison algorithm
2. [ ] Conflict detection by checksum
3. [ ] Change summary generation

### Phase 3: Synchronization Helpers
1. [ ] "Pull" - download only changed files
2. [ ] "Push" - upload local changes to remote
3. [ ] Incremental sync state tracking

---

## Data Structures Reference

```typescript
interface FileEntry {
  relative_path: string          // e.g., "main.tex", "figures/logo.png"
  name: string                   // Final path component
  type: 'file' | 'directory'
  size: number                   // Bytes
  checksum?: string              // "sha256:hexdigest..."
  mtime?: string                 // ISO 8601 timestamp
  binary: boolean                // Auto-detected
  encoding?: string              // For text files ("utf8", "latin1")
}

interface FileTree {
  project_id: string
  root_path: string
  entries: FileEntry[]
  total_files: number
  total_size: number
}
```

---

## Notes

- **Memory management**: Stream large files instead of loading entirely
- **Caching**: Checksums can be cached to avoid recomputation
- **Permissions**: Respect read-only flag on directories/files
- **Symlinks**: Either resolve or reject (configurable)

---

## Running Tests

The service uses **Vitest** (same as the Overleaf web app). Run tests with:

```bash
yarn test                       # All unit and integration tests
yarn test:watch                 # Watch mode for development
yarn test:unit                  # Unit tests only
yarn test:integration           # Integration tests only
```

Tests are written in MJS format using ES modules.
