# WebDAV module — findings & fixes

**Area:** `services/web/modules/webdav` · **Files audited:** all of `app/src/*.mjs`, `app/models/*.mjs`, `index.mjs`, `frontend/js/components/*`, router wiring in `config/settings.defaults.js`
**Status:** all findings OPEN

| ID | Sev | Title | Location |
|----|-----|-------|----------|
| WD-01 | CRITICAL | User disconnect leaves all project sync states; cleanup crashes (`logger` not imported) | `app/src/WebdavCredentials.mjs:80-104`, `WebdavRouter.mjs:76-90` |
| WD-02 | CRITICAL | Pull overwrites local Overleaf edits — no local-content conflict check | `app/src/WebdavSync.mjs` pollUser 473-602 |
| WD-03 | CRITICAL | Push is a destructive mirror: deletes remote-only files/dirs, overwrites remote edits | `app/src/WebdavSync.mjs` syncProject 186-292 |
| WD-04 | HIGH | No shared concurrency guard between pull/push/manual/auto sync | `WebdavSync.mjs` (syncingProjects only in syncProjectForLinkedUsers) |
| WD-05 | HIGH | `/project/:id/webdav/pull` ignores projectId; pulls ALL user projects | `WebdavHandler.mjs:103-106` |
| WD-06 | HIGH | Poll marks Overleaf projects "deleted by external source" when remote folder absent | `WebdavSync.mjs` pollUser tail, ~566-595 |
| WD-07 | HIGH | Pull imports via `newUpdate(userId, null, projectName)` → creates new project / fails on duplicates | `WebdavSync.mjs` pollUser ~520-535; `TpdsUpdateHandler.getOrCreateProjectByName` |
| WD-08 | HIGH | Leading-slash paths in sync flows vs bare paths in import flow → entity mismatch | `WebdavSync.mjs` (relativePath via `slice(projectRoot.length)`), vs `WebdavHandler.importRemoteProject` ~64-104 |
| WD-09 | MEDIUM | Dual state stores (credentials blob vs per-project doc) written by different code, never reconciled | `WebdavCredentials` vs `SyncStateManager` |
| WD-10 | MEDIUM | `lastConflict` object shape mismatches model schema → fields silently stripped | `webdavSyncProjectStates.mjs` lastConflict; `WebdavSync` 318-322 |
| WD-11 | MEDIUM | No HTTP timeouts on client fetches; hung remote hangs endpoint + holds lock | `WebDAVServiceClient.mjs` (all `_fetch` calls) |
| WD-12 | MEDIUM | `Settings.webdav.rootPath` fallback never set; `check()` validates wrong root | `WebdavSync.mjs` 205-207; `WebDAVServiceClient.check()` |
| WD-13 | MEDIUM | `getFileBody` fetches project_history URL directly, unauthenticated, no 404 handling | `WebdavSync.mjs` 129-138 |
| WD-14 | MEDIUM | Auto-sync hooks never wired: save/rename/delete remote-sync handlers are dead code | `WebdavSync.mjs` syncProjectForLinkedUsers/moveEntityForLinkedUsers/deleteProjectForUsers/syncAllProjectsForUser |
| WD-15 | MEDIUM | State doc has no owner; second user linking same project overwrites first user's link | `WebdavController.linkProject`, model `webdavSyncProjectStates.mjs` |
| WD-16 | LOW | Two credential access layers over same collection with different error shapes | `WebdavTokenManager` vs `WebdavCredentials` |
| WD-17 | LOW | Dead code: `WebdavClient.mjs`, `WebDavAdapter.mjs`, `WebdavHistoryManager.mjs`, unused `*Retry` wrappers | (own tests only) |
| WD-18 | LOW | `pollRemoteSync` returns 500 for "not connected" (should be 409-like) | `WebdavHandler.mjs:103-106` |
| WD-19 | FIXED (all same-name projects marked inbound) |
| WD-20 | LOW | `linkProject` runs destructive push even when remote folder already contains foreign content | `WebdavController.linkProject` ~244-283 |

