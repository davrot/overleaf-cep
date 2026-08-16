# datamanipulator microservice — findings & fixes

**Area:** `services/datamanipulator/app/src/*` (server.mjs 256, sync.mjs 246, fileOperations.mjs 164, fileUtils.mjs 116, treeCompare.mjs 74, errors.mjs, textExtensions.mjs) + tests
**Status:** all findings OPEN

| ID | Sev | Title | Location |
|----|-----|-------|----------|
| DM-01 | CRITICAL | `pushFiles` is a non-functional stub — never uploads anything, never deletes | `sync.mjs:120-190` |
| DM-02 | CRITICAL | `pullFiles` deletes every local file missing from the remote list — no guard vs empty/partial listings | `sync.mjs:60-75` |
| DM-03 | HIGH | No server authentication at all; binds 0.0.0.0; 10MB body limit | `server.mjs` (all routes, `app.listen` 253-256) |
| DM-04 | HIGH | `mtime` in all metadata is **scan time**, not file mtime → mtime/etag conflict logic is meaningless | `fileUtils.mjs:99-115` (`getFileMetadata`), `fileOperations.mjs:76-92` (`readFile`) |
| DM-05 | MEDIUM | Non-atomic writes; no per-project locking → concurrent endpoints interleave → torn files | `fileOperations.mjs` writeFile; `server.mjs` |
| DM-06 | MEDIUM | `walkTree` loads every file fully into memory; per-file read errors swallowed → silently incomplete trees | `fileOperations.mjs:22-74` |
| DM-07 | MEDIUM | Checksum fallback `sha256:placeholder-<len>` pollutes conflict comparisons | `fileUtils.mjs:74-90` |
| DM-08 | MEDIUM | File-type detection: Latin-1 fallback condition is always true; misclassified text/binary affects doc vs file handling downstream | `fileUtils.mjs:18-70` |
| DM-09 | FIXED (unreachable string-body branch removed) |
| DM-10 | LOW | **Orphan service:** nothing in the repo (web modules, docker files, settings) references it | repo-wide grep (06-architecture ARC-01) |
| DM-11 | LOW | No graceful shutdown / timeout / host binding controls | `server.mjs:253-256` |
| DM-12 | FIXED-via-DM-04 (mtimes now real fs.stat values, etag construction meaningful) |

## Context

`datamanipulator` is a standalone Node/Express service that operates on local project directories (`DATAMANIPULATOR_PROJECTS_ROOT`, default `/projects/<projectId>`) and offers tree/file CRUD plus a pull/push/compare "sync" API intended to be the sync engine between a local tree and a remote file list provided by the caller.

**It is not wired to anything** (DM-10/ARC-01): no imports, no URL in `config/settings.defaults.js`, no compose service in the audited compose files, no `Settings.apis` entry. If shipped in the image and exposed, DM-02/DM-03 become exploitable.

## DM-01 (CRITICAL) — pushFiles does nothing

`sync.mjs` `pushFiles()` (≈120-190): for "new" and "modified" files the only work is `await fileOperations.readFile(...)` followed by `result.uploaded++` — **no write to any remote** (the function receives only `remoteFiles` metadata, no client handle). Deletions: `result.deleted_remote++` with the comment `// In real implementation, would delete from remote`.

**Impact:** any consumer calling `POST /push` gets counts that imply success while the remote is untouched — silent no-op "sync". (The web modules do not call it, hence no production impact *today*.)

**Fix (Batch 3, conditional on ARC-01 decision):** either (a) delete the service, or (b) implement `pushFiles` for real: take a remote-client callback (or the webdavinterface endpoint contract), upload with If-Match when etag known, delete only with rev/etag verification, return precise per-file outcomes. Until then, mark the endpoint `501 Not Implemented` instead of returning fake success counts.

## DM-02 (CRITICAL) — pullFiles wipes local on incomplete remote list

`sync.mjs` `pullFiles()` (≈60-75):
```js
for (const [path] of localMap) {
  if (!remoteMap.has(path)) {
    await fileOperations.deletePath(projectDir, path)   // local file deleted
    result.deleted++
  }
}
```
There is no verification that `remoteFiles` is a *complete* listing (e.g., `req.body.complete !== true`, or caller-provided listing status), no minimum sanity (e.g., deleting N>0 when the list is empty requires explicit confirmation), and `walkTree` itself can produce a truncated local tree (DM-06) — which, combined with a *remote* listing built the same way one side truncated, becomes a delete-everything event.

**Impact (repro):** any caller passes `remote_files: []` (empty due to a listing failure upstream — see ARC-06) → every local file deleted.

**Fix (Batch 0 if the service is kept/used; otherwise delete per ARC-01):**
1. Require an explicit `confirm_deletions: true` + expected file count, or a `deletions: []` whitelist in the request; never derive deletions from set-difference alone.
2. Treat empty remote list as an error, not "everything remote was deleted".
3. Add `X-Sync-Nonce` idempotency + per-project lock (DM-05).

## DM-03 (HIGH) — Unauthenticated network service

No auth middleware on any route; `app.listen(PORT)` binds all interfaces. `GET /file` / `POST /file` / `DELETE /file` operate on `projectsRoot/<project_id>` with the only protection being `resolveProjectPath` traversal guard (`fileOperations.mjs:6-14`). Anyone with network reach can read/write/delete project files.

