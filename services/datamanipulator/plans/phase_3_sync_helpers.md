# Phase 3: Synchronization Helpers Implementation Plan

## Overview
Implement high-level sync operations (pull, push) that use core file operations to keep local Overleaf project in sync with remote sources.

## Files to Create/Modify

### 1. `/services/datamanipulator/app/src/sync.mjs` (NEW)
Sync abstraction layer:

```javascript
import { compareTrees } from './treeCompare.mjs'
import { walkTree, readFile, writeFile, deletePath } from './fileOperations.mjs'

export async function pullFiles(
  localProjectDir: string,
  remoteFileList: FileEntry[]
): Promise<SyncResult>

export async function pushFiles(
  localProjectDir: string,
  remoteFileList: FileEntry[]
): Promise<SyncResult>

// Full sync with conflict detection
export async function fullSync(localTree, remoteTree): Promise<SyncSummary>
```

### 2. `/services/datamanipulator/app/src/server.mjs` (MODIFY)
Add sync endpoints:

```javascript
import { pullFiles, pushFiles } from './sync.mjs'

app.post('/pull?project_id=X')
app.post('/push?project_id=X')
app.post('/sync/full?project_id=X')
```

## Sync Operation Details

### Pull (Remote → Local)
1. Get current local tree via `walkTree`
2. Compare with remote file list via `compareTrees`
3. For each file in onlyInRemote: download to local
4. Skip files where checksum matches (identical)
5. For conflicts (both modified): add to conflicts array

### Push (Local → Remote)
1. Get current local tree via `walkTree`
2. Compare with remote file list via `compareTrees`
3. Upload local-only files and modified files
4. Track deletions from remote that don't exist locally

## Test Plan (Vitest)

### Unit Tests (`test/unit/sync.test.js`)
1. pullFiles downloads only changed files
2. pullFiles skips identical checksums
3. pushFiles uploads only modified files
4. Conflict detection with different etags
5. Empty directory handling

### Integration Tests
- Full sync workflow end-to-end
- Concurrent operations test

## Acceptance Criteria

- [ ] Pull downloads only changed files (checksum-based)
- [ ] Push uploads only changed files (checksum-based)
- [ ] Conflicts properly detected during sync
- [ ] Unit tests pass with 100% coverage for sync module
