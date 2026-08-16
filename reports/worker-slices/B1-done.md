# Slice B1 — completion note (2026-08-15)

Scope: WebdavCredentials.mjs, WebdavController.mjs, WebdavRouter.mjs (webdav module) only.

## Task results
1. B1.1/H1 — DONE. WebdavCredentials.mjs `withUserLock`: `await previous` → `await previous.catch(() => {})`; release/finally untouched. A rejected op can no longer hang later ops.
2. B1.2/H2 — DONE. Added real helper `getProjectNameFromId(projectId)` (ProjectGetter.promises.getProject, {name:1}); `listFiles` now uses it. Route handler `getProjectName` untouched (router still imports it).
3. B1.3/H5 — DONE. `linkProject`: `createProjectState` + `pushLocalChanges` wrapped; on push failure → `SyncStateManager.removeProjectState(projectId)` + `WebdavCredentials.forgetProject(userId, projectName)` (best-effort, logged), original error rethrown. No orphan "linked" state survives a failed initial push.
4. B1.4/H12 — DONE. `linkProject`: rootPath now `credentials?.rootPath || Settings.webdav?.rootPath || '/Overleaf'`; 400 only when baseUrl missing. Added `import Settings from '@overleaf/settings'`.
5. B1.5/H13 — DONE (within allowed files). The live `client.check()` lives in WebdavHandler.getProjectState (out of B1 file list), which already exposes `verifyConnection`. Controller's state handler now passes `{ userId, verifyConnection: false }` → `connected` comes from stored state only. Link/sync flows keep live verification. (listFiles still calls getProjectState live-by-default, but that endpoint performs a live remote listing anyway; left as-is per scope.)
6. B1.6/D1 — DONE. Frontend grep (webdav/js) found NO '/poll' calls → removed the `/user/webdav/poll` stub route entirely from WebdavRouter.mjs. Conflict route: controller `resolveProjectConflict` now calls `ConflictResolver.resolve(userId, projectId, path, choice)` (userId first).

## Acceptance
- node --check: all 3 files pass (CHECK_CRED_OK / CHECK_CTRL_OK / CHECK_ROUTER_OK)
- eslint --max-warnings 0 on the 3 files: ESLINT_OK

## Residual risks / notes for next slices
- CONFLICT SIGNATURE: ConflictResolver.resolve is still (projectId, path, choice) — B2 MUST change it to (userId, projectId, path, choice) and do the real sync work, otherwise conflict resolution is functionally swapped (won't crash, wrong args).
- B1.5 removed the live check on the state read path only; WebdavHandler still checks live on pull/push/link (intended).
- `listFiles`'s `getProjectName` fix depends on ProjectGetter permissions for the caller (route already gated by ensureUserCanWriteProjectContent).
