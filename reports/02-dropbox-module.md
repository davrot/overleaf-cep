# Dropbox module — findings & fixes

**Area:** `services/web/modules/dropbox` · **Files audited:** `app/src/DropboxRouter.mjs` (876 lines, core), `DropboxClient.mjs`, `DropboxCredentials.mjs`, `app/models/*`, `index.mjs`, `frontend/js/components/*`
**Status:** all findings OPEN

| ID | Sev | Title | Location |
|----|-----|-------|----------|
| DBX-01 | CRITICAL | Push deletion calls `client.deleteFile()` — method doesn't exist; deletions silently no-op | `DropboxRouter.mjs:742` |
| DBX-02 | CRITICAL | Pull overwrites local edits; remote-file metadata (rev) computed but never used | `DropboxRouter.mjs` importProjectFromDropbox ~150-250 |
| DBX-03 | CRITICAL | Pull catches any error containing "Not found" → marks Overleaf project as deleted externally | `DropboxRouter.mjs:633-645` |
| DBX-04 | HIGH | No concurrency guard on pull/push; last-write-wins on state | DropboxRouter pull/push (596-790) |
| DBX-05 | HIGH | Unlink paths leave project states: disconnect-by-path edge cases; `expireDeletedUser` deletes credentials **before** reading them → cleanup loop never runs | `index.mjs:43-46`, `DropboxRouter.mjs:418-445` |
| DBX-06 | HIGH | Missing authorization on project-scoped endpoints → any user can push their Dropbox into any project (IDOR write) | `DropboxRouter.mjs` link/unlink/state/new-project routes |
| DBX-07 | HIGH | Token encryption: deterministic fallback key from `NODE_ENV`; raw-password key (no KDF); incompatible with WebDAV scheme | `DropboxCredentials.mjs:20-45` |
| DBX-08 | MEDIUM | Push never uses `rev` → always overwrite mode; remote edits silently clobbered | `DropboxRouter.mjs` uploadProjectToDropbox ~95-130 |
| DBX-09 | MEDIUM | `/project/new/dropbox` import uses `Readable.from` without importing `Readable` → 500 on every new-project import | `DropboxRouter.mjs:226` |
| DBX-10 | MEDIUM | No unique index on `projectId` in state schema; `link` does `new Doc(...).save()` (not upsert) → duplicate state docs per project | `dropboxSyncProjectStates.mjs`, DropboxRouter link ~470-530 |
| DBX-11 | MEDIUM | `conflict/resolve` endpoint is a stub returning success | `DropboxRouter.mjs:793-815` |
| DBX-12 | MEDIUM | Push re-uploads every file every time (no delta) — slow + overwrite amplification | uploadProjectToDropbox |
| DBX-13 | MEDIUM | Text-vs-binary classification differs between import paths (upsertDoc vs newUpdate/FileTypeManager) → encoding round-trip corruption possible | importProjectFromDropbox `isTextFile` |
| DBX-14 | FIXED (no more write-on-read in status/link/pull/files) |
| DBX-15 | LOW | `lastConflict` / `mergeStatus` never updated by any flow → conflict UI state dead | schema vs router |
| DBX-16 | LOW | No UI for choosing Dropbox `path` (only default `/`); `POST /user/dropbox/connect` body-token path has no UI | widget, connect route |
| DBX-17 | LOW | Cross-layer error matching by string `includes('Not found')` — fragile | DropboxClient._request 404 msg vs router checks |
| DBX-18 | LOW | `delete` → Dropbox trash (filesDeleteV2), not permanent; sync logic assumes gone | services/dropboxinterface DropboxClient.delete |
| DBX-19 | LOW | OAuth: PKCE not used (acceptable server-side), refresh token discarded — no re-auth path if token revoked | DropboxRouter oauth callback ~300-345 |

---

## DBX-01 (CRITICAL) — `client.deleteFile()` does not exist

**Location:** `DropboxRouter.mjs:742` inside push:
```js
await client.deleteFile(remotePath)
...
} catch (err) {
  if (!err.message?.includes('Not found')) { logger.warn(...) }
}
```
The web `DropboxClient` (app/src/DropboxClient.mjs) implements `delete(path)`, **not** `deleteFile`. Every push that would delete a remote file throws `TypeError: client.deleteFile is not a function`, the catch swallows it (message ≠ 'Not found' → just a warning), and the response still reports `deletedFiles: N` **as if they were deleted**.

**Impact:** "Sync to Dropbox" reports success; remote-only files accumulate forever; the UI/log narrative is wrong. Also every such push does N failed HTTP-less calls.

