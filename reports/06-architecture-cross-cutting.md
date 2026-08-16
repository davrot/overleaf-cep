# Cross-cutting architecture & consistency — findings & fixes

**Scope:** the five audited areas together. These are the systemic causes that make the per-module bugs (WD/DBX/DM/WI/DI) recur.

| ID | Title | Severity | Blocks |
|----|-------|----------|--------|
| ARC-01 | Two parallel sync stacks + orphan service | MEDIUM (decision) | DM-10, WD-14 |
| ARC-02 | No single owner of "link lifecycle" (connect/link/poll/push/unlink/delete-user/project-expire) | HIGH | WD-01, DBX-05, DBX-15 |
| ARC-03 | No sync concurrency model (in-process Sets/Maps only; no per-project serialization shared by pull/push/auto) | HIGH | WD-04, DBX-04 |
| ARC-04 | Path normalization inconsistent (leading `/` vs none) across pull/import/push | HIGH | WD-08, DBX-02 |
| ARC-05 | Content-identity contract broken: etag always null (WebDAV), no hash (Dropbox), mtime fake (datamanipulator) | HIGH | WD-02/03, DBX-02/08, DM-04 |
| ARC-06 | "Partial/failed remote listing" is indistinguishable from "remote is empty" → destructive conclusions | CRITICAL | DM-02, WD-06, DBX-01/03, DI-04 |
| ARC-07 | No ownership model on per-project sync state (no `ownerId`); endpoints with missing authz | HIGH | WD-15, DBX-05/06/10, DBX-07 |
| ARC-08 | Config drift: `Settings.webdav.rootPath` referenced but unset; `WEBDAV_ENABLED/DROPBOX_ENABLED` gates differ from feature flags; service URLs default to `localhost` with env overrides — deployment coupling undocumented | MEDIUM | WD-12, WI-*, DI-01 |
| ARC-09 | Test coverage thin exactly where data moves: no tests for `WebdavSync`, Dropbox router flows, pull/push contracts; unit tests exist for clients/state managers only | MEDIUM | all data-loss findings |

---

## ARC-01 — Two parallel sync architectures (decision)

| Stack | Engine | Transport | Status |
|-------|--------|-----------|--------|
| A (active) | `modules/webdav/WebdavSync` + `modules/dropbox/DropboxRouter` flows (inside web service, direct entity APIs) | `webdavinterface` / `dropboxinterface` microservices | used by all UI |
| B (orphan) | `services/datamanipulator` (local-tree pull/push/compare over `DATAMANIPULATOR_PROJECTS_ROOT`) | none (dead) | nothing calls it; `pushFiles` is a stub (DM-01) |

Both implement "mirror to remote" with **different deletion policies**, and A's Dropbox path additionally uses `TpdsUpdateHandler`/`EditorController` while A's WebDAV path uses the same — inconsistent even *within* stack A.

**Recommendation:** keep stack A; **delete stack B** (datamanipulator + its tests) unless there is a documented plan to make it the engine. If kept: it must implement DM-01/02 and take ARC-03/05/06 — treat as a new project, not a patch.

## ARC-02 — Link lifecycle has no single owner

Observed state mutations and their writers today:

| Event | WebDAV | Dropbox |
|---|---|---|
| user connect | `WebdavCredentials.save` | `DropboxUserCredentials upsert` |
| user disconnect | `WebdavCredentials.remove` (broken: WD-01) | router `deleteMany({path})` (edge-case leak: DBX-05) |
| project link | `SyncStateManager.createProjectState` + push | router `new ... save()` + push |
| project unlink | `WebdavHandler.unlinkProject` → `removeProjectState` | router `deleteOne({projectId})` (leaves duplicates: DBX-10) |
| project delete/expire | hook `projectExpired` deletes state (index.mjs:26) | same (index.mjs:28) |
| user expired/deleted | hook `expireDeletedUser` (regex query — never matches + ReferenceError) | hook `expireDeletedUser` (ordering bug — DBX-05) |
| remote folder gone | `pollUser` → `markAsDeletedByExternalSource` + `forgetProject` (blind: WD-06) | pull 404 → `markAsDeletedByExternalSource` (blind: DBX-03) |
| remote folder reappears after deletion | `unmarkAsDeletedByExternalSource` | **no equivalent** (asymmetric!) |
| conflict detected | credentials blob `lastConflict` (schema-mismatched: WD-10) | nothing (DBX-15) |
| conflict resolved | `WebdavSync.resolveConflict` (exists, **unrouted**) / `ConflictResolver` (routed, **disconnected from sync state**) | stub returning success (DBX-11) |

