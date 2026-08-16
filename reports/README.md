# WebDAV / Dropbox / Datamanipulator / GitHub-Sync — Bug Audit & Fix Plan

**Date:** 2026-08-15 · **Status:** FINAL (all findings manually verified against source)
**Scope (phase 1):** `services/datamanipulator`, `services/dropboxinterface`, `services/webdavinterface`, `services/web/modules/dropbox`, `services/web/modules/webdav`
**Scope (phase 2, GitHub stack):** `services/githubinterface`, `services/web/modules/github-sync` (+ datamanipulator interactions)
**Constraint:** No code was changed during the audit (another agent owns other parts of the codebase).

## Report index

| File | Area | Findings | Critical |
|------|------|----------|----------|
| [01-webdav-module.md](01-webdav-module.md) | `services/web/modules/webdav` | 20 | 3 |
| [02-dropbox-module.md](02-dropbox-module.md) | `services/web/modules/dropbox` | 19 | 3 |
| [03-datamanipulator.md](03-datamanipulator.md) | `services/datamanipulator` | 12 | 2 |
| [04-webdavinterface.md](04-webdavinterface.md) | `services/webdavinterface` | 10 | 1 |
| [05-dropboxinterface.md](05-dropboxinterface.md) | `services/dropboxinterface` | 10 | 0 |
| [06-architecture-cross-cutting.md](06-architecture-cross-cutting.md) | all five | 9 | 1 (rule: ARC-06) |
| [07-githubinterface.md](07-githubinterface.md) | `services/githubinterface` | 13 | 1 (GHI-01) |
| [08-github-sync-module.md](08-github-sync-module.md) | `services/web/modules/github-sync` | 18 | 2 (GS-01/02) |

## The two reported symptoms — root causes confirmed

1. **"Unlinking in user/settings didn't remove the link between the external server and Overleaf"**
   - WebDAV: `POST /user/webdav/disconnect` → `WebdavCredentials.remove()` (`WebdavCredentials.mjs:80-104`). The cleanup query matches a `path` field that **does not exist** in the `WebdavSyncProjectStates` schema → matches nothing → every project state (the "link") survives the disconnect. Worse, the cleanup loop calls `logger.debug` but the file **never imports `logger`** → if it ever matched, the endpoint throws `ReferenceError` and credentials are not even deleted. (WD-01)
   - Dropbox: `expireDeletedUser` hook (`modules/dropbox/index.mjs:43-46`) **deletes the credentials before re-querying them** → the "unlink all projects" loop always sees an empty list → project states survive user deletion. (DBX-05)

2. **"Data destruction due to race conditions"**
   - Pull has **no conflict detection against local Overleaf content** — remote content is applied over local edits whenever the stored remote-state differs (WD-02, DBX-02).
   - Push is a **destructive mirror**: remote-only files/dirs are deleted and all remote files overwritten with local content before/while uploading (WD-03, DBX-12).
   - Manual push (`/project/:id/webdav/push`) and pull (`/project/:id/webdav/pull` → `pollUser`) run with **no shared lock**, and `pollRemoteSync` ignores the projectId and pulls *all* of the user's projects in-flight (WD-04, WD-05). Interleaved delete→upload sequences across two concurrent syncs leave torn state on both sides (ARC-03/ARC-06).

## Priority order for the fix phase

> Grouped into batches so each batch is independently lint-verifiable (AGENTS.md: `eslint --max-warnings 0` per area) and rebuild-verifiable.

**Batch 0 — stop the bleeding (data destruction, do first)**
- WD-01 unlink leaves links + ReferenceError (WebDAV disconnect)
- DBX-05 unlink ordering (Dropbox disconnect / user expire)
- WD-02 / DBX-02 pull-overwrites-local-edits → add local-vs-remote checksum/rev conflict gate
- WD-03 / DBX-12 / DM-02 destructive deletes on push/pull → make deletion explicit & protected (see ARC-06 partial-listing safety)
- WD-04 concurrency: per-project lock shared by pull+push+auto flows

**Batch 1 — correctness**
- WD-05 poll scope, WD-06 project-marking-deleted-on-poll, WD-07 null-projectId import, WD-08 leading-slash paths
- DBX-01 `deleteFile` missing method, DBX-03 `'Not found'` string match, DBX-09 missing `Readable` import
- WI-02 etag always null (conflict detection dead), WI-04 parentPath truncation, WI-05 basic-auth parsing, DM-04 fake mtime
- ARC-04 path normalization canonicalization

**Batch 2 — security**
- WI-01 / DM-03 service auth + bind address, DBX-06 missing project permission checks, DBX-07 weak/fallback encryption key, ARC-07 ownership fields

**Batch 3 — hardening & cleanup**
- Timeouts/retries (WI-03, WD-11, DI retry on 429), error mapping (WI-06, DBX-17), body-size limits (WI-08), schema consistency (WD-09/WD-10, DBX-15), decisions on dead code (WD-14, WD-17, DM-10, ARC-01)

## Decisions needed from product owner (open questions)

1. **Delete semantics:** Must unlink (user or project) ever delete the *remote* folder? Current code says "no" (docstrings) — keep this, and make it explicit in UI?
2. **Conflict policy:** When both sides changed, block + notify (recommended) vs remote-wins (current) vs local-wins? The conflict UI endpoints exist but are half-wired (WebDAV: `ConflictResolver` state store is disconnected from `WebdavSync`; Dropbox: `conflict/resolve` is a stub).
3. **datamanipulator:** keep, rewire, or delete? No code path calls it (ARC-01).
4. **Auto-sync:** the "sync on save / delete remote on project delete / rename sync" handlers exist but are never hooked (WD-14). Enable them (with locks) or remove them?
5. **Shared projects:** two users linking the same project to *different* remotes silently overwrites each other's state doc (WD-18 / DBX-10). Per-user state (store `ownerId`) is recommended.