**Fix (Batch 0):**
1. Call `client.delete(remotePath)`.
2. Count only successful deletions; on non-404 failure, fail the push (or record per-file errors in `lastSyncError` + list) — never report false success.
3. Deletions must be guarded by the WD-03/DBX-08 "only delete what we know we synced and that nobody changed remotely" rule (compare rev from `state.remoteFiles`).

**Verification:** seed a Dropbox folder with an extra file → push → extra file remains (post-fix policy) OR is deleted and rev-unchanged files untouched (if policy allows); API response `deletedFiles` matches reality.

---

## DBX-02 (CRITICAL) — Pull overwrites local edits; delta data unused

**Location:** `importProjectFromDropbox` (`DropboxRouter.mjs` ~150-250).

**What the code does:** computes `remoteFiles` = `{path → {rev, size, modifiedAt}}` for every remote file (this is exactly the delta data needed), stores it in `state.remoteFiles`... **then downloads and upserts every single file unconditionally**:
```js
for (const entry of entries) {
  const result = await client.download(...)
  if (isTextFile) await EditorController.promises.upsertDocWithPath(projectId, relativePath, lines, 'dropbox', userId)
  else await EditorController.promises.upsertFileWithPath(projectId, relativePath, tempFile, null, 'dropbox', userId)
}
```
`state.remoteFiles` (previous remote revs) is **never compared** either here or in push.

**Problems:**
1. Local Overleaf edits are **silently overwritten** by remote content on every pull (repro: edit `main.tex` in Overleaf; change it in Dropbox; pull → local edit gone, no conflict).
2. Every pull re-downloads and re-writes 100% of the project (cost + churn + triggers doc re-parsing/compile).
3. `lastConflict`/`mergeStatus` never set → no conflict visibility.

**Fix (Batch 0):**
1. Delta pull: skip files where remote `rev` === `state.remoteFiles[path].rev`. For changed files: load the local entity and compare its hash against the **last-synced** hash (record hash in `remoteFiles` entries; today only rev/size/modTime are stored — add `hash`):
   - local unchanged, remote changed → apply remote.
   - both changed → **conflict** (record path, remote rev, local hash; notify; keep local; never auto-apply).
2. Use the existing `state.remoteFiles` structure (add `hash` field; schema migration is additive).
3. Stop re-upserting unchanged files; report counts (`importedFiles`, `skippedFiles`, `conflicts`).

**Verification:** 3-scenario test (local-only edit / remote-only edit / both) with fake client asserting content + conflict flags; unchanged-file pull performs 0 writes (assert via entity update count).

---

## DBX-03 (CRITICAL) — "Not found" string match destroys a live project

**Location:** `DropboxRouter.mjs:633-645` (pull):
```js
} catch (err) {
  if (!err.message?.includes('Not found')) throw err
  await ProjectDeleter.promises.markAsDeletedByExternalSource(projectId)
  ...
  return res.json({ success: true, message: 'Remote project deleted', deletedProject: true })
}
```

**Problems:**
1. `DropboxClient._request` produces `Dropbox: Not found - ${path}` for **any** 404 from the service — including 404s that are *not* "project folder gone" (e.g., transient gateway 404, mis-routed service, a rate-limit path returned as 404). One such error → Overleaf project marked deleted-by-external-source.
2. The push path (742-748) uses the same string match to decide "already absent" — any 404-shaped error is treated as success of deletion.
3. When the trigger is legitimate (folder removed in Dropbox), the code still leaves `state.connected: true` and does not tell the user what happened beyond one log line; the reverse (`unmarkAsDeletedByExternalSource`) is **never called** by the Dropbox module (it only exists on the WebDAV side) → once mis-marked, nothing recovers the project automatically.

**Fix (Batch 0):**
1. Distinguish errors with typed codes: web client should map HTTP 404 + Dropbox error path `.tag === 'not_found'` (service already parses this — `dropboxinterface` `_mapDropboxError`) into an `ErrorCode.PROJECT_NOT_FOUND` error; router checks the **code**, never the message string.
2. Only conclude "remote project deleted" when the **root folder listing** 404s (not a per-file/download 404) and a second confirming check passes.
3. On confirmed deletion: set `state.connected=false, mergeStatus='conflict'`, keep the Overleaf project **active**, send a notification ("Remote Dropbox folder for 'X' was removed — pull is paused; re-link to resume"). Decide the mark/unmark policy with core (ARC-02) instead of calling `markAsDeletedByExternalSource` blindly.

**Verification:** fault-injection test: 404 on `files/download` (folder exists) → project **not** marked deleted; 404 on root `files/list_folder` (twice) → state updated + notification, project intact.

