# Slice C — Dropbox backend fixes — DONE (2026-08-15)

Files changed (this slice): `DropboxRouter.mjs`, `DropboxClient.mjs`,
`app/models/dropboxSyncProjectStates.mjs` (model extension was explicitly sanctioned
for C1's `conflicts` field; the hard two-file list did not foresee the
mongoose-strict stripping of unschemaed subdoc fields).

## Task results (priority order)
1. **C1 local-change gate — DONE.**
   - `localHash` (sha256 hex) persisted per file in `state.remoteFiles[]` (new optional
     schema field): set on push (`uploadProjectToDropbox` returns `localHashes` keyed
     `"/<path>"`, merged into the persisted remoteFiles by BOTH link and push routes),
     set on every pull-apply (hash of the EXACT applied bytes), carried forward for
     ARC-09-skipped files, set on conflict-resolution keep-remote/keep-local.
   - Pull gate (`importProjectFromDropbox`): rev-changed file + stored `localHash` +
     current local hash != stored → **NOT applied**; conflict `{path, remoteRev,
     localHash, remoteHash:null, at}` recorded (state `conflicts[]` + response +
     `mergeStatus:'conflict'`, `lastConflict` filled). Local absent → apply (safe).
     No baseline (first sync) → apply.
   - `importNewProjectFromDropbox` (import-into-existing-project): if local content
     exists for a path → conflict, never clobber (conservative; no baseline existed).
   - Binary local hash = filestore `hash` (content-addressed sha256 — assumption noted).
2. **H6 disconnect scoping — DONE.** `deleteMany({ path, ownerId: userId })`.
   State docs carry `ownerId` (always set at link), not `userId`; legacy docs without
   it are intentionally left in place (never delete another user's link on path match).
3. **U3 full path — DONE (mostly pre-existing).** `/project/:id/dropbox/state` already
   returned `projectPath` (DBX-14). Added: `projectName`+`projectPath` stored on the
   state doc at link time; `/user/dropbox/status` now returns a `projects[]` array
   (projectId, path, projectName, projectPath, lastSyncAt, lastSyncError); legacy
   top-level fields preserved.
4. **H16 conflict resolution — DONE.** keep-local: records `localHash` of current local
   content + remote rev from the conflict entry into the remoteFiles entry (ARC-09
   sees it as synced; next push publishes local). keep-remote: force-applies, stores
   hash of what was written + latest remote rev (project-folder re-listing — first
   draft used the file's parent dir, fixed), drops the resolved path from `conflicts`
   (keeps others); both return `conflicts`. Target path falls back to
   `lastConflict.path` / `conflicts[0].path` when the request omits `filePath`.
5. **D2 filter — DONE.** `isSyncExcluded()` exported from DropboxClient.mjs (hidden
   components, aux/log/out/toc/fls/idx/vrb, `*.synctex.gz`), applied in: push upload
   (docs+files), pull/both-imports (remote entries), `getDropboxRemoteFiles` (persisted
   listings + push deletion-reconciliation input), `/files` display listing.
   ARC-09 rev gate untouched. 18-case functional test passed (see commands).
6. **H5 link rollback — DONE.** Link captures `statePreExisted`; failed
   `uploadProjectToDropbox` deletes the state doc ONLY if this request created it
   (`deleteOne({ projectId, ownerId: userId })`), then rethrows; pre-existing links
   untouched.

## State-doc fields added (optional, backward-compatible)
`remoteFiles[].localHash`, `conflicts[] {path,remoteRev,localHash,remoteHash,at}`,
`projectName`, `projectPath`, `lastConflict.localHash`.

## Acceptance
- node --check: all 3 files OK
- eslint --max-warnings 0: all 3 files OK
- isSyncExcluded: 18/18 cases pass (incl. `out` alone=keep, `result.out`=exclude,
  `node_modules/x.js`=keep, hidden dir components=exclude)
- C1 gate re-read: changed-rev + local-edited → conflict recorded, NOT applied, in
  state + response.

## Residual risks
- Binary local-hash relies on Overleaf filestore `hash` == sha256 of bytes (safe
  direction: false mismatch → spurious conflict, never clobber).
- keep-remote `latestRev` requires a successful project-folder listing; falls back to
  the recorded conflict rev (entry still gets localHash).
- Pull gate requires `getAllDocs/getAllFiles` (2 mongoose reads per pull/import; cheap).
- `conflicts[]` accumulates across resolutions only via explicit removal — stale entries
  for files later deleted locally persist until next successful resolution/pull; harmless
  (UI can list them) but not auto-pruned.