## Fix-phase protocol (per AGENTS.md)

1. Implement batch by batch (order above). One writer, in-repo (main tree) — no worktrees needed since scope is disjoint from the other agent's area.
2. After each batch: `eslint --cache --cache-location ./.cache/eslint/ --max-warnings 0 --format unix .` scoped to touched dirs must pass with zero warnings.
3. Unit tests: extend existing vitest suites per module (webdav/dropbox have `test/` dirs; datamanipulator has `test/unit`).
4. Reviewer pass (parallel reviewers: diff + logs) before rebuild.
5. Rebuild `cd /root/junk_webdav/overleaf-cep/server-ce && make all` → restart `cd /data_1/docker/compose_cep && sh cycle_overleafserver.sh` → verify logs contain `Enabling WebDAV module` / `Enabling Dropbox module` and no post-init errors.
6. Per-report acceptance checks are listed under each finding's **Verification** section.

## Tracking

| ID | Status |
|----|--------|
| All findings | `OPEN` — update to `FIXED/DEFERRED` with commit reference during fix phase |

## Rebuild procedure (verified against the live image — READ BEFORE REBUILDING)

**Fact:** the running image `sharelatex/sharelatex:nextcloud_webdav_integration2b` (built today 01:25 UTC, rev `f58232d9…`) and its base `sharelatex/sharelatex-base:nextcloud_webdav_integration2b-f58232d9…` both exist. **But `cd server-ce && make all` is currently broken**: `build-base`/`build-community` reference a root `Dockerfile`/`Dockerfile-base` that do **not exist** in the repo (`server-ce/Dockerfile` + `server-ce/Dockerfile-base` exist and expect the repo-root build context — they `COPY server-ce/services.js`, `services/*/package.json`, `libraries/*/…`).

**Working rebuild (app image only — our fixes are app code, no dependency changes, so reuse the existing base):**
```bash
cd /root/junk_webdav/overleaf-cep
docker build --progress=plain --network=host \
  --file server-ce/Dockerfile \
  --build-arg OVERLEAF_BASE_TAG=sharelatex/sharelatex-base:nextcloud_webdav_integration2b \
  --tag sharelatex/sharelatex:nextcloud_webdav_integration2b \
  /root/junk_webdav/overleaf-cep
# (if libraries/*package.json or yarn.lock changed: first docker build --file server-ce/Dockerfile-base --tag sharelatex/sharelatex-base:nextcloud_webdav_integration2b /root/junk_webdav/overleaf-cep)
cd /data_1/docker/compose_cep && sh cycle_overleafserver.sh
docker exec overleafserver ps aux | grep -E 'webdavinterface|dropboxinterface|datamanipulator'  # all three must be alive (runit auto-restarts)
```
If docker build fails: stop, capture the failing lines, do NOT restart, report verbatim.

**Residual risk:** git status shows another agent's in-progress work in `services/githubinterface` + `services/web/modules/github-sync` + web locales (30 files, none in our five areas — verified). A rebuild at 07:40 will bake in their current state; if their code is mid-change the build or container start could fail on *their* files — that is NOT a defect of our fixes (check the failing file's path before attributing).

## Independent verification (2026-08-15)

A fresh-context reviewer re-verified the 19 critical/high findings (F1–F11 covering WD-01..03/05/07/08, DBX-01..03/05/07/09, DM-01..04, WI-01..04/06) **against source**: **all CONFIRMED**, with exact line citations matching these reports. One extra bug found and folded in: `WebdavCredentials.renameProject` called but not exported (added to WD-14, report 01). Reviewer note on WD-03's delete check: `relativePath` in `syncProject` carries **no** leading slash there (projectRoot keeps its trailing `/`), so the membership check does work in that path — WD-03 stands as written (destructive deletes of remote-only entries, unconditionally); the leading-slash hazard applies to `pollUser` (WD-08).

## Baseline lint failures (pre-existing, must fix before rebuild)

`eslint --max-warnings 0` does **not** pass on two audited dirs today: `services/web/modules/webdav` + `services/web/modules/dropbox` → **59 pre-existing errors** (40× import/no-extraneous-dependencies `mongodb`/`mongodb-legacy` in webdav tests, 7× no-unused-vars, 4× no-undef incl. `encrypt`/`decrypt` undefined in `WebdavTokenManager.test.mjs` — that test file is broken, 3× no-console, 2× react-hooks/exhaustive-deps (warnings), 2× unicorn/prefer-node-protocol, 1× import/no-unresolved). The three microservice dirs (webdavinterface, dropboxinterface, datamanipulator) are **clean**. Full list: [baseline-lint.txt](baseline-lint.txt). **The fix phase must clear these baseline errors (Batch -1) before the AGENTS.md zero-warning lint gate and rebuild.**

## Baseline test failures (pre-existing, part of Batch -1)

3 of 5 areas have green test suites (datamanipulator 4/4, dropboxinterface 15/15, webdavinterface 12/12). The **webdav module has 24 pre-existing test failures — all test-side bugs** (dynamic-import namespace not `.default`-unwrapped in 2 files, 1 wrong relative import path, 1 file making real network calls without a fetch mock); the dropbox module has **no tests at all**. Full analysis: [baseline-test.txt](baseline-test.txt). Batch -1 repairs these test files (test-side only, no app-code changes).
