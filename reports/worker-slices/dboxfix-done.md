# dboxfix — Dropbox sync live-testing fixes (BUG1 path display, BUG2 deletion false-positive)

## BUG 2 (CRITICAL): push skipped ALL remote deletions ("remote identity changed")

### Root cause (verified in code, matches live log)
`services/web/modules/dropbox/app/src/DropboxRouter.mjs` — push route
(pre-fix line 1079 region, `webRouter.post('/project/:project_id/dropbox/push')`):

- `const remoteBeforePush = await getDropboxRemoteFiles(client, dropboxPath)`
  snapshot the **ROOT** directory (`state.path`, e.g. `Apps/Overleaf Dev` / `/`),
  while `state.remoteFiles` (stored per sync via link/pull/push, keys like
  `/main.tex` — see `getDropboxRemoteFiles` + `relativeDropboxPath`, which
  return slash-prefixed paths **relative to the project folder**) and the
  deletion guard use **project-relative** keys.
- Consequence 1 (the user's symptom): after `normalizeDropboxPathMap`,
  `remoteRemoteMap['main.tex']` was always `undefined` (real keys were
  `A5 test/main.tex`) → guard branch `!currentRemote` fired for **every**
  pending deletion → `skippedDeletions` = all files (main.tex included, even
  though its rev was unchanged), log line at old line 1079.
- Consequence 2 (latent data-safety): `uploadProjectToDropbox`'s C1 gate
  (`isConflictedLocalPush`) used the same root-level map → `currentRev`
  always undefined → the "remote changed since last sync" push gate was
  **silently disabled** (local could clobber a remote-changed file).

### Fix
1. Push route now resolves the project name and snapshots exactly the
   **project folder** `joinDropboxPath(dropboxPath, project.name)`
   (`prePushProjectPath`), so pre-push map keys line up with stored entries
   and the C1 gate works again. Not-found (folder deleted between syncs) is
   caught → empty map (safe direction: nothing deleted, conflicts recorded);
   other errors still throw.
2. Deletion decision extracted into pure, exported, unit-tested helper
   `planRemoteDeletions(storedEntries, localFilePaths, currentRemoteMap)`:
   delete ONLY when `currentRev === entry.rev`; anything else (changed,
   unknown, absent-from-listing, no baseline) → `skipped` with the current
   rev carried for conflict recording.
3. Skipped deletions are now **recorded as conflicts** (schema
   `conflicts: {path, remoteRev, localHash, remoteHash, at}` — entry
   `remoteRev` = current remote rev) and merged with upload conflicts into
   `state.conflicts` + `mergeStatus:'conflict'` + `lastSyncError`; clean runs
   clear `conflicts: []`. Response reports the merged set
   (`conflicts`/`conflictCount`/`skippedDeletions`).
4. Resolution semantics already covered by the existing
   `/conflict/resolve` route: keep-local sets `entry.rev =
   conflictEntry.remoteRev` (unblocks the deletion on the next push if
   remote is unchanged; re-guards if it changed again); keep-remote
   re-downloads the remote file into the project.

### Regression test
`services/web/modules/dropbox/test/unit/src/DropboxPushGuard.test.mjs`
(8 tests, all green):
- (a) remote unchanged → deletions proceed (incl. subdir entries);
- (b) remote modified → skipped + current rev in conflict data;
  unchanged sibling still deleted;
- locally-present files never planned;
- no-baseline entry never deleted;
- reproduction of the live incident's wrong-map shape (root-level keys) is
  still safe (all skipped) — the route fix removes the bad input itself;
- BUG1: `joinDisplayPath` cases (user incident, %20 decoding, plain sandbox
  root, empty state path).

## BUG 1: modal showed "/A5 test" instead of "Apps/Overleaf Dev/A5 test"

### Root cause
- `GET /project/:id/dropbox/state` exposed `state.path` (`/A5 test`,
  API-root relative) and `projectPath` (same join); the modal
  `dropbox-sync-modal.tsx` displayed
  `formatDropboxPath(status.projectPath || status.path || '/')`.
- The owner's configured root (`dropboxUserCredentials.path`, e.g.
  `Apps/Overleaf Dev` — the app folder the user sees in the Dropbox UI)
  was never combined into the display.

### Fix
- New pure exported helper `joinDisplayPath(rootPath, statePath)`
  (DropboxRouter.mjs): decodes percent-encoding, strips leading/trailing
  slashes, returns `<root>/<project folder>` or the state path alone when
  root is `/`/empty.
- State endpoint now also exposes `state.fullPath` (computed from the
  **owner's** credentials doc — `state.ownerId || req.user` — since
  collaborators can open the modal); existing `path`/`projectPath` kept for
  compatibility.
- Modal prefers `status.fullPath` (type updated), fallback chain unchanged.
    - Display label `dropbox_path_label: "Dropbox path"` already i18n
      (en.json:740) — no new/changed locale strings needed (the changed
      output is data, not text).

## Files changed
- `services/web/modules/dropbox/app/src/DropboxRouter.mjs`
  - `joinDisplayPath` (exported helper) — ~line 36
  - `planRemoteDeletions` (exported helper) — after `toRemoteFilesArray`
  - state endpoint: `state.fullPath` (owner credentials lookup)
  - push route: project-folder snapshot (404-tolerant), planner-driven
    deletions, conflict recording for skipped deletions, merged
    conflicts/conflictCount in state + response (explicit keys after
    `...syncResult` spread, `success: true` preserved)
- `services/web/modules/dropbox/frontend/js/components/dropbox-sync-modal.tsx`
  - type + `fullPath` preference in the "Dropbox path" line
- `services/web/modules/dropbox/package.json`
  - `"vitest": "^4.1.10"` added to dependencies (mirror of
    modules/webdav/package.json — required by lint
    import/no-extraneous-dependencies now that this module has unit tests)
- `services/web/modules/dropbox/test/unit/src/DropboxPushGuard.test.mjs` (new)

## Verification
- `cd services/web && node --check modules/dropbox/app/src/DropboxRouter.mjs` ✓
- `cd services/web && npx eslint --max-warnings 0 --format unix modules/dropbox/` → 0 problems ✓
- `cd services/web && npx vitest run --project=Parallel modules/dropbox` →
  Test Files 1 passed, Tests 8 passed (8) ✓

## Residual notes (out of scope, not touched)
- Pull-side `previousRemoteFiles` lookups already use slash keys on both
  sides (verified consistent); no change needed.
- Live DB: user may still have `dropboxsyncprojectstates` doc with
  `mergeStatus:'conflict'` from the incident (testjoe/6a73aec4... "A5
  test") — resolvable via the existing keep-local/keep-remote UI once the
  fixed build is deployed; no data repair required (skipped deletions are
  the safe direction).
- Deploy: this is web-process code → needs the next batched
  `make all` + container restart to take effect (not done here; no
  speculative rebuild per project rules).