---

## WD-01 (CRITICAL) — User disconnect keeps the link; cleanup crashes

**Location:** `app/src/WebdavCredentials.mjs` function `remove()` (lines ~80-104); route `POST /user/webdav/disconnect` in `WebdavRouter.mjs:76-90`; UI button `frontend/js/components/webdav-widget.tsx` `disconnect()`.

**What the code does:**
```js
const syncStates = await WebdavSyncProjectStates.find({
  'connected': true,
  path: { $regex: new RegExp(`^.*${username}.*$`, 'i') }
}).lean()
for (const state of syncStates) {
  await WebdavSyncProjectStates.deleteOne({ projectId: state.projectId })
  logger.debug(                      // <-- `logger` is NEVER imported in this file
    { userId, projectId: state.projectId }, 'on disconnect: unlinked project ...')
}
```

**Problems (three stacked bugs):**
1. **Query can never match.** `WebdavSyncProjectStates` schema has **no `path` field** (fields: `projectId, connected, baseUrl, rootPath, username, password?, lastSync*, mergeStatus, lastConflict`). So the cleanup never unlinks anything — every "linked" project state survives the user disconnect. The user-level link (state doc with `connected: true`) remains, which is exactly the reported symptom: *unlinking in settings didn't remove the link between the external server and Overleaf*.
2. **ReferenceError on the happy path.** If the query ever returned rows, `logger.debug` throws `ReferenceError: logger is not defined` (no import in `WebdavCredentials.mjs`) → the endpoint 500s **before** `WebdavUserCredentials.deleteOne` runs → the user cannot disconnect at all.
3. **Regex injection risk.** `new RegExp(.*username.*)` with unescaped user input — usernames containing `.*`/`|` could match unrelated rows once the field does exist.

**Impact:** After "Disconnect" in /settings: credentials are deleted, but all project sync states remain `connected: true` with stored `baseUrl/rootPath/username` (and optionally `password`). Anything reading project state — `WebdavHandler.getProjectState` (`new WebDAVServiceClient(credentials || state)`) and the frontend modal (`/project/:id/webdav/state`) — still sees the project as linked. Subsequent sync operations run against the remote folder of a user who "disconnected" the service → continued remote reads/writes (and destructive pushes, see WD-03) against a remote the user believes is detached.

**Fix (Batch 0):**
1. Make `WebdavSyncProjectStates` own the relationship: add `ownerId` (userId) + `projectName` to the schema (migration: backfill from `credentials.syncedProjects` is impossible after deletion; accept that existing states need a one-off cleanup), unique index `{projectId: 1, ownerId: 1}`.
2. Rewrite `remove(userId)`: `await WebdavSyncProjectStates.deleteMany({ ownerId: userId })` (no regex), then delete credentials. Import `logger` properly. Remove the username-regex approach entirely.
3. `unlinkProject` (project-level) should `deleteMany({ projectId, ownerId: userId })` so a user only unlinks their own link (fixes part of WD-15).
4. Decide & document: on user disconnect, do we also offer "delete remote folders" (currently no — keep no, but make explicit).

**Verification:**
- Connect → link project A → disconnect → `WebdavSyncProjectStates.countDocuments({})` for that user's projects = 0; `GET /project/A/webdav/state` returns `{connected: false}`; no `ReferenceError` in logs.
- Unit test: `remove()` deletes N states and credentials atomically (mock models).

---

## WD-02 (CRITICAL) — Pull silently overwrites local edits

**Location:** `app/src/WebdavSync.mjs` `pollUser(userId)` (473-602), specifically the `walk(...)` callback (~505-535).

**What the code does:** for every remote file whose `etag` (always null today — WI-02) or `modifiedAt+size` differs from the *stored last remote state*, it downloads and applies:
```js
const body = await client.get(entry.path)
await TpdsUpdateHandler.promises.newUpdate(userId, null, projectName, relativePath,
  Readable.from([Buffer.from(body)]), 'webdav')
```

