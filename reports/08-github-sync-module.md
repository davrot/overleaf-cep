# github-sync module (services/web/modules/github-sync) — "fix me" report
Audit date: 2026-08-15 · Audit phase 2 · Scope: `services/web/modules/github-sync` (enabled via `GITHUB_SYNC_ENABLED=true`, OAuth app configured in env) and its interactions with `services/githubinterface` + `services/project-history`.

## Severity summary
| ID | Sev | Title |
|----|-----|-------|
| GS-01 | CRITICAL (broken) | `exportProject` references non-existent `HistoryManager.getProjectFileBase64` → every export 500s; and even fixed, file content is never written into the clone dir, so `/commit` has nothing to stage |
| GS-02 | CRITICAL (broken) | `listBlobsAtCommit` passes a **commit** sha to `/git/trees/{tree_sha}` → 404 → every merge step that applies a snapshot fails |
| GS-03 | HIGH | Merge engine (`GitMerge` + `GitHubApiClient`) is **GitHub-only** and reads the **legacy** token (`TokenManager.getUserToken`, github.com default) → broken for GitLab/Gitea/Forgejo links and GitHub Enterprise; half-wired multi-provider |
| GS-04 | HIGH (bug) | GitHub merge conflicts return **405**; only 409 is mapped to `GitConflictError` → auto-merge conflicts escalate to 500 instead of entering the conflict state |
| GS-05 | HIGH (broken) | `importRepo` passes a git **directory** to `createProjectFromZipArchiveWithName`, which requires a **zip file** (`_extractZip` → yauzl on a directory) → every "create project from GitHub" fails |
| GS-06 | HIGH (bug) | `exportProject` stores `lastSyncCommit: 'unknown'` sentinel → first merge overview always reports **diverged** (service `git.log from:'unknown'` errors → `diverged:true`) |
| GS-07 | MEDIUM | TokenManager read-modify-write without locking → concurrent server saves lose updates (last write wins) |
| GS-08 | MEDIUM (footgun) | `GITHUB_API_MAX_CONCURRENCY` read as raw string → `pLimit(string)` throws at import if the env is set |
| GS-09 | MEDIUM | Legacy OAuth token fallback reads `credentials.github`, a field **absent from the schema** (mongoose strict) → pre-refactor tokens are unreadable; users silently re-link |
| GS-10 | MEDIUM | Identity-contract mismatch (ARC-05 class): OL snapshot `data.hash` (raw content sha) is compared against **git blob shas** in `applyGitSnapshotToProject`/`buildDetachedSyncPlan` → equality shortcut never triggers (churn) and 3-way comparisons misclassify binary entries as conflicts |
| GS-11 | MEDIUM | Module `GitServerClient` fetches have **no timeout** (hung githubinterface → user request hangs forever); also must forward `SHARED_SERVICE_TOKEN` once GHI-01 lands |
| GS-12 | MEDIUM | `createProjectState` uses `create()` → duplicate-key crash path if state exists; `updateProjectState` silently no-ops when state missing |
| GS-13 | LOW | `getUserAndOrgs` controller has no try/catch (loses OError status, generic 500) |
| GS-14 | LOW | `listUserAndOrgs` wraps a single fetch in `Promise.all`; username comes from stored config, not API |
| GS-15 | LOW | `/user/github-sync/unlink` deletes **all** providers' credentials (user-level "unlink"); no frontend caller found today — semantics still risky for future UI |
| GS-16 | LOW | No `ownerId` on project states; `expireDeletedUser` cannot clean states linked by a deleted user (state sticks to their now-dead token) |
| GS-17 | LOW | `gitMerge` controller: no explicit `userId` guard after `requireLogin` |
| GS-18 | LOW | `generateBranchName` has no uniqueness suffix — same-minute double merges on the same repo (two projects linked to one repo) can collide |

## Findings (detail + fix direction)

