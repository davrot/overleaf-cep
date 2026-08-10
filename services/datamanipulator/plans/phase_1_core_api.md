# Phase 1: Core API Implementation Plan

## Overview
Implement the core file operations (list, read, write) with binary detection, checksum calculation, and metadata generation using Overleaf's `defaultTextExtensions` from config.

## Files to Create/Modify

### 1. `/services/datamanipulator/app/src/textExtensions.mjs` (NEW)
Primary module for text extension handling. Load from Settings at module import:

```javascript
import Settings from '@overleaf/settings'

export function getTextExtensions(): Set<string>
export function isTextExtension(filepath: string): boolean
export function validateSettings(): void
```

### 2. `/services/datamanipulator/app/src/fileUtils.mjs` (MODIFY)
Generate metadata for files with binary detection:

```javascript
import { detectFileType } from './textExtensions.mjs'

export async function getMetadata(filepath: string, buffer: Buffer): Promise<{
  relative_path: string,
  name: string,
  type: 'file'|'directory',
  size: number,
  checksum?: string,
  etag?: string,
  mtime: string
}>

// Calculate ETag (checksum|mtime) for conflict detection
export function calculateEtag(buffer: Buffer, mtime: Date): string
```

### 3. `/services/datamanipulator/app/src/fileOperations.mjs` (MODIFY)
Core file operations using fs/promises:

```javascript
import { getMetadata } from './fileUtils.mjs'

export async function walkTree(projectDir: string): Promise<{
  entries: Array<FileEntry>,
  totalFiles: number,
  totalSize: number
}>

export async function readFile(projectDir: string, path: string): Promise<{
  content_base64: string,
  ...FileMetadata
}>

export async function writeFile(
  projectDir: string,
  path: string,
  content: Buffer|string
): Promise<FileEntry>
```

### 4. `/services/datamanipulator/app/src/server.mjs` (NEW)
Express server with API endpoints:

```javascript
app.get('/tree?project_id=X')      // Full tree export
app.get('/files?project_id=X&path=Y')  // Directory listing
app.get('/file?project_id=X&path=Y')   // Single file read
app.post('/file?project_id=X&path=Y')  // Write file
app.delete('/file?project_id=X&path=Y') // Delete file
```

## Implementation Order

1. **Day 1**: 
   - Create `textExtensions.mjs` with Settings loading
   - Unit tests for extension detection
   
2. **Day 2**:
   - Implement `getMetadata` with binary detection
   - Add unit tests for checksum/etag calculation
   
3. **Day 3**:
   - Implement `walkTree`, `readFile`, `writeFile`
   - Add file operations tests
   
4. **Day 4**:
   - Set up Express server with all endpoints
   - Test each endpoint individually

## Test Plan (Vitest - Overleaf's unit test framework)

### Unit Tests (`test/unit/`)

#### `textExtensionDetection.test.js`
1. Settings loaded at startup (non-empty set)
2. tex extension returns true
3. Unknown extension returns false
4. Case-insensitive comparison

#### `fileUtils.test.js`
1. ETAG = "checksum|mtime" format
2. Same content produces same checksum
3. Binary detection via null bytes
4. UTF-8 decode validation

#### `fileOperations.test.js`
1. walkTree lists all files with correct metadata
2. readFile returns base64 for binary, UTF-8 for text
3. writeFile creates parent directories
4. deletePath removes files and directories recursively

### Integration Tests (`test/integration/`)

#### `syncWorkflow.test.js`
Full end-to-end sync workflow without human intervention:
1. Create test project via file system
2. Export tree → verify all metadata fields
3. Modify a file → export again → detect change
4. Binary file integrity preserved (PNG checksum matches)

## Acceptance Criteria

- [ ] All text extensions from Settings.textExtensions recognized
- [ ] Unknown extensions fall back to binary detection
- [ ] Checksums are consistent (SHA256)
- [ ] ETags include both checksum and mtime
- [ ] Unit tests pass with 100% coverage
- [ ] Integration test workflow completes successfully
