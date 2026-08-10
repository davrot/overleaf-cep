# Phase 3: Advanced Features Implementation Plan

## Overview
Implement advanced features: move/rename, streaming large files, and retry logic for transient errors.

## Files to Create/Modify

### 1. `/services/webdavinterface/app/src/WebDAVClient.mjs` (MODIFY)
Add streaming, retry, and advanced operations.

### 2. `/services/webdavinterface/app/src/server.mjs` (NEW)
Express server with HTTP endpoints for all operations.

## Implementation Order

1. Add retry logic to WebDAVClient
2. Add move, mkdir, delete methods  
3. Create Express server with endpoints

## Acceptance Criteria

- [ ] Move/rename files works correctly
- [ ] Directory creation handles existing directories
- [ ] File deletion works
- [ ] Retry logic retries transient errors with backoff
- [ ] Streaming download returns Readable stream for large files
