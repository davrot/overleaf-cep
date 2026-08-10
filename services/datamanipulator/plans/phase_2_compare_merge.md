# Phase 2: Compare/Merge Implementation Plan

## Overview
Implement tree comparison for conflict detection during sync operations. Essential for identifying which files differ between local Overleaf project and remote WebDAV/other source.

## Files to Create/Modify

### 1. `/services/datamanipulator/app/src/treeCompare.mjs` (MODIFY)
Enhance existing compare function:

```javascript
export interface TreeComparison {
  conflicts: Array<{
    relative_path: string,
    local_etag: string,
    remote_etag: string
  }>,
  onlyInLocal: FileEntry[],
  onlyInRemote: FileEntry[],
  identical: Array<{ relative_path: string, etag: string }>
}

export function compareTrees(
  localTree: FileTree,
  remoteTree: FileTree
): TreeComparison

// Resolve conflict based on mtime or ask user
export function resolveConflictByMtime(left: FileEntry, right: FileEntry): 'left'|'right'|'needs_review'
```

### 2. `/services/datamanipulator/app/src/server.mjs` (MODIFY)
Add compare endpoints:

```javascript
app.post('/compare', async (req, res) => {
  const comparison = compareTrees(req.body.left_tree, req.body.right_tree)
  res.json(comparison)
})

app.post('/merge/suggestions', async (req, res) => {
  // For each conflict, suggest merge strategy based on mtime
})
```

## Implementation Order

1. **Day 1**:
   - Implement `compareTrees` with checksum comparison
   - Unit tests for comparison logic
   
2. **Day 2**:
   - Add mtime-based conflict resolution
   - Merge suggestions endpoint
   - Integration test workflow

## ETag Format for Comparison

```
ETag = "sha256:<hash>|<mtime>"
Example: "sha256:abc123...|2024-08-09T12:00:00Z"
```

To compare:
```javascript
function parseEtag(etag) {
  const [checksum, mtime] = etag.split('|')
  return { checksum, mtime }
}
```

## Conflict Detection Flow

1. Build maps for both trees by `relative_path`
2. For each path in local tree:
   - If not in remote → onlyInLocal
   - If same etag → identical
   - If different etag → conflict
3. Remaining paths in remote → onlyInRemote

## Test Plan (Vitest)

### Unit Tests (`test/unit/treeCompare.test.js`)

1. **compareTrees_empty_trees**: Both empty = all identical
2. **compareTrees_same_tree**: Identical trees = all identical  
3. **compareTrees_added_file**: File only in left = onlyInLocal
4. **compareTrees_modified**: Different etag = conflict
5. **resolveConflictByMtime_local_newer**: Local has newer mtime

### Integration Tests (`test/integration/`) 
Full sync workflow with compare step integrated.

## Acceptance Criteria

- [ ] Compare returns correct conflicts, onlyInLocal, onlyInRemote, identical
- [ ] ETag parsing extracts checksum and mtime correctly
- [ ] Mtime-based conflict resolution works (newer wins)
- [ ] Unit tests pass with 100% coverage for compare module

## Notes

- Use weak ETags per HTTP spec: `"version-timestamp"`
- Handle case where ETag is missing (fall back to checksum only)
