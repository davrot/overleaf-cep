# H — cleanup + consistency — DONE

## H.1 dead code (DELETED, grep evidence)
Pre-delete grep (only self-references, no importers anywhere incl. test/ and frontend/):
- `WebdavHistoryManager`: 5 hits, all inside `app/src/WebdavHistoryManager.mjs` (JSDoc self-refs).
- `WebDavAdapter`: 2 hits, both inside `app/src/WebDavAdapter.mjs` (class def + export).
Post-delete re-grep across services/web (**0 hits**):
```
grep -rn "WebdavHistoryManager\|WebDavAdapter" services/web --include='*.mjs' --include='*.js' --include='*.ts' --include='*.tsx'  → no matches
```

## H.2 model indexes
- `dropboxSyncProjectStates`: + `index({ path: 1, ownerId: 1 })` (scoping for H6-style `{path, ownerId}` deletes). Existing `projectId` unique + `ownerId` indexes untouched.
- `webdavSyncProjectStates`: + `index({ username: 1 })`. `projectId` index **already existed** (`webdavSyncSchema.index({ projectId: 1 })`) — not duplicated. `ownerId` already indexed.

## H.3 (M10) webdav /user/webdav/status
`WebdavRouter.mjs`: the route returns `projects[0]` (Mongo order) — now client-side sorted desc by `lastSyncAt` (nulls last) before taking `[0]`. Response shape unchanged.

## H.4 (M12) githubinterface /status ahead/behind
`githubinterface/server.mjs`: replaced hardcoded `ahead: 0, behind: 0` with a real
`git rev-list --left-right --count HEAD...origin/<branch>` (via `runGit`, promisify(execFile) → `{stdout}`); parse `ahead`/`behind`. On any git failure (no `origin/<branch>` ref yet, etc.) returns `ahead: null, behind: null` (honest unknown). `branch` stays `(unknown)`-safe (null branch → nulls). No frontend/module consumers of these fields found (grep across modules + web frontend: none) — null is non-breaking.

## H.5 settings.defaults.js
Two blocks live in **different namespaces**: top-level `datamanipulator`/`webdavinterface` (~line 207) vs `apis.datamanipulator`/`apis.webdavinterface` (~line 295). Not a duplicate-key bug → NOT merged. Verified **zero consumers** of either (`Settings.datamanipulator`, `Settings.apis.datamanipulator`, etc. — no hits outside config); runtime reads `process.env.DATAMANIPULATOR_API_URL` / `WEBDAVINTERFACE_API_URL` directly (WebDAVServiceClient). Added a NOTE comment at the top-level block documenting this.

## H.6 webdav index.mjs
`logger.debug('WebDAV module ready')` was outside the enabled-gate (logged even when disabled). Moved inside the gate (after `WebdavModule = {...}`); added an else-branch logging `WebDAV module disabled (WEBDAV_ENABLED is not true)`. Router application intact.

## What I did NOT change
- Did not merge the settings.defaults blocks (different namespaces, no consumers) — comment only.
- Did not touch any sync logic, credentials, or the WebdavClient/WebDAVServiceClient pair (out of scope; WebDavAdapter's only relation was self).
- No schema field changes.

## Acceptance
- node --check: all 5 changed .mjs/.js files → OK.
- re-grep deleted files → 0 hits.
- `cd services/web && npx eslint --max-warnings 0` on all 5 changed files → exit 0, no warnings.