---

## DBX-04 (HIGH) — No concurrency guard

Pull and push both: read state → N network ops → `state.updateOne({remoteFiles, lastSyncAt, lastSyncError: null})`. Two concurrent pulls (or pull+push) interleave; the last winner's `remoteFiles` wins even though its pre-state was stale; remote deletions (DBX-01 once fixed) computed from the loser's stale `state.remoteFiles` delete files the winner just synced.

**Fix (Batch 0):** same shared per-(ownerId, projectId) lock as WD-04, extended to Dropbox router flows; state writes should use MongoDB `findOneAndUpdate` keyed on `lastSyncAt`/`remoteFiles` version (optimistic) so a stale writer fails cleanly.

---

## DBX-05 (HIGH) — Unlink leaves links (reported symptom)

**Location:**
- `DropboxRouter.mjs:418-445` `/user/dropbox/disconnect`: deletes `DropboxSyncProjectStates` by `{ path: normalizedUserPath }` then deletes credentials.
  - **Gap 1:** if the stored `path` predates normalization (legacy `'Overleaf Dev'`, or `/Overleaf/Dropbox`) and equals the *stored* (unnormalized) value of some state docs, `deleteMany({path})` misses them — the very states that needed cleanup.
  - **Gap 2:** states created by other users on shared projects reference *their* paths — disconnecting user A never touches B's states (fine), but states with the same path string belonging to a **different** user are deleted by A (over-deletion) — path is not an ownership key.
  - **Gap 3:** no `ownerId` (see WD-15) → can't express "A's links" reliably.
- `index.mjs:43-46` `expireDeletedUser` hook:
```js
await DropboxUserCredentials.deleteMany({ userId })            // 43: DELETE FIRST
const credentialsList = await DropboxUserCredentials.find({ userId }) // 46: ALWAYS EMPTY NOW
for (const cred of credentialsList) { ...deleteMany({path}) }  // never executes
```
**Ordering bug:** project cleanup can never run because credentials are gone before the query.

**Impact:** after user deletion (or disconnect edge cases), `DropboxSyncProjectStates` documents survive pointing at the deleted user's Dropbox paths; other users' project-UI still shows "linked to Dropbox" and pull/push against that path will 500 on credentials-not-found — or, worse, if a remaining same-project state of another user exists, sync continues under the wrong person's Dropbox scope.

**Fix (Batch 0/2):**
1. `expireDeletedUser`: query credentials **first**, then `deleteMany` project states by `ownerId` (after WD-15/`ownerId` introduced; interim: by the stored `path` **and** `projectId` list collected before deleting credentials), then delete credentials.
2. `ownerId` on state docs + unique `(projectId, ownerId)`; disconnect deletes `{ownerId: userId}`.
3. Add an admin/recovery script `unlink-orphans`: delete states whose `ownerId` no longer exists.

**Verification:** user with 2 linked projects → `expireDeletedUser(user)` → 0 states left; disconnect in settings → 0 states left; integration test asserts both.

---

## DBX-06 (HIGH) — Missing authorization on project-scoped routes

Routes and their middleware (verified in `DropboxRouter.mjs`):
| Route | Middleware |
|---|---|
| `GET /project/:id/dropbox/state` | login only |
| `POST /project/:id/dropbox/link` | login only |
| `DELETE /project/:id/dropbox/state` | login only |
| `POST /project/:id/dropbox/pull` | `ensureUserCanWriteProjectContent` ✓ |
| `POST /project/:id/dropbox/push` | ✓ |
| `GET /project/:id/dropbox/files` | ✓ |
| `POST /project/:id/dropbox/conflict/resolve` | ✓ |
| `POST /project/new/dropbox` | login only (fine) |

**Impact (IDOR write):** any logged-in user can `POST /project/:victimId/dropbox/link` → `uploadProjectToDropbox` runs `upsertDocWithPath`/`upsertFileWithPath` on the **victim's project** with the attacker's Dropbox content → silent content injection into arbitrary projects; or `DELETE .../state` removes another user's sync link. Read the state of any project (leaks path + sync metadata).

**Fix (Batch 2):** add `ensureUserCanWriteProjectContent` (or stricter: project owner for link/unlink) to state GET, link, unlink. Verify the router applies middleware consistently (also check WebDAV router for the same class — WebDAV routes are consistent, keep).