**Fix:** (a) if kept: auth (service token / mTLS), bind `127.0.0.1` or the compose network only, audit-log every mutation. (b) if deleted: nothing to fix. Decision: ARC-01.

## DM-04 (HIGH) — Fake mtime

`fileUtils.getFileMetadata` and `fileOperations.readFile` set `mtime: new Date().toISOString()` — the moment of scanning/reading, **not** the file's actual mtime. Consequences:
- `sync.resolveConflictByMtime` compares two scan timestamps (always ≈now) → conflict resolution is garbage.
- ETags built as `sha256:<hash>|<mtime>` (getFileEntry/fullSync) are unstable for identical content → false conflicts, false "changed" detection across listings seconds apart.

**Fix:** use `fs.stat(fullPath).mtimeMs` (real mtime); make etag = content hash only (or hash+size); keep mtime informative, not authoritative.

## DM-05 (MEDIUM) — Atomicity/locking

- `writeFile` uses `fs.writeFile` directly → torn file on crash or concurrent `POST /file` to the same path.
- No per-project lock: `POST /pull` + `POST /file` concurrently → pull's delete loop can remove a file `POST /file` is creating, or vice versa.

**Fix:** write-to-temp + `fs.rename` (atomic), per-project mutex (in-process) for mutating endpoints, `mkdir` guard exists (good).

## DM-06 (MEDIUM) — walkTree memory & silent gaps

Every file is `fs.readFile`-ed in full (plus SHA-256) during every `/tree`, `/files`, `/pull`, `/push` — O(project size) memory; a single read error is swallowed (`logger.warn`) producing a **silently incomplete** tree. If any caller treats "not in tree" as "deleted", DM-02 fires.

**Fix:** stream-based checksum (`createHash().update(chunk)`), bounded concurrency, return per-file read-status and let the caller decide whether the listing is "complete"; surface incomplete as an error on destructive endpoints.

## DM-07 (MEDIUM) — Placeholder checksums

`calculateChecksum` catch → `sha256:placeholder-<len>` (sha256 never throws in practice — the branch is defensive, but if hit, comparisons treat it as a real checksum → false conflict/overwrite decisions). Return a sentinel `checksum: null` instead and let the consumer treat it as "unknown" (pullFiles already skips unknown — DM alignment).

## DM-08 (MEDIUM) — FileType detection weaknesses

1. `ext = filepath.split('.').pop()` — no-extension files classify by content (ok); `archive.tar.gz` → `gz` ok; **`Makefile`-style or `path.with.dots` ok** — but `dir/file` where last segment has dotless name and content is binary → null-byte/utf8 checks decide; borderline.
2. **Latin-1 fallback is a tautology:** `if (!(byte >= 0 && byte <= 255))` is always false for `Buffer` index access → `allValid` always true → any non-UTF-8, null-free file is "text/latin1". Downstream consumers that branch on `binary` (doc vs binary file in Overleaf) misclassify such files.
3. The 5% null-byte heuristic runs before the UTF-8 attempt — a mostly-text file with a 6% binary region (e.g., embedded base64 blob) classifies binary. Order: try strict UTF-8 first for `.tex/.md/.txt`-like sets (already covered by extension set? no — extension set is binary-only).

**Fix:** use `TextDecoder('utf-8', {fatal:true})` first for text-candidate extensions + content, then null-byte heuristic, else binary; remove the tautology.

## DM-09/11/12 (LOW) — Hygiene

- `server.mjs:127` `else if (typeof req.body === 'string')` — unreachable with `express.json` active (body is always object or request rejected). Remove.
- `/files` with `path` param returns entries including the directory itself with stripped `relative_path: ''` (75-90) — consumers must special-case; return only children.
- `app.listen` with no graceful shutdown (SIGTERM handler draining in-flight requests) — Docker restarts can kill mid-write (DM-05 interaction).
- `getFileEntry`/`fullSync` etag embedding scan-time mtime (DM-04 fallout).

## DM-10 (LOW, decision) — Orphan

No references: webdavinterface/dropboxinterface are the only network consumers of remote protocol; web modules call webdavinterface/dropboxinterface directly; docker compose (root + /data_1 runtime) has no datamanipulator service; no `Settings.apis.datamanipulator`. **Recommendation: delete the service (and its tests) unless a concrete plan exists to make it the sync engine.** If deleting: remove from `services/` listing docs and any lint scope. If keeping: fix DM-01/02/03 first and wire tests + compose.

---

## Resolution (fix phase, 2026-08-15)

| ID | Status |
|----|--------|
| DM-01 | FIXED (honest 501 + upload manifest; no fake success) |
| DM-02 | FIXED (empty listing = error; deletions only with explicit confirm_remote_deletions) |
| DM-03 | FIXED (SHARED_SERVICE_TOKEN enforced when set, warn+allow when unset} |
| DM-04 | FIXED (real fs.stat mtime in readFile) |
| DM-05 | DEFERRED (orphan service; low value until owner decided) |
| DM-06 | DEFERRED (service orphan; see DM-10) |
| DM-07 | DEFERRED (checksum placeholder is only a fallback path) |
| DM-08 | DEFERRED (orphan service) |
| DM-09 | DEFERRED (LOW) |
| DM-10 | OPEN-DECISION (orphan service — deletion requires user sign-off per project rule) |
| DM-11 | DEFERRED (graceful shutdown; see DM-10) |
| DM-12 | DEFERRED (consequence of DM-04; mtime now real) |