**Fix (architecture, Batch 0/2):** introduce one `SyncLinkService` (per module) exposing: `connectUser`, `disconnectUser` (delete creds + all states owned by user), `linkProject(ownerId)`, `unlinkProject(ownerId)`, `syncInbound`, `syncOutbound`, `markRemoteMissing/Restore`, `recordConflict/resolveConflict`. All router endpoints become thin adapters; all hooks (projectExpired, expireDeletedUser, future rename/delete) call the service. Store `ownerId` everywhere (ARC-07). This is what makes WD-01/DBX-05/WD-15/DBX-10/DBX-15/WD-06 one fix instead of seven.

## ARC-03 — Concurrency model

Current: `syncingProjects` Set (webdav, only in one of four entry points), `credentialLocks` Map (per-user state writes), `recentlyInboundProjects` 10s marker, Dropbox: **none**. No cross-process safety (web is single-process today — OK, but fragile), no stale-lock breaker, pull is not covered at all.

**Fix (Batch 0):** shared `withProjectSyncLock(ownerId, projectId, ttl)` used by inbound, outbound, link, unlink, conflict-resolve, import. Redis-backed option documented for future multi-process; in-process Promise-chain sufficient now (with TTL breaker + logging).

## ARC-04 — Path normalization

Three dialects in flight:
1. `pollUser`: `/main.tex` (leading slash) → `newUpdate` (TPDS) and `remoteState` keys.
2. `importRemoteProject`: `main.tex` (no slash).
3. Dropbox: always `/main.tex` via `relativeDropboxPath`.
4. Remote construction: `remotePath(root, name, file)` — assumes `file` starts with `/` (default `/`!), i.e., `remotePath(root, name)` → trailing `/` on a *file* path. **Check callers** at fix time; this asymmetry is why several `entry.path === resourcePath` comparisons in `collectFiles` only work by accident.

**Fix (Batch 1):** one boundary function `toEntityPath` (→ relative, no leading slash, `/`-separated) and `toRemotePath(root, entityPath)`; unit tests against real WebDAV/Dropbox path shapes (incl. spaces, unicode, dotted names).

## ARC-05 — Content identity

| Source | Identity available | Used for conflict |
|---|---|---|
| Dropbox API | **`rev`** (authoritative, stable) | collected, never compared (DBX-02/08) |
| WebDAV (webdavinterface) | `etag` (hardcoded null) + `lastmod` | dead (WI-02) |
| datamanipulator local scan | sha256 (real) + **fake mtime** | `resolveConflictByMtime` is meaningless (DM-04) |

**Fix (Batch 1/2):** standardize the sync decision table per file, in one place:
```
knownLocal == knownRemote        → no-op
knownLocal == lastSynced; remote changed → apply remote
knownLocal != lastSynced; remote unchanged → push local
both changed                        → CONFLICT (never auto-apply; notify; UI resolves)
unknown remote identity             → treat as changed (safe side), unless size+hash both match
```
with `rev` (Dropbox) / `getetag` (WebDAV) as the identity token and content-hash as the fallback. This single table kills WD-02, WD-03, DBX-02, DBX-08 at once.

## ARC-06 — Partial-listing safety (CRITICAL rule)

Every destructive conclusion in this codebase ("remote file deleted", "remote folder gone", "no files to import") is derived from **a listing that may be truncated or error-swallowed**:
- `dropboxinterface` 429 mid-pagination → silent partial (DI-04)
- `webdavinterface` `getDirectoryContents` throwing mid-`collectEntries`/`walk` (webdav module) — loop aborts, but *previous* iterations already deleted/overwrote (WD-03 order-of-operations)
- `datamanipulator.walkTree` swallows read errors → incomplete local tree feeds the "not in remote → delete local" logic (DM-02/06)

**Rule (implement in all five areas):** a sync step that mutates remote/local content MUST run only after (a) a listing completed with `complete: true`, (b) explicit confirmation where set-difference drives deletions, and (c) an abort path that rolls back *pending* deletions when a later step failed (at minimum: mark sync `partial`, keep delete-list, never report success). Add a shared `assertCompleteListing(listing)` helper in each module.

## ARC-07 — Ownership & authorization

- Per-project state docs: add `ownerId`, unique `(projectId, ownerId)`; every read/write filtered by `ownerId = req.user` (fixes WD-15, DBX-05/10, part of DBX-06).
- Route authz matrix must list: which routes need `ensureUserCanWriteProjectContent`, which need *project ownership*, which are user-scoped. (Dropbox gaps: DBX-06; WebDAV is consistent ✓.)
- Services: shared caller token (WI-01, DI-01) + internal bind.
- Credentials: one encryption scheme + key management (DBX-07, WD-16).

