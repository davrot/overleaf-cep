# Slice B2 — completion note (2026-08-15)

Scope: WebdavSync.mjs, ConflictResolver.mjs, WebdavHandler.mjs, SyncStateManager.mjs (webdav module) only.

## Task results (priority order)
1. **B2.1 (C2) — DONE.** `ConflictResolver.resolve` now has signature `resolve(userId, projectId, path, choice)`. It maps `local→keep-local`, `remote→keep-remote` and calls `WebdavSync.resolveConflict(...)` (real content work: pushes/pulls the file). Only on success does it clear state via `updateProjectState(projectId, { $set: {mergeStatus:'clean', lastSyncAt, resolvedChoice}, $unset: { lastConflict:1, conflictingPaths:1 } })` — separate Mongo operators. Failures propagate (state NOT cleared). "Conflict exists" check consults BOTH the project state doc AND the user credentials doc (the sync flow records conflicts on credentials — that check used to 404 every real conflict).
2. **B2.5 (H13) — DONE.** `WebdavHandler.getProjectState` already accepted `{userId, verifyConnection}`; semantics fixed: `verifyConnection:false` no longer leaves `connected` undefined — it now derives `connected=true` from stored state (state doc existence IS the link; default=true path for link/sync flows unchanged).
3. **B2.4 (H4) — DONE.** `WebdavSync.syncProject` captures `conflictEtags[filePath]` at conflict detection and records `lastConflict.remoteEtag` (first conflict's remote etag). `resolveConflict` keep-local now passes `{ etag: conflictEtag }` to `client.put` (put supports `options.etag` → If-Match; 412 propagates if a third edit rotated the file). Conflict detection path (`ConflictResolver.detectConflict`): the buggy `$push`-inside-`$set` accumulation of `conflictingPaths` was **dropped** (frontend reads only `lastConflict`; grep confirms no readers; model schema has no such field).
4. **B2.2 (C3) — DONE.** `WebdavHandler.unlinkProject`: after removing the state doc, best-effort `WebdavCredentials.forgetProject(state.ownerId, projectName)` (project name via ProjectGetter, same import path the module uses elsewhere); wrapped in try/catch with a `C3:` log — unlink never fails because of it.
5. **B2.3 (C3/H3) — DONE.** `pollUser` per-project gate: for the single matched project it now REQUIRES both a `WebdavSyncProjectStates` doc (new `SyncStateManager` import; no cycle) AND `credentials.syncedProjects` containing the name — otherwise skips (log `C3: poller skipping unlinked project`) and cleans an orphan `syncedProjects` entry if the state doc is gone. No-phantom guard in the walk-apply path: if `sha256(remote body) === prev.localHash`, refresh the identity record and skip `newUpdate` entirely (no project update, no history churn). Put-path etag: `WebDAVServiceClient.put` returns only `{ status }` (service exposes no new etag) — left as-is with an H3 comment at the put site; the guard covers the symptom.

## Real signature found (per note requirement)
`WebdavSync.resolveConflict(userId, projectId, filePath, resolution)` with `resolution ∈ {'keep-local','keep-remote'}` — mapped from B1's `'local'/'remote'`.

## Acceptance
- node --check: all 4 files OK (WebdavSync/ConflictResolver/WebdavHandler/SyncStateManager)
- eslint --max-warnings 0 on the 4 files: ESLINT_OK
- grep: `async function resolve(userId, projectId, path, choice)` present (ConflictResolver.mjs:140)
- grep `\$unset ... \$set` same-liners: only JSDoc comment lines; code passes `$set`/`$unset` as separate top-level operators
- frontend `conflictingPaths` readers: NONE

## Residual risks / notes
- `resolve` relies on B1's controller passing `userId`; if `userId` is undefined the credentials check resolves to null (project-state conflicts still resolvable).
- `resolvedChoice` and (credentials-side) `remoteEtag` are not in the project-state Mongo SCHEMA (mongoose strict may strip `resolvedChoice` on write) — harmless: clearing still works; no reader exists (grep). If it matters later, add the field to the model schema.
- keep-remote direction does not re-record `remoteState[path]`; next poll sees unchanged remote identity (no re-conflict), next push re-puts identical content (harmless, etag-gated).
- 412 from the If-Match keep-local surfaces as a 500 with "Precondition failed for <path>" — the UI should treat that as "remote changed again, re-pull" (UI work is a later slice).