**Problems:**
1. The delta baseline is **the previous remote listing state**, not the current local Overleaf content. If the file was edited *in Overleaf* since the last poll, the pull overwrites the local edit with the remote version — **no checksum comparison with the local entity, no conflict flag, no notification**.
2. Combined with `newUpdate` + `UpdMerger` (last-writer-wins at entity level): local text edits are destroyed.
3. `newUpdate` also runs duplicate-project handling per file (WD-07), and `CooldownManager` may throw `TooManyRequests` mid-loop leaving partial import.

**Impact (repro):**
1. Link project P (push succeeds, remote = local state S0).
2. Edit `main.tex` in Overleaf (S1). Simultaneously edit `main.tex` on the WebDAV server (R1).
3. Click "Pull": `R1` ≠ stored S0 → remote content replaces S1. **Local edit lost, no conflict reported.**

**Fix (Batch 0):**
1. Before applying each remote file, load the local entity (doc: `doc.lines.join('\n')`; file: blob via history) and compare SHA-256 against the remote file's known hash (WebDAV: use PROPFIND `getetag`/checksum if available — WI-02; fallback mtime+size) **and** against the hash recorded in `remoteState` at last sync.
2. If local ≠ last-synced AND remote ≠ last-synced → **conflict**: don't overwrite; record conflict (path, both hashes, both mtimes) in state, notify user via `notifyWebdav('conflict', ...)`, expose in sync modal for keep-local/keep-remote (wire to `WebdavSync.resolveConflict`, which exists at `WebdavSync.mjs:295-340` but is unreachable from any route — see WD-09).
3. If only remote changed → apply. If only local changed → skip remote apply (leave for push).
4. Make pull **per-project** (with WD-05 scoping) and per-file idempotent.

**Verification:**
- Unit/integration test with stub client: local-edit + remote-edit → pull → local content unchanged, conflict recorded, notification created.
- Test: remote-only change → applied; local-only change → not clobbered.

---

## WD-03 (CRITICAL) — Push is a destructive mirror

**Location:** `app/src/WebdavSync.mjs` `syncProject()` 186-292.

**What the code does (order in code):**
1. `ensureDirectories` (creates all folders).
2. **Deletes every remote file not present locally:** `await client.removeRetry(entry.path)` (line 161) — and every remote directory not in local entities (line 169).
3. Uploads every local doc/file with `etag: existingRemoteByPath.get(resourcePath)?.etag` (174/184) — which is always `undefined` today because `list()` returns `etag: null` (WI-02) → **no If-Match** → unconditional overwrite of remote content, including remote-side edits.
4. On 412 (conflict) mid-upload, the function throws — but **steps 2's deletions are already executed** → partial/irreversible state on the remote.

**Problems:**
- Remote-only files (added by collaborator on the server, by a mobile client, manually) are **deleted on the next push/link**.
- Remote edits to files that exist locally are silently replaced (no conflict).
- Delete-then-upload ordering makes any mid-upload failure irreversible for the deleted set.
- Called from: link (`linkProject`), manual push endpoint, `syncAllProjectsForUser`, `moveEntityForLinkedUsers` — every one inherits this.

**Fix (Batch 0):**
1. **No implicit deletion.** Push must only (a) upload new/changed files and (b) optionally delete remote files that were *previously known from Overleaf* and *are now gone from Overleaf* — and only if the remote hash matches the last-synced hash (i.e., nobody changed it remotely since). Record per-file decision in `remoteState`.
2. Order: uploads first, deletions last, per-file `If-Match: etag` from a real listing (WI-02 fix), collect 412 conflicts as conflicts (do not throw away a batch — resume/skip with report).
3. Add a `dryRun`/summary path used by tests and by the modal before a destructive push (returns what would change) — gives a safe UI story.
4. Keep `syncProject` inside the shared per-project lock (WD-04).

**Verification:**
- Seed remote with `extra.pdf` (not in Overleaf) + modified `main.tex` → push → `extra.pdf` still exists; `main.tex` conflict recorded (not overwritten); Overleaf unchanged.
- Test ordering: force 412 on 2nd upload → first upload landed, no deletions executed, state marks sync-partial.