### GS-01 (CRITICAL) — export is broken twice over
`GitHubSyncHandler.exportProject`:
```js
content_base64: HistoryManager.getProjectFileBase64(projectId, currentVersion, path)
```
`HistoryManager` (module) exports `getProjectFileBuffer` — the called function **does not exist** → `TypeError` on every export. Even if the name were fixed, the service `/commit` only **stages paths that already exist on disk** (`git.add(filepaths)`) but nothing ever writes the file bytes into `fsPath` (the service never sees content; the module client never writes files). Fix: in `exportProject`, for each `currentPaths.paths[i]`:
1. `const b64 = await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)`
2. `await fs.promises.writeFile(Path.join(fsPath, path), Buffer.from(b64, 'base64'))`
   (web + githubinterface share the container fs — verified both run inside `overleafserver`)
3. then `gitClient.commit(fsPath, files, ...)` → `gitClient.push(...)`.
Capture `commit_sha` from the commit response (fixes GS-06) instead of the `'unknown'` sentinel.

### GS-02 (CRITICAL) — trees API called with commit sha
`GitHubApiClient.listBlobsAtCommit` does `/git/trees/${commit}?recursive=1`. GitHub requires a **tree** sha there; a commit sha yields 404. `getGitBlobMap` (GitMerge) is hit on every clean merge that applies a snapshot (`applyGitSnapshotToProject`) and in the detached flow. Fix: resolve commit → tree first (`getCommitTree` already does `GET /git/commits/{commit}` → `tree.sha`), then list that tree.