## ARC-08 — Config & deployment coupling

**Runtime evidence (verified 2026-08-15 against the live overleafserver container, image `sharelatex/sharelatex:nextcloud_webdav_integration2b`):**
1. All three microservices run **inside the overleafserver container** (pids: webdavinterface `services/wdavinterface...` server.mjs, dropboxinterface, datamanipulator) → the `localhost:400x` code defaults work in this deployment; no `*_API_URL` env is set (fine here, but must be set explicitly if services ever split into containers).
2. **All four services listen on 0.0.0.0** (`*:4001` `*:4002` `*:4003` `*:4013`) — the unauthenticated-proxy findings (WI-01, DM-03, DI-01) are LIVE exposure on the docker network, not theoretical.
3. **Set-but-never-read config:** `WEBDAV_ROOT_PATH=/Overleaf`, `WEBDAV_POLL_INTERVAL_MS=300000`, `WEBDAV_REQUEST_TIMEOUT_MS=10000`, `WEBDAV_RETRY_COUNT=2`, `WEBDAV_RETRY_DELAY_MS=250` (plus `WEBDAV_TOKEN_CIPHER_LABEL=OL_WEBDAV-v3`, `WEBDAV_TOKEN_CIPHER_PASSWORD` set; `WEBDAV_ENABLED=true`, `DROPBOX_ENABLED=true`, Dropbox app key/secret set). Code never reads any of the first five (`Settings.webdav.rootPath` unset — WD-12; no poll loop — WD-14; no timeouts/retries — WD-11/WI-03). **Fix rule: implement timeout/retry/poll semantics by READING these existing env vars (with sane defaults), do not invent new names.**
4. Because `WEBDAV_TOKEN_CIPHER_PASSWORD` IS set here, the Dropbox weak-key fallback (DBX-07) is latent in this deployment, not active — still fix (other deployments / dev boxes).

Other items (unchanged):
- `Settings.webdav.rootPath` (fallback in `WebdavSync`) unset → `"undefined/<project>"` folders possible (WD-12). (See evidence 3: the intended value ships as `WEBDAV_ROOT_PATH`.)
- Feature gates: `WEBDAV_ENABLED` / `DROPBOX_ENABLED` (module index.mjs) vs `Settings.webdav.enabled`/`Settings.dropbox.enabled` (frontend meta) — both must be set consistently; document.
- Service URLs: `DATAMANIPULATOR_API_URL` (unused), `WEBDAVINTERFACE_API_URL`, `DROPBOXINTERFACE_API_URL` default to `localhost:400x` — valid in-container (evidence 1); document the coupling.
- `LINKED_URL`/`SITE_URL` used for OAuth redirect — validate both set or redirect computation is correct behind a proxy (dropbox oauth only).

## ARC-09 — Test strategy for the fix phase

Add (all cheap, all targeting data-loss paths):
1. Identity/conflict table (ARC-05) as a pure function — table-driven unit tests for all 6 branches (both modules).
2. Router-level integration tests (existing vitest: `modules/webdav/test/integration/src/WebdavRoutes.test.mjs` pattern) for: disconnect cleans states (WD-01), expire ordering (DBX-05), pull-with-both-changed (WD-02/DBX-02), push-with-remote-extra-file (WD-03/DBX-01), 429-partial-list abort (DI-04), authz matrix (DBX-06).
3. `dropboxinterface`/`webdavinterface`: 429 retry + `complete` flag; etag pass-through + stale-etag 412 (WI-02); WI-04 upload parent-path.
4. Lint gate per AGENTS.md after each batch.

---

## Resolution (fix phase, 2026-08-15)

| ID | Status |
|----|--------|
| ARC-01 | OPEN-DECISION (two stacks + orphan datamanipulator; deletion needs sign-off) |
| ARC-02 | FIXED-via-stack (hooks now reliable, ownership tracked, resolve implemented) |
| ARC-03 | FIXED (per-user WebDAV lock + per-project Dropbox lock) |
| ARC-04 | PARTIAL (sync flows self-consistent; import flows keep historical convention) |
| ARC-05 | PARTIAL (WebDAV etag + Dropbox rev live; datamanipulator deferred) |
| ARC-06 | FIXED (no blind deletions anywhere; remote-missing = notify+unlink, never mark deleted) |
| ARC-07 | FIXED (ownerId + authz on all project-scoped endpoints) |
| ARC-08 | PARTIAL (rootPath env wired; service auth opt-in) |
| ARC-09 | PARTIAL (69 green tests; new sync-gate logic untested — residual risk noted) |