**Verification:** as user B (no access to A's project): link → 403; state → 403; unlink → 403. A's project unmodified.

---

## DBX-07 (HIGH) — Weak token encryption key

`DropboxCredentials.mjs:20-45`:
```js
export function getEncryptionKey() {
  const password = process.env.WEBDAV_TOKEN_CIPHER_PASSWORD
  if (password) { /* raw bytes, padded with 'x' to 32 — no KDF */ }
  // fallback:
  const envString = process.env.NODE_ENV || 'development'
  return Buffer.from(envString.padEnd(32, 'x').slice(0, 32), 'utf8')   // deterministic, known
}
```

**Problems:**
1. Without the env var, the AES key derives from `NODE_ENV` (e.g., `produc...xxxx`) → **fully predictable**: anyone who can read the DB can decrypt every stored Dropbox access token. The warn log ("tokens will not persist across restarts") is wrong — it persistently encrypts with a known key.
2. With the env var: raw password bytes, padded — no KDF (should be scrypt/PBKDF2 over password+salt+label).
3. Incompatible with the WebDAV module's scheme (`@overleaf/access-token-encryptor`, label `OL_WEBDAV-v3`, persisted key file) — two different "same purpose" schemes in one product (ARC-02 family).

**Fix (Batch 2):** reuse `@overleaf/access-token-encryptor` (existing `WebdavTokenEncryption` wrapper) with a dedicated label for Dropbox, key from `WEBDAV_TOKEN_CIPHER_PASSWORD` (or same cipher file), add a version prefix so legacy blobs can be migrated/invalidated on read (migration: re-encrypt on next connect).

**Verification:** unit test: token encrypted without env var is **not** decryptable by the `NODE_ENV`-derived key (new code path); round-trip with env var works; old blobs degrade to "reconnect required" instead of silent decrypt.

---

## DBX-08/12 (MEDIUM) — Push: no rev usage, full re-upload

`uploadProjectToDropbox` uploads every doc/file with default `mode: 'overwrite'`; `client.upload(path, b64, {rev?})` support exists end-to-end (web client → dropboxinterface `/file` → `Dropbox` SDK `update`+rev) but **`rev` is never passed** (the router never supplies it) → remote-side edits to any file are silently clobbered on every push, and every push rewrites 100% of files.

**Fix (Batch 1/2):**
1. Push upload with `rev: state.remoteFiles[path]?.rev` when available (Dropbox `update` mode → 409 on remote change → surface as conflict, don't overwrite).
2. Delta push: skip files whose local hash === last-synced hash.
3. Combined with DBX-01 (deletion rev check) this gives true two-way sync semantics.

---

## DBX-09 (MEDIUM) — Missing `Readable` import

`DropboxRouter.mjs:226` (inside `importNewProjectFromDropbox`): `Readable.from([...])` but the module header never imports `Readable` from `node:stream` (verified: imports at top are DropboxCredentials, models, DropboxClient, middlewares, handlers, Settings, logger, fs, os, path, randomBytes). → **`ReferenceError: Readable is not defined`** on every `POST /project/new/dropbox` call (the "import new project from Dropbox" feature is 100% broken).

**Fix (Batch 1):** `import { Readable } from 'node:stream'`. Also switch to the WD-07-safe `newUpdate(userId, projectId|null, ...)` resolution (projectId known here) and normalized paths (WD-08).

**Verification:** new-project import happy path + empty folder; no ReferenceError in logs.

---

## DBX-10 (MEDIUM) — Duplicate / non-unique project state docs

- `dropboxSyncProjectStates.mjs`: `dropboxSyncSchema.index({ projectId: 1 })` — **non-unique**.
- `link` route: `new DropboxSyncProjectStates({projectId, connected: true, path}).save()` — insert, **not upsert** → linking twice (or two users) creates N docs.
- Reads use `findOne({projectId})` (arbitrary doc wins), `deleteOne({projectId})` removes just one → "unlink" can leave the others (feeds DBX-05).

**Fix (Batch 2):** unique `{projectId: 1, ownerId: 1}`; link = upsert per owner; unlink(p, owner) = delete that owner's doc; `findOne` always with ownerId.

---

## DBX-11 (MEDIUM) — Conflict resolve stub

`POST /project/:id/dropbox/conflict/resolve` (793-815):
```js
// TODO: Implement conflict resolution logic
res.json({ success: true, message: `Conflict resolved - keeping ${choice}` })
```
Accepts any `choice`, returns success, changes nothing — the UI believes the conflict was resolved. Either implement (keep-local: re-push the file; keep-remote: re-pull the file, reusing the DBX-02 primitives) or return 501/400 so the UI shows a real error.

## DBX-13 (MEDIUM) — Classification inconsistency

`isTextFile(relativePath)` → `upsertDocWithPath` (creates a **doc**) for any extension in `Settings.textExtensions`; binary → temp file → `upsertFileWithPath`. The alternate path (`newUpdate` → `UpdateMerger._determineFileType`) treats non-UTF-8 as binary. So a `README.md` with Latin-1 bytes becomes a *doc* in pull-import but a *file* in new-project import → different behaviors, possible content corruption (doc re-encoding to UTF-8). Unify: use `FileTypeManager.getType` on both paths.

## DBX-14 (LOW) — Mutations on read endpoints

`status`, `project state GET`, `link`, `pull`, `push`, `list` all do "if path differs from normalized → `save()`" — read endpoints writing to Mongo (side effects on GET, concurrent writes, and writes by users who may not own the doc post-DBX-06). Move normalization to a single write path (connect/link) and normalize in-memory on read.

## DBX-15 (LOW) — `lastConflict`/`mergeStatus` dead

Never written by any Dropbox flow (verified by grep: only WebDAV `WebdavSync` writes `lastConflict` on the credentials blob). Schema fields exist (`lastConflict`, `mergeStatus`, `lastSyncRev`) but remain null → any UI relying on them shows stale/clean. Wire in with DBX-02/DBX-11 fix (canonical shape, see WD-10).

## DBX-16 (LOW) — No path-choose UI

Credentials support `path` (settings page has no input; `POST /user/dropbox/connect` accepts it but no UI sends it). If multi-folder Dropbox support is desired, add field; otherwise remove the API surface to avoid dead config. (Decision, low effort.)

## DBX-17 (LOW) — String-based error taxonomy

Multiple layers match on `err.message.includes('Not found')` / `'Not found'` (client 404 wording must match router expectations forever). Replace with error codes (see DBX-03 fix) — `ErrorCode` enum in the web Dropbox client, checked centrally.

## DBX-18 (LOW) — Deletion goes to Dropbox trash

`dropboxinterface` `delete()` → `filesDeleteV2` (trash, revivable) — actually *safer* than permanent, but: sync logic assumes "gone"; quota consumed; `mute: true` on uploads suppresses user notifications. Decide and document (recommend: keep trash, expose in docs; add `include_subfolders/permanent` option for explicit user-triggered cleanup).

## DBX-19 (LOW) — OAuth details

- No PKCE `code_verifier`: acceptable for confidential server client, note it.
- `refresh_token` is returned (we requested `token_access_type=offline`) but discarded — no re-auth path if the token is ever revoked. Store encrypted or accept app-token permanence (document decision).
- State nonces: correct (random 24B, consumed on callback) ✓.

---

## Resolution (fix phase, 2026-08-15)

| ID | Status |
|----|--------|
| DBX-01 | FIXED (real client.delete() + pre-push snapshot + guarded reconciliation) |
| DBX-02 | FIXED (rev-aware import; unchanged remote files skipped) |
| DBX-03 | FIXED (typed 404 + no blind markAsDeletedByExternalSource) |
| DBX-04 | FIXED (withProjectSyncLock for pull/push/resolve) |
| DBX-05 | FIXED (credentials collected BEFORE deletion; state deleted by path+ownerId) |
| DBX-06 | FIXED (ensureUserCanWriteProjectContent on link + unlink) |
| DBX-07 | FIXED (SHA-256-derived key from WEBDAV_TOKEN_CIPHER_PASSWORD or SECRET_TOKEN; legacy NODE_ENV keys still decrypt; no deterministic fallback for new writes) |
| DBX-08 | FIXED (push conflict gate on rev change; conflicting files not pushed; lastConflict+mergeStatus recorded) |
| DBX-09 | FIXED (Readable imported in batch -1) |
| DBX-10 | FIXED (unique index + findOneAndUpdate upsert on link) |
| DBX-11 | FIXED (real keep-local/keep-remote resolution) |
| DBX-12 | DEFERRED (delta upload needs local content hashes; overwrite is now conflict-gated so no clobber) |
| DBX-13 | FIXED (importNewProjectFromDropbox uses same text/binary classification when projectId known) |
| DBX-14 | DEFERRED (LOW; normalization now done at creation time, read-side save benign) |
| DBX-15 | FIXED-via-DBX-08/11 (mergeStatus + lastConflict now written) |
| DBX-16 | DEFERRED (UI feature; needs product sign-off) |
| DBX-17 | FIXED (typed status first, message fallback kept) |
| DBX-18 | DEFERRED (Dropbox trash semantics are API-level; documenting only) |
| DBX-19 | DEFERRED (refresh-token flow is a feature addition) |