### GS-03 (HIGH) — merge engine is GitHub-only + legacy token
- `doGitMerge` → `TokenManager.getUserToken(userId)` reads only legacy `credentials.github` / `tokens.github['https://github.com']` (see GS-09): **GitLab/Gitea/Forgejo users have no token here at all** → merge throws.
- `GitHubApiClient` hard-codes `https://api.github.com` (REST + GraphQL) → GitHub Enterprise and all non-GitHub providers broken.
- State already stores `syncProvider/syncServerUrl/syncUsername` (set by import/export) — use `TokenManager.getUserPATCredentials(userId, provider, serverUrl)` and parameterize the API base (`github.com` → `api.github.com`; GHE `<host>` → `<host>/api/v3`; GitLab/Gitea → out of scope for the REST merge engine).
- Scope decision (fix, don't rebuild): make the **GitHub + GitHub-Enterprise** merge path fully work (correct token + base URL); for other providers fail **honestly** with `501 merge-not-supported` (clear message) instead of the current misleading failures. Export/import already go through provider-agnostic githubinterface.

### GS-04 (HIGH) — 405 conflicts
GitHub `POST /repos/{o}/{r}/merges` returns **405 Method Not Allowed** on an un-mergeable result (409 also possible). `normalizeGitHubError` maps only 409 → `GitConflictError`; 405 falls through to `ProviderRequestError` (500) → `mergeWithTempBranch` rethrows instead of returning `{conflict:true}`. Fix: treat 405 (and 409) as `GitConflictError`.

### GS-05 (HIGH) — import from git is broken
`importRepo` clones into a directory then calls `createProjectFromZipArchiveWithName(userId, name, fsPath)` — but `ProjectUploadManager._extractZip` → `ArchiveManager.extractZipArchive` → `yauzl.open(<dir>)` fails (not a zip). Fix without new dependencies: add a **stored (uncompressed) ZIP writer** in the module (`app/src/ZipWriter.mjs`; ~80 lines of CRC32 + local/central directory headers; yauzl reads stored entries fine, and ArchiveManager's `_checkFilePath`/size checks accept it) and zip the clone dir (excluding `.git`) before `createProjectFromZipArchiveWithName`.

### GS-06 (HIGH) — `'unknown'` lastSyncCommit
After export, `lastSyncCommit: firstCommit?.commit_sha || ... || 'unknown'`. Service `/commits` then runs `git.log({from: 'unknown'})` → throws → returns `diverged: true` → merge overview flags the project **diverged forever** until manually pushed. Fix: store real sha (commit response; fallback `gitClient.getBranchHead`).

### GS-07 (MEDIUM) — token RMW races
`saveUserPAT / updateServerUsername / addServerConfig / removeServer / removeUserPAT` all `findOne → mutate → save()` with no concurrency guard. Two fast saves (e.g. linking two servers) drop one. Fix: per-user promise-chain lock (same pattern used by the webdav/dropbox modules in this repo).

### GS-08 (MEDIUM) — `GITHUB_API_MAX_CONCURRENCY`
`const maxConcurrency = process.env.GITHUB_API_MAX_CONCURRENCY || 5` → when the env is set, this is a **string** → `p-limit` throws `Expected concurrency to be a finite number > 0` **at module import** (container currently has it unset — latent). Fix: `Number.parseInt(...) || 5` with `>0` guard.

### GS-09 (MEDIUM) — legacy token inaccessible
`getUserPAT`/`getUserAndOrgs`/`getPublicServers` fall back to `credentials.github` (pre-PAT-revision OAuth token), but the schema (`githubSyncUserCredentials.mjs`) has **no `github` field** (mongoose strict) → always `undefined` → legacy users lose their link silently on the multi-server migration. Fix: add `github: { type: Schema.Types.Mixed }` to the schema so existing docs are readable (fallbacks already coded).

### GS-10 (MEDIUM) — hash identity mismatch
- `applyGitSnapshotToProject`: `historySnapshot[path]?.data?.hash === gitBlobSha` — OL snapshot hash (raw content sha1, or `data.content` for text) vs **git blob** sha (sha1 of `blob N\0content`). Never equal → the "skip unchanged" shortcut dead → every snapshot apply re-writes all files (version churn, history bloat).
- `buildDetachedSyncPlan` 3-way: `getEntryHash` = `data.hash || gitBlobShaFromString(data.content)` — text entries compare blob-sha (correct), **binary/hash-only entries compare raw sha vs blob sha** (always unequal) → false conflicts.
Fix: helper `contentBlobSha(entry) = entry?.data?.content != null ? gitBlobShaFromString(content) : null`; use it in both places; entries with null (binary) that also changed remotely → classify as **conflict** (safe) rather than guessing.

### GS-11 (MEDIUM) — no client timeouts
All 13 `fetch()` calls in `app/src/GitServerClient.mjs` have no `AbortSignal` → a stuck githubinterface hangs the user's request indefinitely (and holds the merge lock 5 min → deadlock-ish UX). Add `AbortSignal.timeout(30_000)` (default) / `600_000` for clone/commits. Also send `x-service-token: process.env.SHARED_SERVICE_TOKEN` when set (GHI-01).

### GS-12 (MEDIUM) — state upsert semantics
`createProjectState` = `create` → duplicate-key on pre-existing state (import of an already-linked project = 500 with raw Mongo error). `updateProjectState` = `updateOne` without upsert → silently no-op when state absent. Fix: upsert-on-create (catch duplicate → update), keep updateOne (document: state must exist).

### GS-13..GS-18 (LOW) — misc
- **GS-13** wrap `getUserAndOrgs` controller in try/catch (propagate OError status).
- **GS-14** drop the single-element `Promise.all` in `listUserAndOrgs`; use the orgs payload for username when `username` not stored.
- **GS-15** `/user/github-sync/unlink` deletes **all** providers' credentials; acceptable as "unlink every git server" (document) or accept `?provider=` to scope; no frontend caller found (dead-ish route).
- **GS-16** project states lack `ownerId`; `expireDeletedUser` cannot clean up state created by a deleted user → stale links on their token. (Document; same ARC-07 class as webdav/dropbox.)
- **GS-17** add explicit `if (!userId) return res.status(401)` in `gitMerge`.
- **GS-18** `generateBranchName` (minute-resolution timestamp) + random suffix to avoid same-repo collisions.

## Verified non-issues
- Router authz: all `project/:project_id/...` routes carry `ensureUserCanWriteProjectContent`; user routes `requireLogin` ✓.
- `unlinkRepo` restricted to project **owner** (`owner_ref === userId`) ✓ (safer than webdav/dropbox).
- `HistoryManager._streamToBase64` chunk-encoding is base64-safe (splits on 3-byte boundaries; padding only in final segment) ✓.
- project-history contracts used by the module exist in this fork: `GET /project/:id/paths/version/:v` → `{paths:[...]}` ✓, `GET /filetree/diff?from&to` → `{diff:[...]}` ✓, snapshot `{path:{data:{hash|content}}}` ✓.
- `ArchiveManager` extraction is pure-JS (yauzl) with path-traversal guards ✓ — the GS-05 fix can feed it a stored zip without new deps.
- Token encryption: `AccessTokenEncryptorHelper` (env `GITHUB_TOKEN_CIPHER_PASSWORD` → `TOKEN_CIPHER_PASSWORD` → persistent file at `/var/lib/overleaf/data/.token-cipher.json`, label `OL_CEP-v3`) — no deterministic fallback key (better than the Dropbox module pre-fix) ✓.

## Resolution (applied 2026-08-15)
| ID | Status | Evidence |
|----|--------|----------|
| GS-01 | FIXED | `exportProject` writes every project file (latest version) into the clone work-dir before committing; commit uses a real author identity; `getProjectFileBase64` (nonexistent) → `HistoryManager.getProjectFileBuffer` (real export) |
| GS-02 | FIXED | `listBlobsAtCommit` resolves commit → tree sha (`getCommitTree`) before calling `/git/trees/{tree}?recursive=1` |
| GS-03 | FIXED (scoped) | `doGitMerge` now resolves credentials via `TokenManager.getUserPATCredentials(userId, 'github', serverUrl)` from the project state's `syncServerUrl`; `api.setApiBaseForServer(serverUrl)` supports GitHub Enterprise; non-GitHub providers fail with an honest 501 (merge engine is GitHub-REST-only; export/import remain provider-agnostic) |
| GS-04 | FIXED | 405 and 409 both map to `GitConflictError` |
| GS-05 | FIXED | new `ZipWriter.mjs` (stored zip, ~150 LOC, no deps) zips the clone (`.git` excluded) before `createProjectFromZipArchiveWithName`; verified round-trip through the real `ArchiveManager.extractZipArchive` (unicode names, nested dirs, content) |
| GS-06 | FIXED | `lastSyncCommit` = commit sha from `/commit` response, fallback `getBranchHead`; never `'unknown'` |
| GS-07 | FIXED | per-user promise-chain lock (`withUserLock`) around all five credential mutators; inner `_removeUserPAT` used by `_removeServer` to avoid deadlock |
| GS-08 | FIXED | `Number.parseInt` + positive-integer guard around `GITHUB_API_MAX_CONCURRENCY` |
| GS-09 | FIXED | credentials schema now declares `github: Mixed` (legacy token readable) |
| GS-10 | FIXED | `applyGitSnapshotToProject` compares `gitBlobShaFromString(data.content)` (skips only when proven equal; binary/large entries rewrite — safe); `getEntryHash` prefers blob-sha of content, raw hash fallback only comparable to other OL entries (conservative-conflict safe) |
| GS-11 | FIXED | all `fetch` calls in module `GitServerClient` carry `AbortSignal.timeout` (60s default / 9min clone+commits) and forward `SHARED_SERVICE_TOKEN` (file rewritten with a single `_post` helper) |
| GS-12 | FIXED | `createProjectState` upserts (no more E11000 on re-link), returns the resulting doc |
| GS-13 | FIXED | `getUserAndOrgs` controller wraps in try/catch and propagates OError status |
| GS-14 | DEFERRED | single-fetch `Promise.all` is harmless; username-from-config semantics unchanged |
| GS-15 | DEFERRED | user-level unlink semantics documented (route not called by current frontend) |
| GS-16 | FIXED | `ownerId` on project states (set on import/export), `removeProjectStatesByOwnerId` wired into the `expireDeletedUser` hook |
| GS-17 | FIXED | explicit 401 in `gitMerge` when no session user |
| GS-18 | FIXED | `generateBranchName` appends a 6-hex random suffix |

### Verification status
- `node --check` clean on every changed file (service + module).
- `eslint --max-warnings 0` clean: `services/githubinterface/app` (new `eslint.config.mjs` mirroring the sibling services) and `services/web eslint modules/github-sync/...` under the web flat config.
- ZipWriter round-trip verified against yauzl + the real `ArchiveManager.extractZipArchive` (entry list, method 0, unicode names, content equality, `findTopLevelDirectory` OK).
- Rebuild + restart + log verification: pending (next step).