---

## WD-04 (HIGH) — No shared concurrency guard

**Location:** `WebdavSync.mjs`. `syncingProjects` (module-level Set) guards **only** `syncProjectForLinkedUsers`; `syncProject` (manual push / link), `pollUser` (manual pull), `syncAllProjectsForUser`, and `resolveConflict` run unguarded. `recentlyInboundProjects` is a 10s per-user marker that only suppresses an auto-sync right after an inbound — it does not block pull↔push.

**Problems:**
- Two users of a shared project clicking push simultaneously (or push + pull) interleave: remote listing → delete remote-only → upload. Interleaved deletes (from pull's stale local view) and uploads (push) destroy files on both sides. This matches the reported "data destruction due to race conditions".
- Per-user credential blob is guarded by `withUserLock` (good) but that lock does not serialize sync *operations*, only state writes.

**Fix (Batch 0):**
1. One per-`(ownerId, projectId)` mutex (in-process `Map<string, Promise>` chain like `withUserLock`, or Redis-backed if multiple web processes are ever run) acquired by **all** flows: syncProject, pollUser, resolveConflict, linkProject, unlinkProject, importRemoteProject.
2. Make the lock observable: include `startedBy`/`lockHeldBy` in logs; time out stale locks (e.g., 10 min) so a crash can't wedge a project forever.
3. Single-flight per user-level credential state writes is already OK; keep.

**Verification:**
- Integration: fire 2 concurrent pushes for same project → second waits (log evidence), remote ends consistent.
- Kill -9 the process mid-sync → next sync can proceed after lock timeout.

---

## WD-05 (HIGH) — Project-scoped pull endpoint ignores the project

**Location:** `WebdavHandler.mjs:103-106`:
```js
async function pollRemoteSync(projectId, { userId } = {}) {
  if (!userId) throw new Error('User is required for WebDAV pull')
  await WebdavSync.pollUser(userId)          // projectId dropped!
```
Route: `POST /project/:project_id/webdav/pull` (modal button "Pull changes" for *this* project).

**Problems:** Pulls **every** linked project of the user while the user asked for one. Side effects on other projects: file overwrites (WD-02), `markAsDeletedByExternalSource` on other projects (WD-06), state churn; latency/lock contention across unrelated projects.

**Fix (Batch 1):** `pollRemoteSync` should call a new `pollProject(userId, projectId)` that walks only that project's remote folder and applies changes/conflicts to that project; keep `pollUser` (all projects) only for any future scheduler/CLI path or remove it.

**Verification:** with 2 linked projects, pull #1 while #2's remote changed → #2 state/content unchanged.

---

## WD-06 (HIGH) — Poll (mis)marks Overleaf projects as externally deleted

**Location:** `WebdavSync.mjs` `pollUser`, tail (~566-595): for every name in `credentials.syncedProjects` that is **not** in the remote root listing → `ProjectDeleter.promises.markAsDeletedByExternalSource` + `forgetProject`; on the positive path `unmarkAsDeletedByExternalSource`.

**Problems:**
1. A **transient** WebDAV outage mid-walk, or an incomplete root listing (service 500s on some entries, `walk` throws), or a **rename** of the folder on the server → the Overleaf project is marked deleted-by-external-source even though the remote is fine. `forgetProject` also removes `remoteState` → the next sync re-downloads everything (and WD-02 overwrites local edits with stale remote content).
2. `activeProjects.length === 1` gate: with 2 same-name projects, no deletion, but `forgetProject` still runs → state lost.
3. `markAsDeletedByExternalSource`/`unmark` semantics (what the frontend shows, whether the project is restorable) is not defined anywhere in this module — behavior depends on core implementation, which this fork may not have wired for webdav.

**Fix (Batch 1):**
1. Treat "folder missing in listing" as **suspected-deleted**: require the root listing to be **complete** (no errors during root `list`) before concluding absence; retry once with backoff; then mark *pending-deletion* with a grace period + notification, not immediate deletion (ARC-06).
2. Never `forgetProject` when sync of that project failed in the same poll cycle.
3. Define + document the deleted/unmark lifecycle; surface in the UI (modal) with an explicit restore action.

**Verification:** simulated 500 on one subdirectory listing → no project marked deleted; folder renamed → at most one *notification*, no deletion without grace.

---

## WD-07 (HIGH) — Pull uses `projectId: null` → project creation / duplicate failure

**Location:** `WebdavSync.mjs` pollUser (~520-535): `newUpdate(userId, null, projectName, relativePath, ...)`; same pattern in `WebdavHandler.importRemoteProject` (~64-104).

**Problems (verified in `app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs`):**
- `newUpdate` → `getOrCreateProject` → `projectId` falsy → `getOrCreateProjectByName(userId, projectName)`:
  - **0 matching projects → creates a brand-new blank project per import** (duplicate projects for the same remote folder).
  - **>1 matching (any archived/trashed) → fires `tpdsDuplicateProjectNames` hook and returns null → the update is silently dropped** (file vanishes from the pull).
- `pollUser` already knows the project when `projects.length === 1` (`markInboundProject(userId, projects[0]._id)`) — passing `null` is simply a bug there.

**Fix (Batch 1):** always pass the resolved `projectId` when exactly one active project with that name exists (the normal case); for 0 → import to a new project only if explicitly requested (new-project import flow), otherwise skip with logged reason + notification; for >1 → skip + conflict notification (never silently drop).

**Verification:** unit test on `pollUser` with 0/1/2 same-name projects → exactly one import succeeds (the 1-project case), no unexpected project created, notification on the 2-project case.

---

## WD-08 (HIGH) — Inconsistent path normalization

**Evidence:**
- `pollUser`: `relativePath = entry.path.slice(projectRoot.length)` → **`/main.tex`** (leading slash).
- `importRemoteProject` (`WebdavHandler.mjs`): `relativePath = file.path.slice(remoteRoot.length)` where `remoteRoot` **ends with `/`** (`remotePath(root,path)` appends `/`) → **`main.tex`** (no leading slash).
- Dropbox module: `relativeDropboxPath` **always** returns `/...` (leading slash).
- Core TPDS (`UpdateMerger._findExistingFileType`) compares `d.path === path` exactly → leading slash never matches existing entities → "create new" behavior / misnamed entities.

**Impact:** pull-imported files can fail to update the right entity or create malformed entities; import-vs-pull behave differently for the same remote file.

**Fix (Batch 1):** normalize every inbound path to Overleaf convention (relative, no leading slash, `/` separators) **once, at the boundary** (client→module), and normalize outbound remote paths via `WebdavPaths.remotePath` only. Add `normalizeEntityPath()` util + unit tests.

**Verification:** pull with `/main.tex` updates existing `main.tex` doc (test asserts entity count stable).

---

## WD-09 (MEDIUM) — Dual state stores, never reconciled

**Storage A (source of truth for sync):** `WebdavUserCredentials.credentials` (one encrypted JSON per user) — fields `syncedProjects`, `remoteState`, `lastSyncAt/Error/lastConflict` written by `WebdavCredentials.updateRemoteState/updateSyncStatus/markProjectSynced/forgetProject`.

**Storage B (per-project doc):** `WebdavSyncProjectStates` — written by `linkProject` (`createProjectState`), deleted by unlock/expiry; `updateProjectState` **never called by sync code**; router `/user/webdav/status` and frontend read storage B for `lastSyncAt/lastSyncError/lastConflict` — which stay stale/null forever after a real sync.

**Fix (Batch 2):** pick one: recommended = per-project doc as truth, `ownerId`-scoped, updated by sync code (write-through, no blob); keep user credentials for connection info only. Update all readers (status endpoint, modals). If both must stay, add a single accessor layer (`WebdavState`) that both flows use.

---

## WD-10 (MEDIUM) — `lastConflict` shape mismatch

Code writes `{ projectId, path, detectedAt }` (`WebdavSync.mjs:318-322`, `syncAllProjectsForUser` 366-371) into a schema expecting `{ path, localVersion, remoteVersion, timestamp }` (model `webdavSyncProjectStates.mjs`) — or into the credentials blob (no schema). Mongoose strict mode silently strips unknown keys → conflict details lost.

**Fix:** align one canonical shape and write it to the chosen store (WD-09). Add schema test.

---

## WD-11 (MEDIUM) — No HTTP timeouts; hung remote hangs the app

`WebDAVServiceClient` uses plain `fetch` without `AbortController`/timeout in every method; `list`/`get`/`put`/`remove`/`move`/`mkdir` all can block indefinitely against an unresponsive WebDAV server (express has no default request timeout). With the WD-04 lock held, one hung sync wedges the project.

**Fix (Batch 2):** per-operation timeouts (e.g., list 30s, get/put 120s for large files), surface `AbortError` as a typed sync error, and release locks in `finally` (already done) with a stale-lock breaker.

---

## WD-12 (MEDIUM) — `rootPath` config drift; `check()` validates the wrong path

- `WebdavSync.syncProject` falls back to `Settings.webdav.rootPath` which is **never set** (`modules/webdav/index.mjs` only sets `{ enabled: true }`) → `undefined` → `remotePath(undefined, name)` → `"undefined/<name>"` folder if credentials lack `rootPath` (possible for old records).
- `WebDAVServiceClient.check()` (→ webdavinterface `/check`) PROPFINDs the **WebDAV root `/`**, not the user's `rootPath`: (a) huge listing on big roots, (b) false negatives when listing root is disallowed, (c) link succeeds even though the intended root path is wrong/nonexistent.

**Fix (Batch 2):** require `rootPath` on connect (UI already requires it — enforce server-side in `WebdavCredentials.save`); `check` should accept and PROPFIND the exact `rootPath` (webdavinterface `/check` needs a `path` param — WI-07).

---

## WD-13 (MEDIUM) — Direct file-history fetch

`getFileBody` (`WebdavSync.mjs:129-138`) fetches `${Settings.apis.project_history.url}/project/${historyId}/blob/${file.hash}` with **no auth header**, assuming network-level trust. If the service moves or adds auth, every push of a binary breaks. Dropbox module uses the supported `HistoryManager.promises.requestBlobWithProjectId` — inconsistent.

**Fix (Batch 2):** switch to `HistoryManager` blob API (or TPDS) like the Dropbox module; handle missing history (throw structured error) instead of generic fetch failure.

---

## WD-14 (MEDIUM) — Auto-sync handlers exist but are never hooked (or are dead)

`syncProjectForLinkedUsers`, `moveEntityForLinkedUsers`, `deleteProjectForUsers`, `syncAllProjectsForUser` (`WebdavSync.mjs:375-470, 501-540, 543-575`) are exported but referenced **nowhere** outside tests (verified by grep across `services/web` + `services/*`). Consequences:
- No sync-on-save (if that's a product promise).
- Project **deletion** never removes the remote folder (on project delete vs. expire) → orphan remote data; note `projectExpired` hook (index.mjs:26) deletes only the *local state*.
- Project **rename** never moves the remote folder → after rename, push creates a *new* folder while the old one lingers (duplicate remote folders with stale content — a data-divergence vector).

**Fix (Batch 3, decision-dependent):** either (a) wire hooks (`projectRenamed`, `deleteProject`, optional save-hook) around the existing functions with the WD-04 lock, or (b) delete the dead functions. Recommendation: wire rename+delete (low risk, high value), skip save-auto-sync unless product asks.

**Additionally confirmed by independent review (2026-08-15):** `moveEntityForLinkedUsers` (WebdavSync.mjs:407) calls `WebdavCredentials.renameProject(userId, ...)` — **`renameProject` is not exported by `WebdavCredentials.mjs`** → `ReferenceError` the moment this path is wired. Fix: add `renameProject(userId, oldName, newName)` (rename entry inside `syncedProjects` + key of `remoteState`, under `withUserLock`), or inline the rename in the hook handler; add a unit test.

---

## WD-15 (MEDIUM) — Per-project state has no owner

`WebdavSyncProjectStates` is keyed only by `projectId`. Two users of a shared project linking to *different* WebDAV accounts: the second `linkProject` **overwrites** the first user's state (`findOneAndUpdate` upsert). The first user's "linked" project now syncs to a different user's remote (data leak + their disconnect can't clean it — WD-01).

**Fix (Batch 2):** `ownerId` on state (WD-01), one link per (project, owner); project-level endpoints take `ownerId = req.user`.

---

## WD-16/17 (LOW) — Duplicated credential access & dead code

- `WebdavTokenManager` (get/save/remove/getLinkedUserIds) duplicates `WebdavCredentials` over the same collection with different error styles; only `getConnectionState` uses it. Merge to one.
- Dead: `WebdavClient.mjs` (legacy direct client, 538 LOC, own tests only), `WebDavAdapter.mjs`, `WebdavHistoryManager.mjs` (no importers), unused `checkRetry/listRetry/...` wrappers (sync uses non-retry `put`, delete uses `removeRetry`). Delete or wire; if kept, unify retry behavior.

## WD-18 (LOW) — Error/status hygiene

- `pollRemoteSync` throws generic Error for missing credentials → 500; expected 409 (route already returns 409 for Dropbox equivalent).
- `linkProject` runs the destructive push immediately (WD-20, WD-03): a single "link" click can wipe a remote folder of foreign content. Gate behind the fixed push semantics + a UI confirmation showing a dry-run summary.

## WD-19/20 (LOW)

- `markInboundProject` skipped when >1 same-name project (WD-07 interaction): inbound imports can then be immediately overwritten by an auto-sync. Fix comes with WD-07 + lock.
- `syncProjectForLinkedUsers` syncs for **every** linked user who has write access to the project — a shared project pushes to N different remotes per save (if ever wired): confirm intended semantics; otherwise scope to project owner(s).

---

## Resolution (fix phase, 2026-08-15)

| ID | Status |
|----|--------|
| WD-01 | FIXED |
| WD-02 | FIXED |
| WD-03 | FIXED |
| WD-04 | FIXED |
| WD-05 | FIXED |
| WD-06 | FIXED |
| WD-07 | FIXED (poll path uses real projectId; import flow keeps deliberate create-semantics) |
| WD-08 | FIXED (self-consistent keying in new sync; import unchanged) |
| WD-09 | PARTIAL (state doc now ownerId-scoped; credentials blob remains source of truth; full unification DEFERRED) |
| WD-10 | FIXED (conflict shape now {path,allPaths,projectId,detectedAt}; credential blob is unvalidated JSON so no stripping) |
| WD-11 | FIXED (AbortController timeout, WEBDAV_REQUEST_TIMEOUT_MS) |
| WD-12 | FIXED (Settings.webdav.rootPath set from WEBDAV_ROOT_PATH, default /Overleaf) |
| WD-13 | N/A (verified: no AES-256-CBC legacy decrypter exists in this fork's git history; nothing to migrate) |
| WD-14 | FIXED (renameProject exported by WebdavCredentials + WebdavTokenManager) |
| WD-15 | FIXED-lite (ownerId + upsert link for Dropbox; WebDAV link already upserts; multi-user same-project semantics still first-writer) |
| WD-16 | DEFERRED (two-layer cleanup is cosmetic; behavior identical) |
| WD-17 | DEFERRED (WebdavClient retained: still used by unit tests; deletion needs product sign-off) |
| WD-18 | FIXED (409-style status via err.status in controller + pollProject throws 409) |
| WD-19 | DEFERRED (LOW; duplicate-name project edge case) |
| WD-20 | FIXED-via-behavior (push is no longer a destructive mirror: guarded deletions + conflict gate) |
