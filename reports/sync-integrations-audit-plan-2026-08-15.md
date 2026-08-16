# Sync Integrations — Audit Findings & Fix Plan

Date: 2026-08-15
Scope: `services/datamanipulator`, `services/dropboxinterface`, `services/webdavinterface`,
`services/githubinterface`, `services/web/modules/{webdav,dropbox,github-sync}`
(~100 files, ~15.7k lines of code, plus deployment wiring: runit defs, `server-ce/config/env.sh`,
`/data_1/docker/compose_cep/overleafserver/compose.yaml`, `server-ce/nginx`, `settings.defaults.js`).

Method: six parallel fresh-context reviewer lanes (webdavinterface, datamanipulator, webdav module,
dropbox, githubsync, cross-cutting). The child model (qwen3.8, high thinking) timed out on all six
before writing reports, but the full file-read set was captured; the parent then verified every
finding below by direct file read (line-level). Findings marked *(verified)* were re-checked in code.

Severity basis (per project rule): anything that can cause silent data loss — no-op push,
delete-on-pull, spurious overwrite, orphaned sync state, unlink that doesn't actually
unlink — is CRITICAL by definition.

---

## 1. CRITICAL findings (data safety / secrets)

### C1. Dropbox **pull overwrites locally-edited files** (no "local changed" gate)
- Where: `services/web/modules/dropbox/app/src/DropboxRouter.mjs` → `importProjectFromDropbox()`
  (the pull path, ~lines 246–320).
- What: the only gate is the ARC-09 rev check — *skip files whose remote rev is unchanged*.
  When a remote file **changed** (rev differs), the code downloads it and calls
  `EditorController.promises.upsertDocWithPath(projectId, path, lines, 'dropbox', userId)`
  (text) / `upsertFileWithPath` (binary) — **unconditionally replacing local content**.
  There is no stored local-hash, no "both sides changed → conflict" check.
  Contrast: the WebDAV lane (`WebdavSync.pollUser`) *does* compute
  `localHashAtLastSync` vs current local hash and blocks as a conflict.
- Scenario: user edits `main.tex` in Overleaf → clicks "Pull" (or re-imports) → remote version
  wins, local edits destroyed, history shows a `dropbox`-origin update. This matches the
  user's historical data-loss incidents.
- Fix: store `localHash` per file in `state.remoteFiles` entries (set on every successful
  push/pull, computed from the exact bytes that were last synced into the project).
  In `importProjectFromDropbox`, before applying a file whose remote rev changed:
  re-read current project content (doc lines join / filestore blob), hash it, compare against
  stored `localHash`.
  - local unchanged → apply remote (safe), update `localHash`.
  - local changed → do **not** apply; record conflict (`mergeStatus:'conflict'`,
    `lastConflict.{path, allPaths}`), notify. The existing
    `POST /project/:id/dropbox/conflict/resolve` (keep-local / keep-remote) already exists and
    works (keep-remote re-imports the named file under `withProjectSyncLock`).
  - Same guard for the `importNewProjectFromDropbox` `projectId` variant (import-into-existing
    project).
- UI/UX: on conflict, the dropbox modal must surface which files were not applied and offer the
  resolve buttons (see C2 pattern). Current pull success toast fires even when a conflict is
  recorded — the response JSON already carries `conflicts`/`skippedDeletions`; extend to
  `importResult.conflicts` and render a `OLNotification` instead of a bare `alert()`.

### C2. WebDAV **conflict resolution is a no-op** and the `Mongo $unset` never runs
- Where: `services/web/modules/webdav/app/src/ConflictResolver.mjs` → `resolve()` and
  `detectConflict()`.
  - `resolve('local')`: only updates the state doc; **never pushes local content to the remote**
    (comment says "no remote change needed" — wrong: the remote holds the *other* version).
  - `resolve('remote')`: also state-only; comment claims "next sync will pick up changes", but
    `pollUser` will re-detect a conflict (local hash still differs) → infinite conflict, or a
    spurious apply.
  - **Mongo bug**: `updateProjectState(projectId, { mergeStatus, lastSyncAt, $unset: {...} })`
    → `$unset`/`$push` are passed *inside* the `$set` payload → stored as literal field names
    (`"$unset"`), so `lastConflict` is **never cleared** — the conflict indicator persists
    forever and `conflictingPaths` never accumulates (`detectConflict` has the same `$push`-in-
    `$set` bug).
  - `WebdavSync.resolveConflict()` (the version that *does* push/pull content) is exported but
    **never wired to any route or UI** — grep confirms no caller.
  - No UI exists: no component in `modules/webdav/frontend` calls
    `POST /project/:id/webdav/conflict/resolve` (comment in webdav-widget.tsx:83-111 claims the
    sync modal handles conflicts — it doesn't).
- Scenario: a real WebDAV conflict (both sides edited) is unrecoverable from the UI: the user
  sees "N file(s) changed on both sides" forever; the only "fix" is unlink + relink.
- Fix:
  1. `ConflictResolver.resolve` must perform real work, delegating to
     `WebdavSync.resolveConflict(userId, projectId, path, 'keep-local'|'keep-remote')` (it
     already implements both directions correctly, incl. `markInboundProject` echo suppression)
     and then clear state with a *correct* update:
     `updateOne({projectId}, { $set: { mergeStatus:'clean', lastSyncAt: new Date() }, $unset: { lastConflict: 1, conflictingPaths: 1 } })`.
  2. `detectConflict`'s "conflictingPaths" accumulation should use a real
     `$push: { conflictingPaths: path }` (or drop the field entirely if unused).
  3. UI: in `webdav-sync-modal.tsx` connected state, when
     `status.lastConflict` is present render a conflict block (path(s) +
     "Keep Overleaf version" / "Keep remote version" buttons → call
     `/project/:id/webdav/conflict/resolve` with `{ path, choice:'local'|'remote' }`,
     i18n keys added to en.json + extracted-translations.json), and clear local state on success.
  4. Pass `userId` from the session (router already has it; `ConflictResolver.resolve` needs it —
     extend signature or pass via req).

### C3. WebDAV **project unlink does not actually remove the link** (poller keeps applying remote changes)
- Where: `WebdavHandler.unlinkProject()` (only deletes the `WebdavSyncProjectStates` doc) and
  `WebdavSync.pollUser()` (iterates *remote folders* + `findUsersProjectsByName`; **never checks
  link state or `credentials.syncedProjects`**).
- Scenario: user unlinks a project → remote folder still exists → next manual pull (or any
  future auto-sync) re-applies remote changes into the "unlinked" Overleaf project. Unlink is
  cosmetic only — the exact failure class the user reported with Dropbox historically.
  (Partially masked today because there is no poller — but `pollProject` is a live endpoint and
  `syncProjectForLinkedUsers` / rename/delete paths still fire.)
- Fix:
  1. `pollUser` must treat link state as authoritative: before processing a remote folder,
     `skip unless` `credentials.syncedProjects?.includes(projectName)` **and** a
     `WebdavSyncProjectStates` doc exists for the matched project.
  2. `unlinkProject` must also call `WebdavCredentials.forgetProject(userId, projectName)`
     (removes `syncedProjects` entry + `remoteState[projectName]`) — it needs the project name
     (fetch via `ProjectGetter`), and the **owner** semantics: prefer the state doc's `ownerId`;
     if unlinker is a non-owner write-editor, still allow (matches `ensureUserCanWriteProjectContent`).
  3. `deleteProjectForUsers`/`moveEntityForLinkedUsers` paths already call `forgetProject`/
     `renameProject` — keep.
- UI/UX: after unlink, the settings "Last synced" entry for that project must disappear (the
  `/user/webdav/status` list is already per-state-doc — OK) and the modal must show the
  not-linked state on reopen.

### C4. Credential encryption key in production is a **committed placeholder**
- Where: `/data_1/docker/compose_cep/overleafserver/compose.yaml`
  `WEBDAV_TOKEN_CIPHER_PASSWORD: "generate-a-long-random-secret"`.
  Used by: `WebdavTokenEncryption.mjs` (all WebDAV user passwords) and
  `DropboxCredentials.mjs` `getEncryptionKey()` (SHA-256 of the same string for all Dropbox
  access tokens). `github-sync` uses `AccessTokenEncryptorHelper` (verify it is not wired to the
  same env).
- Impact: anyone with the compose file (it sits in `/data_1`, and the value is committed) can
  decrypt **every stored WebDAV password and Dropbox token** in Mongo — full provider access to
  all users' files.
- Fix:
  1. Generate a strong random secret; set `WEBDAV_TOKEN_CIPHER_PASSWORD` in compose env (and not
     in repo).
  2. Migration: with the *old* key, read all `WebdavUserCredentials.credentials` +
     `DropboxUserCredentials.accessToken` + `GitHubSyncUserCredentials.tokens`, re-encrypt with
     the new key, backfill (one-off script, run as `docker exec` before/after deploy; keep
     legacy-key candidates in both decryptors already in `DropboxCredentials.decryptToken` —
     add the same legacy path to the webdav decryptor).
  3. Add a startup self-check that the key entropy ≥ threshold (refuse to start with
     `generate-a-long-random-secret`).
- Also: set and enforce `SHARED_SERVICE_TOKEN` (see S2).

### C5. `githubinterface /clone` accepts `repo_url` without scheme validation → **local git repo read (`file://`) + internal SSRF**
- Where: `services/githubinterface/app/src/server.mjs` `/clone` handler —
  `validateGitServerUrl()` is only applied to the optional `server_url`, **not** to `repo_url`,
  which is passed straight to `git clone`.
- Scenario: `repo_url = "file:///some/container/git/repo"` clones any local git repository into
  the work root; `/log` then returns its commit history and `/status` its file listing — both
  are readable by the caller. Through the legit UI this is reachable by saving an arbitrary
  server URL (no URL validation in `GitHubSyncController.addServerConfig` / `linkPAT`) and
  importing a "repo" whose full name resolves to a `file://` URL via
  `GitServerClient.clone`. Also `http://127.0.0.1:<port>` / other internal hosts (SSRF probe).
- Fix (all of them):
  1. In `/clone` (and `/can-push`, `/branch-head`, `/commits`, `/push`'s remote target):
     **parse the final URL and enforce**: `protocol ∈ {http: https:}` **and** `hostname` equals
     the registered `server_url` hostname (pass the expected host from the caller). Reject
     otherwise with 400.
  2. Validate server URLs at save time in `GitHubSyncController.addServerConfig`/`linkPAT`
     (scheme + absolute URL; optionally require https for non-localhost).
  3. Same final-host check for the webdavinterface bridge (users' `server_url` is arbitrary):
     at minimum reject `file:`, `gopher:`, and document the container-internal reachability.
- Verification: unit tests driving the express app (supertest is already a dep pattern in
  `datamanipulator`) with `file:///etc/git/...` and `http://127.0.0.1:4000/repo.git`.

### C6. `datamanipulator` — **no project-id validation** (tree/file read + delete outside project dir) and **auth is optional (unset in production)**
- Where: `services/datamanipulator/app/src/server.mjs` `getProjectDir(projectId)` =
  `${projectsRoot}/${projectId}` with `projectId` taken raw from the query string.
  `walkTree`/`readFile`/`deletePath` then operate on that path.
- Scenario: `?project_id=../../..%2F..` (or literal `..../`) resolves outside
  `DATAMANIPULATOR_PROJECTS_ROOT` → `/tree`, `/file` (GET content), **`DELETE /file`** on
  arbitrary container paths readable/writable by www-data. Combined with the service token being
  **unset in production** (S1/S2), any in-container process can drive this.
- Fix:
  1. Validate `project_id` against Overleaf's 12-char hex format
     (`/^[0-9a-f]{12}$/i`) on **every** route; reject otherwise (400).
  2. Belt-and-braces: after `getProjectDir`, `Path.resolve` and re-check the prefix (same guard
     `resolveProjectPath` already applies to subpaths).
  3. Enforce `SHARED_SERVICE_TOKEN` on this service (S2) — then the attack surface requires the
     token.
- Note: the same "degraded-mode" token pattern exists in webdavinterface (server.mjs:24-50),
  dropboxinterface (server.mjs:34-55) — all four are unauthenticated in the live container.

---

## 2. HIGH findings (correctness, security hygiene, broken features)

### H1. `WebdavCredentials.withUserLock` — lock chain **hangs the user forever** on one rejected op
`WebdavCredentials.mjs` `withUserLock()`: `await previous` is *outside* the try/finally; if the
previous waiter's task rejects, `release()` is never called → `current` never settles → **all**
subsequent credential ops for that user (`updateSyncStatus`, `forgetProject`, `markProjectSynced`,
`renameProject`, `remove`) hang forever. (The identical pattern in `WebdavSync.withUserSyncLock`
deliberately uses `await previous.catch(() => {})`; TokenManager's lock is chain-safe — this one
broke the pattern.)
Fix: `await (previous || Promise.resolve()).catch(() => {})` before the try block (or restructure
like `TokenManager.withUserLock`). Add regression test: reject first op, second op must complete.

### H2. `/project/:project_id/webdav/files` is broken (wrong function arity)
`WebdavController.listFiles` calls module-level `getProjectName(projectId)` — but that function is
the Express handler `(req, res)` and reads `req.params.project_id`; with `req=projectId` it throws
→ the endpoint always 500s. Fix: extract a real `async function getProjectNameFromId(projectId)`
helper and use it in `listFiles` (keep the route handler thin over it). Test via the router.

### H3. WebDAV **stale-etag bookkeeping re-downloads every file every cycle and pollutes history**
`WebdavSync.syncProject`: after a successful PUT, `nextState[filePath].etag` stores the
**pre-PUT** etag (the server's new etag is never captured — the `/file` POST response carries
none). Next poll: `sameIdentity(prev, entry)` = false → "remote changed" → local hash equal →
**apply remote** → `TpdsUpdateHandler.promises.newUpdate` → a *phantom `webdav`-origin update*
per file per cycle (history churn, version bumps, `lastSyncAt` flapping) even though content is
identical.
Fix: after `putProjectFile`, fetch the new etag (PROPFIND/`GET` headers or `stat`) and store it;
or skip `get()`+`newUpdate` in `pollUser` when `sha256(body) === prev.localHash` **and** localHash
equals current local hash (content-unchanged check before applying — cheap guard that kills the
churn even if etag is unknown). Add a test: push once, poll once → zero project updates.

### H4. WebDAV `resolveConflict(keep-local)` uses `client.put` **without If-Match** → clobber window
`WebdavSync.resolveConflict` keep-local: `await client.put(resourcePath, docLines)` — no etag /
If-Match from the conflicted listing; if the remote changed between detection and resolution the
local write silently overwrites a third edit. Fix: resolve with `etag: <etag captured at
conflict detection>` (store it in `lastConflict.remoteEtag`) so the server rejects with 412 if
the file rotated; surface the 412 as "remote changed again, re-check". (The `put` path already
supports `options.etag` → `If-Match`.)

### H5. Link endpoints create state **before** the first push; a failed initial push leaves an orphaned "linked" project that the poller then serves
`WebdavController.linkProject`: `createProjectState` → `pushLocalChanges` (long sync). If the
push throws (network, 412, partial failure), the state doc remains → UI shows failure, but the
project is linked and remote changes will be pulled into it (and webdav C3 shows unlink doesn't
even stop that). Fix: on push failure, delete the just-created state (or mark `mergeStatus:'failed'`
+ `lastSyncError`, and *do not* add to `syncedProjects`/`remoteState` until a successful push).
Same shape for Dropbox `link` (state saved, then `uploadProjectToDropbox` can throw — state doc
remains with `connected:true` and no `remoteFiles`).

### H6. Dropbox **user-level disconnect deletes other users' state docs** (path-keyed delete)
`/user/dropbox/disconnect`: `DropboxSyncProjectStates.deleteMany({ path: pathToUnlink })` —
matches by *path string*, not user. Two users sharing the same configured path (e.g. the default
`/`) → user A's disconnect silently deletes user B's project links. Fix:
`deleteMany({ path, $or: [ { ownerId: userId }, { ownerId: { $exists: false } } ] })` — i.e.
owner-scoped (legacy docs without `ownerId` only if path matches **and** they are the default
path — decide and document; safest: only `ownerId`).

### H7. `keep-remote` (webdav + dropbox) resolves with **raw English in UI + `alert()`** and broken interpolation
- 6 keys use `{{var}}` though the i18n config uses `__var__`: `failed_to_link_webdav`,
  `failed_to_unlink_webdav`, `failed_to_link_dropbox`, `failed_to_unlink_dropbox`,
  `dropbox_pull_failed`, `dropbox_push_failed` → users see literal `{{fallback}}`/`{{error}}`
  in the alert. Fix: rewrite values to `__fallback__`/`__error__` (or drop interpolation entirely
  and pass the detail as a second line).
- `webdav-sync-modal.tsx` / `dropbox-sync-modal.tsx` use `alert()` for every success/error —
  replace with in-modal `OLNotification` (state `busy/status/error`), which also fixes the
  false-success case below.
- `handleUnlinkProject` (webdav modal): **no `response.ok` check** on the DELETE — a 500 still
  flips UI to "unlinked". Fix: treat `!ok` as failure, keep linked state, show the message.
- github-sync: t-key `serverUrl` used in a component but missing in `en.json` (and extracted) →
  raw key renders.

### H8. Error/secret leakage from microservices back into UI + logs
- `webdavinterface/server.mjs`: `console.error('WebDAV check failed:', err)` and
  `res.status(500).json({ error: err.message })` — the `webdav` npm client embeds credentials in
  request URLs; its error messages/stacks can carry `http://user:pass@host/...` → lands in
  `/var/log/overleaf/webdavinterface.log` **and** in the JSON returned to the browser.
  `auth.mjs` has `sanitizeUrlForLogging` — **never imported anywhere** (dead safeguard).
  Fix: catch → map to typed status (401/404/412/502) + generic message; log with sanitized URL
  (`sanitizeUrlForLogging(serverUrl)`) and err *code* only; never return provider error text
  verbatim. Apply the same discipline to `githubinterface` (`res.json({error: err.message})` in
  /push /pull /clone — `err.message` = "Command failed: git ..." is safe *only* because askpass
  keeps creds out of argv; keep that invariant and assert it in tests) and to
  `dropboxinterface` (429/500 bodies forwarded with `Dropbox: Service error ... - ${data}`).
- `githubinterface /check` on 401/403 returns the provider body (`detail: text`) to the caller —
  strip/bound it (500 chars max, no token).

### H9. githubinterface `askpass` filename collision (same ms ⇒ cross-request credential mix)
`runGit()`: `ghif_askpass_${pid}_${Date.now()}.sh` in shared tmpdir. Two concurrent git ops in
the same millisecond can race: the second `writeFileSync` overwrites the first's credentials
mid-run → wrong token used for the other request (self-serviced, but cross-user mix). Fix: use
`crypto.randomBytes(8).toString('hex')` (already the pattern in `/commits` dir naming), and pass
`GIT_ASKPASS` via env (already done) — keep.

### H10. `github-sync` account-level unlink wipes **all providers** and is dead-but-live
`TokenManager.removeUserToken(userId)` (route `POST /user/github-sync/unlink`) does
`GitHubSyncUserCredentials.deleteOne({userId})` → destroys PATs for *every* provider/server,
while project states keep referencing them (broken links everywhere). Today the custom UI never
calls it (verified: frontend only calls `/project/:id/github-sync` and
`/user/git-servers/:id`, both granular), but it's one bad wiring away. Fix: either delete only the
default-github entry, or rename the route + add a confirmation that it clears all providers and
also unlinks all project states (delete `githubSyncProjectStates` where ownerId — with
notifications), or remove the route.

### H11. WebDAV `/user/webdav/poll` is a silent no-op, and no poll driver exists — **DECIDED (D1): manual-only**
- `WebdavRouter` `/user/webdav/poll` body: "For now, just acknowledge the poll request without
  performing sync" → any UI wiring it reports success while nothing happens.
- `WEBDAV_POLL_INTERVAL_MS=300000` in compose is **referenced by no code** — there is no
  setInterval / cron / hook calling `pollUser`. All webdav "sync" is manual.
  **Decision D1:** keep sync manual-only. Remove `/user/webdav/poll`, remove
  `WEBDAV_POLL_INTERVAL_MS` from compose/env.sh, document "manual sync" in the modal copy.
  (`pollUser`/`pollProject` stay as the engine behind the manual "Pull" button; P0-6 adds the
  link-state gating inside it.)
- Dropbox has no automator either — consistent with D1; "Last synced" copy must not imply
  automagic behavior.

### H12. `WebdavController.linkProject` requires `credentials.rootPath` while every other path falls back to `Settings.webdav.rootPath`
Connected user without an explicit rootPath (form allowed it; server saves whatever) → link is
permanently 400 ("credentials are not configured") while sync/poll would have worked with the
default. Fix: `rootPath = credentials.rootPath || Settings.webdav.rootPath` in `linkProject`
(and store the effective value on the state doc).

### H13. WebDAV `state.connected` is computed by a **live PROPFIND on every `/state` read** (modal + panel)
`WebdavHandler.getProjectState` → `client.check()` per call; any network hiccup ⇒
`connected:false` ⇒ modal shows "project is not linked" although it is; user clicks
"Link again" (upsert over existing). Same in github-sync `getProjectState` (`canPush`
ls-remote per render). Fix: report stored state + last-verified time; verify lazily only when the
user clicks Link/Unlink/Sync (or throttle per project, e.g. 60 s). UI: distinguish
"not linked" from "unreachable (try again)".

### H14. `githubinterface` push/pull `remote` + `ref` are attacker-shaped; no non-FF guard surfaced
`/push { remote, ref }`: `remote` is caller-chosen → `git push <url-like> refspec` can push the
cloned content (and its credentials via askpass) to *any* http(s) URL the caller supplies.
Within-deployment the only callers are the web module, but the service is unauthenticated (S1).
Fix: in `/push`/`/pull` restrict `remote ∈ {'origin'}` and `ref` to `refs/heads/...`/branch names;
explicitly reject force (`+`) refspecs (current behavior is non-force by default — make it a
policy + test). Return git's `rejected (non-fast-forward)` as a typed 409 with a
"repo diverged — re-fetch" message for the UI.

### H15. Import-from-git of an **empty repo** creates a blank project but then *still* writes sync state against `defaultBranchHead` that may be null → next `merge/overview` treats as diverged
`GitHubSyncHandler.importRepo`: `getBranchHead` on an empty repo throws/returns null →
`lastSyncCommit: null`. `getMergeOverview` then can't compute `since` (full-clone path) →
`diverged: true` UI on a project with no changes. Fix: if head unresolvable (empty repo),
persist `mergeStatus:'need-export'`-equivalent/`lastSyncCommit:null` **and** make
`getMergeOverview` treat `lastSyncCommit == null` as "no baseline yet": skip divergence,
`isProjectUpdated` false, commits []. (Small, but it's the kind of edge that reads as a bug.)

### H16. Dropbox conflict "keep-local" semantics leave a **perpetual desync** with no re-sync trigger
`/conflict/resolve keep-local` clears the flag but the remote keeps the other version; the next
push hits the same rev gate → conflict again (or worse, after a remote rev change, the gate
treats it as changed → conflict again). The UI must explain: "kept Overleaf's version; the
Dropbox folder keeps its own copy until you Push" — and "Push" after keep-local should force
push that file (pass the conflict path to `uploadProjectToDropbox` as an override set, bypassing
the rev gate for *that file only*, with an If-... rev check from the *latest* listing).
Fix in `uploadProjectToDropbox`: accept `forcePaths: Set<relPath>` (the resolution's
`filePath`), skip `isConflictedLocalPush` for those and use the current rev as precondition if
the Dropbox client `upload(..., { rev })` supports it (it accepts a `rev` param — wire it).

---

## 3. MEDIUM findings (robustness, UX, hygiene)

1. **i18n gaps / hardcoded English**
   - `webdav-widget.tsx`: 10+ hardcoded English UI strings (title, labels, "Disconnect",
     "Connect", "To sync files, open a project…") — add keys (en.json + extracted) or reuse
     existing (`webdav_link_project_button` etc. already exist).
   - `webdav-sync-modal.tsx`: hardcoded "WebDAV credentials not found. Please connect your
     account first." and the button flow — key + modal.
   - Backend-generated user-facing strings ("N file(s) changed on both sides (first: …)",
     "Remote project folder not found…", "Push completed with N conflict(s) …") surface verbatim
     in the UI for non-English users — convert to typed error codes (`errorCode` + params) like
     github-sync's `github_validation_*` pattern; translate client-side.
   - `common.cancel`, `common.select_project`, `project.project` used in the webdav widget/modal
     are missing in `en.json` (upstream may provide them — verify at build; if not, add).
   - `webdav_pull_failed` / `webdav_push_failed` missing from extracted-translations.json (raw
     key risk) — add.
   - github-sync `serverUrl` key missing (H7).
2. **Dead / divergent code to prune or reconcile** (drift hazard; reviewer confusion factor):
   - `WebdavHistoryManager.mjs` — imported by nothing (dead).
   - `WebdavTokenManager.mjs` — duplicates `WebdavCredentials` (only `getConnectionState` uses
     it); its `saveUserCredentials(userId, creds, {force})` takes an ignored 3rd arg.
   - `WebdavClient.mjs` (540 lines) + `WebDAVAdapter.mjs` — legacy direct clients used only by
     the adapter, which nothing imports in the live path.
   - `ConflictResolver` vs `WebdavSync.resolveConflict` — two conflict models (merge C2).
   - `GitServerClient.mjs` (module) vs `githubinterface`'s client; `SyncStateManager` (webdav
     vs github-sync) — two state managers, two Mongo stores per provider. Keep one per provider,
     document the store shape; delete the rest after C2.
   - Dropbox: *two* DropboxClients (module + service) — module client talks to the service
     (localhost:4003) then service relays to api.dropbox.com: verify there is no path where the
     module client hits api.dropbox.com directly with the token in a `X-Access-Token` header to
     an unauthenticated service (it talks to the service — fine), and delete whichever copy is
     unused after the audit.
3. **Large-file / memory limits**
   - `datamanipulator walkTree` reads *every* file into memory (checksums); no per-project caps;
     `express.json 10mb` body limit ⇒ the push/pull JSON paths of datamanipulator are unusable
     above ~7.5 MB files (document; the live webdav/dropbox paths stream base64 through
     webdavinterface `50mb` / dropboxinterface — still buffered in Node on both sides).
   - `WebDAVServiceClient._fetch` timeout default 10 s (env `WEBDAV_REQUEST_TIMEOUT_MS`) aborts
     large slow transfers; retries (2) with 250 ms base are too small vs provider RTT — raise
     defaults (e.g. 60 s per op, backoff 1 s base, cap attempts by bytes) and surface
     "transfer timed out" distinctly.
   - `WebDAVClient.download` returns the whole file as base64 JSON — 100 MB file ⇒ 133 MB JSON
     response through three processes. Document the practical ceiling; consider a streaming
     proxy endpoint (X-Accel-Redirect style) later.
4. **Project-name edge cases break remote layout**
   - Name with `/` (`a/b`) creates nested remote folders while sync/poll expects one dir per
     project (webdav + dropbox both join by name). Fix: sanitize at link time (reject or map to
     `_`), and in poll matchers normalize the same way.
   - `remotePath(rootPath, projectName)` with `rootPath===undefined` ⇒ literal `"null/..."`
     (webdav import path) — guard.
   - `relativeDropboxPath` fallback to `entry.name` flattens nested files on path mismatch
     (renamed folder on Dropbox side) → wrong-path import. Fix: when no entry matches the
     project prefix, abort the import with a clear "path changed on Dropbox — re-link" error
     instead of guessing (ARC-06 spirit).
5. **`walkTree` hidden-file inconsistency** (datamanipulator): dotfiles are included, but
   hidden dirs are listed without being recursed (`.git` appears as a phantom directory entry,
   which `treeCompare` then classifies "identical" via `undefined === undefined`). Exclude
   hidden dirs *and* files (or both) consistently; skip `.git`/`node_modules` (already) and
   LaTeX transient outputs (`*.aux *.log *.out *.toc *.fls *.synctex.gz *.bbl?`) — decide with
   user (Q2); today they sync as text (mostly harmless but churning).
6. **`treeCompare` size-fallback**: files with no checksums and equal size are classified
   `identical` → missed real change. Change fallback to "unknown → treat as conflict/needs-
   review", never identical.
7. **Binary detection edge**: `detectFileType` scans first 8 KB; >5 % NUL ⇒ binary. A binary
   with no NUL in the first 8 KB + valid UTF-8 sample would round-trip as text via text-only
   paths. The byte-preserved paths (base64) make actual corruption unlikely today; still, add a
   "text extension" whitelist check (textExtensions) before treating unknown-ext text as
   text-eligible on sync.
8. **`detectFileType` dead code**: `if (!(byte >= 0 && byte <= 255))` is always false (bytes
   are 0–255) — the Latin-1 branch is effectively "not UTF-8 and no NUL ⇒ text". Either
   implement real Latin-1 heuristics or delete the branch.
9. **`webdav GET /file` password fallback to `req.body`** (webdavinterface server.mjs) — GETs
   with bodies are non-standard and most clients drop them; pick one transport (Basic header, as
   the module does) and delete the body path.
10. **`/user/webdav/status` returns `projects[0]` sync info** (arbitrary Mongo order, not most
    recent). Fix: `sort({ lastSyncAt: -1 })` / aggregate latest, or return per-project list.
11. **github-sync merge is GitHub-only; self-hosted providers (GitLab/Gitea/Forgejo) get a 501
    "merge only supported for GitHub"** → their conflicts are a dead end (export/import work).
    Document prominently in the provider modal (Q3) or implement the merge engine over the
    provider REST API (large effort — out of scope for this plan).
12. **`/status` always reports ahead/behind 0** (githubinterface) — compute from
    `git rev-list --left-right --count` or mark "unknown" so the UI doesn't lie.
13. **Temp-file `Date.now()` names** (dropbox resolve/import): `overleaf-dropbox-resolve-${Date.now()}`
    can collide under concurrent resolutions → use `randomBytes` (already imported by the router
    as `randomBytes` — wire it).
14. **`express.json` limits** inconsistent: 10mb (datamanipulator, githubinterface) vs 50mb
    (webdav/dropboxinterface) — the *web* process JSON body limit also applies to the module
    endpoints (verify `app.use(express.json(...))` upstream) — a `POST /file`-style body > limit
    fails with a raw 413; align + document.
15. **`getProjectState` (webdav) returns `baseUrl` and `username`**: fine, but ensure the
    password is *never* in `state`/response (verified it isn't — keep a test asserting that).
16. **Logging hygiene**: `LOG_LEVEL: debug` in production compose + services logging full
    `err` objects (with provider bodies) — set `log.level: info` for production; keep debug for
    dev. Ensure no `console.log` of `req.body` (grep found none — keep a lint rule).
17. **No indexes** on `DropboxSyncProjectStates.path` (used by disconnect deleteMany),
    `WebdavSyncProjectStates.username` (legacy selector) — add indexes in the models.
18. **Test coverage holes** (all lanes): unlink/keep-remote flows (webdav H2/H4, dropbox H16),
    the C5 file:// rejection, C6 project-id validation, H1 lock-hang regression, H3 no-phantom-
    update, and the i18n `{{}}` offenders (a tiny i18n lint test: every `{{` in provider keys ⇒
    fail). Add these as acceptance tests in the fix phase.
19. **Widget UX parity**: webdav widget "Disconnect" doesn't mention that project links remain
    (they do) — add a hint line; dropbox widget should mirror webdav's last-sync line (uses
    state per project — verify the widget fetches the *latest* state, not any doc).
20. **`importRemoteProject` (webdav) with 0 files** silently succeeds ("Import completed") —
    return `importedFiles: 0` and let the UI say "folder was empty".

---

## 4. LOW findings (cleanup)

- `webdavinterface/server.mjs` `GET /file` 404 message echoes query path (informational; keep).
- `WebdavController.getConnectionStatus` unused by the router (the `/status` route inlines its
  logic) — remove or wire.
- `githubinterface` `/log` + `/status` accept `Authorization: Bearer <PAT>` headers they never
  read (dead protocol in `GitServerClient.log/status`) — delete.
- `datamanipulator /push` 501 manifest includes directory entries and hidden entries (filter).
- `WebdavRouter /project/new/webdav` logs `baseUrl`/`username` on error — fine, but keep the
  explicit "never log password" comment + test.
- `settings.defaults.js` `webdav` block appears twice (line 211 & 299) — dedupe.
- `index.mjs` (webdav): the trailing `logger.debug('WebDAV module ready')` runs even when the
  module is disabled — move inside the gate.
- `datamanipulator` node_modules dir contains only `.vite*` (express is hoisted to repo root —
  verify Docker image copies root node_modules for `COPY --parents` services; if not, datamanipulator
  crashes at boot — check the running container once: `docker exec overleafserver ls /overleaf/node_modules/express`).
- `githubinterface` `GITHUBINTERFACE_MAX_OPS=8` default with 10-min git timeouts: 8 hung clones
  exhaust the pool; add a shorter default timeout for check/list ops (client already uses 60 s
  for most — align service side `timeout` for ls-remote to 30 s).
- `DropboxCredentials` legacy deterministic keys are still accepted for *decrypt* (documented) —
  add a one-time migration to re-encrypt and disable legacy acceptance (Q5).

---

## 5. Deployment/config facts used above (verified)

- Ports: web 4000 · datamanipulator 4001 · webdavinterface 4002 · dropboxinterface 4003 ·
  githubinterface 4013; runit defs `server-ce/runit/*-overleaf/run`; only host port 80 exposed.
- `SHARED_SERVICE_TOKEN`: **absent** from `/data_1/docker/compose_cep/overleafserver/compose.yaml`
  ⇒ all four services degraded-unauthenticated (their own startup warnings confirm).
- `WEBDAV_TOKEN_CIPHER_PASSWORD="generate-a-long-random-secret"` in the live compose (C4).
- `WEBDAV_POLL_INTERVAL_MS=300000` set but unused by code (H11).
- Widgets registered via `settings.defaults.js integrationLinkingWidgets` (webdav, dropbox,
  github-sync) + `importProjectFromGithubModalWrapper`; gating flags `webdavEnabled` /
  `githubSyncEnabled` set in `ExpressLocals.mjs:419-422`.
- i18n: `en.json` has all webdav/dropbox functional *labels*; the failures are the 6 `{{}}`
  error keys (H7), `serverUrl` (H7), and the two missing-from-extracted webdav keys (M3).

---

## 6. Fix plan (phased)

Execution order respects the project rule: static verification → single batched rebuild →
restart → end-to-end UI verification. **No rebuild until Phase 0+1+2 code is lint-clean
(`yarn lint` / `eslint --max-warnings 0` on touched services) and `node --check` passes on
every changed `.mjs`.**

### Phase 0 — Data safety & secrets (must land first)
| # | Change | Files | Notes |
|---|--------|-------|-------|
| P0-1 | C6 project-id validation + token enforcement | `datamanipulator/app/src/server.mjs` | 12-hex regex guard on every route; keep degraded mode only if token set |
| P0-2 | S1 set + enforce `SHARED_SERVICE_TOKEN` | compose env; (code already ready in all 4 services + 3 clients) | generate `openssl rand -base64 48`; verify runit `env.sh` inherits it; alive-check `/health` stays open |
| P0-3 | C4 cipher key rotation + re-encryption | compose env; migration script; `WebdavTokenEncryption.mjs` (legacy candidate) | script re-encrypts webdav + dropbox (+ check github-sync helper) creds; dry-run first |
| P0-4 | C5 `repo_url`/final-URL validation | `githubinterface/app/src/server.mjs`, `modules/github-sync/.../GitHubSyncController.mjs`, `GitServerClient.mjs` | final-URL parsing + host allowlist from saved server; save-time validation; tests |
| P0-5 | C1 Dropbox pull local-hash gate | `DropboxRouter.mjs` (+ `state.remoteFiles` shape), `dropbox-widget`/modal | mirror webdav ARC-05 semantics; conflicts recorded, not applied |
| P0-6 | C3 webdav unlink authority + poller gating | `WebdavHandler.mjs`, `WebdavSync.mjs` (pollUser), `WebdavCredentials.mjs` | state doc + `syncedProjects` both required; `forgetProject` on unlink |
| P0-7 | C2 webdav conflict resolution (real ops + Mongo `$unset` fix + UI block) | `ConflictResolver.mjs`, `WebdavController.mjs`, `webdav-sync-modal.tsx`, i18n keys | wire to `WebdavSync.resolveConflict`; keep `If-Match` (H4) |

### Phase 1 — HIGH correctness
| # | Change |
|---|--------|
| P1-1 | H1 `withUserLock` chain fix + regression test |
| P1-2 | H2 `listFiles` helper split + test (webdav `/files`) |
| P1-3 | H3 etag-after-put + content-unchanged guard in `pollUser` + test (no phantom updates) |
| P1-4 | H5 orphan-state cleanup on failed link/push (webdav + dropbox) |
| P1-5 | H6 path-keyed disconnect scoping (`ownerId`) |
| P1-6 | H7 i18n `{{}}`→`__var__` fixes, `serverUrl` + missing keys, `alert()` → `OLNotification`, `response.ok` checks on unlink (both modals) |
| P1-7 | H8 error-mapping + sanitized logs in webdavinterface/dropboxinterface/githubinterface; no provider body in responses |
| P1-8 | H9 askpass random name |
| P1-9 | H10 account-unlink scope decision + fix (or route removal) |
| P1-10 | H14 remote/ref restrictions on /push /pull |
| P1-11 | H12/H15/H16 small flows (rootPath fallback; empty-repo baseline; keep-local re-push override) |
| P1-12 | H13 render-time live checks → stored state + explicit "verify" action |

### Phase 2 — UX/robustness
| # | Change |
|---|--------|
| P2-1 | i18n sweep (M1): widget hardcoded strings → keys; backend error codes client-translated |
| P2-2 | H11 poller decision: implement (settings `webdav.autoSync` + interval) **or** remove stub env + endpoint and copy; document manual-only |
| P2-3 | Dead-code prune (M2) after P0-7 (remove `WebdavHistoryManager`, reconcile `WebdavTokenManager`, legacy `WebdavClient`/adapter, one `GitServerClient`) |
| P2-4 | M3–M7 limits + temp names + project-name sanitization (link-time reject `/`) |
| P2-5 | M13 temp-file random names (dropbox) |
| P2-6 | M17 indexes; M18 test battery (acceptance list above) |
| P2-7 | Provider-parity docs in provider modals (GitHub-only merge; manual sync) |

### Phase 3 — Polish & hardening
LOW list items (L-table), LOG_LEVEL per env, eslint ignore for `probe.mjs` already configured,
docs (`README.md` per service: real API surface post-audit).

### Verification per AGENTS.md definition of done
1. `eslint --cache --cache-location ./.cache/eslint/ --max-warnings 0 --format unix .` (affected scopes) +
   `node --check` on every touched `.mjs` (TS-syntax trap).
2. Two `reviewer` subagents (fresh context): one on the final diff, one hunting "unintended
   behavior changes" — must agree before rebuild.
3. Rebuild once (all code changes batched): `make all` (≈30 min) → `cycle_overleafserver.sh`.
4. **End-to-end UI verification (not build-healthy):** using the dev-server test skill
   (Playwright login at psintern.neuro.uni-bremen.de, or docker localhost:80):
   - settings → WebDAV widget renders → connect (good + bad creds) → project modal link/push/pull
     round-trip against a scratch Nextcloud folder;
   - induce a real conflict (edit remote + local) → conflict shown → keep-local / keep-remote both
     land correctly (content asserted on both sides);
   - unlink (project + account) → assert state doc gone, `syncedProjects` entry gone, next poll
     does **not** re-apply;
   - github: PAT link (GitHub + a Gitea test server) → export → remote change → merge overview
     → merge; unlink granular vs account;
   - dropbox: link → push → edit remote → **pull must NOT clobber local edit** (C1 regression) —
     the exact historical failure.
5. Log check: `docker exec overleafserver tail -n 300 /var/log/overleaf/{web,webdavinterface,dropboxinterface,githubinterface,datamanipulator}.log` — expect no `SHARED_SERVICE_TOKEN` warnings, no credential-looking strings, module "Enabling WebDAV module" line present.

### Decisions (resolved 2026-08-15)
- **D1 (was Q1): manual-only sync** — remove `/user/webdav/poll` stub + dead
  `WEBDAV_POLL_INTERVAL_MS` env; document manual sync in UI copy.
- **D2 (was Q2): exclude transient/hidden files** from sync in all three providers: `*.aux,
  *.log, *.out, *.toc, *.fls, *.synctex.gz, *.idx, *.vrb` (LaTeX build artifacts) and hidden
  files/dirs (`.gitignore`, `.DS_Store`, `node_modules` already skipped). Applies to push, pull,
  tree-compare and import/export paths.
- **D3 (was Q3): Git-provider merge is a GOAL** — provider parity (see §9.3 for the phased
  design: Gitea/Forgejo via GitHub-API compat, GitLab via v4 adapter, plus a structural
  git-CLI merge engine as follow-up).
- **D4 (was Q4): NO remote-delete** — reverted on 2026-08-15: unlink stays "remove the link
  only" for all providers; remote folder/repo is always kept. (Safer default; no dangerous
  irreversible path in the UI.)
- **D5 (was Q5): Dropbox legacy tokens = dev junk** — user already disconnected everything;
  still rotate the cipher key (C4, mandatory for the real WebDAV/Nextcloud creds). Migration
  script may find 0 Dropbox docs — handle gracefully; keep the legacy decrypt shim one release.

### ⚠ SECURITY: pasted PAT — revoke it
During the failed "Create repository" test you pasted a fine-grained GitHub PAT
(`github_pat_11AM6Y3KI0…`) into chat. **Treat it as compromised: revoke it in GitHub settings
now and create a fresh one** (chat/session logs retain it). That token's scopes ("no access to
any repositories", no user permissions) were the *real* cause of the repo-create failure — the
modal hid that behind a generic "check the repository name" message (U2 below).

---

## 7. User-reported UI defects (verified against code, 2026-08-15)

### U1. Username placeholder renders literally as `your_username`
- Root cause **found**: `git-provider-form.tsx` uses `placeholder={t('your_username')}` and
  `locales/en.json` defines `"your_username": ""` (EMPTY string). i18next with an empty value
  falls back to returning the key itself → literal `your_username` in the rendered HTML.
- Fix: set a real value: `"your_username": "your-username-on-that-provider"` (en.json +
  extracted-translations.json). Sweep en.json for any other empty-string provider keys.

### U2. No guidance on required PAT scopes, and errors hide the real cause
Your failed create-repo attempt is the canonical case: the token lacked repository access,
GitHub answered 403/404, but the modal showed *"Please check that the repository name is valid,
and that you have permission to create the repository"* — a guess, not the cause.
- **Add "required permissions" help text in `GitProviderModal`/`GitProviderForm` (per provider):**
  - GitHub classic PAT: `repo` (covers public+private repo create/read/write). Fine-grained PAT:
    "Contents: Read and write" + "Metadata: Read only" + **access to the target repository**
    (your failing token had "Repository access: none" — that was the blocker).
  - GitLab: personal access token with `read_repository` + `write_repository` (or `api`).
  - Gitea: `repo` (or `repo:read`, `repo:write`). Forgejo: `repo` (or `repo:read`, `repo:write`).
- **Error mapping** (web module + githubinterface): translate provider HTTP status into
  distinct UI messages: `401` → "token invalid or expired — re-link"; `403` → "token valid but
  lacks permission — see the required scopes above"; `404` on create → "name clash or token
  lacks create permission". New i18n keys; never raw provider bodies.

### U3. Dropbox modal shows the configured path but **not the project's subfolder**
`dropbox-sync-modal.tsx` L296-297 renders `status.path` (the configured root, e.g.
`Apps/Overleaf Dev`) — the per-project subpath (`Apps/Overleaf Dev/<project>`) is never
displayed, so you can't see which folder is actually used.
- Fix: `/user/dropbox` state and `/project/:id/dropbox` state return
  `projectPath = configuredPath + '/' + projectName` (state doc stores the full value); UI
  already prefers `status.projectPath` — it just never arrives.

### U4. Integration-panel card copy is GitHub-specific
`en.json:2700 "sync_with_a_github_repository": "Sync with a GitHub repository."` →
**"Sync with a Git provider repository (GitHub, GitLab, Gitea, Forgejo)."** (the settings panel
is the only caller of that key).

### U5. WebDAV widget: Server URL placeholder lacks a concrete example + description key missing
- `webdav-widget.tsx` placeholder is a hack: `t('<url-literal>', {fallback})` — replace with a
  proper key + the requested example, making the `<user>` substitution obvious: e.g.
  `"https://nc.uni-bremen.de/remote.php/dav/files/your-username"` + description:
  "Base URL of the WebDAV server. For Nextcloud/ownCloud use
  `/remote.php/dav/files/<your-username>` — replace `<your-username>` with your account name."
- **`webdav_base_url_description` is missing from en.json entirely** (widget falls back to
  literal) — add it + extracted-translations.json.

### U6. Sync modals flip to "unlinked" on failed unlink (webdav + dropbox)
`response.ok` not checked on the DELETEs (verified in both modals) — a 500 still shows success.
Folded into P1-13.

---

## 8. Master checklist (tracking)

☐ open · ✅ done · ⚠ blocked — update as items land. Phase 0+1 must be fully green before the
single rebuild; Phase 2 may split into a second build window.

### Phase 0 — data safety & secrets
- [ ] P0-1 datamanipulator project-id validation + resolve-guard — *C6* — accept: traversal rejected (unit test)
- [ ] P0-2 `SHARED_SERVICE_TOKEN` live + enforced — *S1* — accept: 401 unauthenticated; no degraded warnings
- [ ] P0-3 cipher key rotation + re-encryption (dropbox = junk, tolerate 0 docs) — *C4, D5* — accept: old decrypts once, new decrypts, entropy check
- [ ] P0-4 final-URL validation githubinterface + save-time URL validation — *C5* — accept: `file://` & internal hosts 400 (unit tests)
- [ ] P0-5 Dropbox pull local-hash gate + conflict recording — *C1* — accept: local edit survives pull; conflict offered (manual test)
- [ ] P0-6 WebDAV unlink authority + poller gating — *C3* — accept: after unlink state gone + poll skips
- [ ] P0-7 WebDAV conflict resolution real ops + Mongo `$unset` fix + UI — *C2* — accept: both choices land; flag clears
- [ ] P0-8 sync file filter (LaTeX transients + hidden), all 3 providers — *D2* — accept: `.aux/.log/.fls` excluded in round-trip
- [ ] P0-9 PAT scopes help text + 401/403/404 error mapping — *U2* — accept: modal shows scopes; 403 → permission message

### Phase 1 — correctness & reported UI defects
- [ ] P1-1 `withUserLock` chain-safe — *H1* | - [ ] P1-2 webdav `/files` 500 fix — *H2* |
- [ ] P1-3 etag-after-put + no-phantom-update — *H3* | - [ ] P1-4 failed-link orphan cleanup — *H5* |
- [ ] P1-5 Dropbox disconnect owner-scoped — *H6* | - [ ] P1-6 i18n sweep (`{{}}` keys, `your_username`, `serverUrl`, `webdav_base_url_description`, card copy, widget strings) — *H7, U1, U4, U5* |
- [ ] P1-7 error sanitation + sanitized logs (3 bridges) — *H8* | - [ ] P1-8 askpass random names — *H9* |
- [ ] P1-9 account-level git unlink scope/confirm/remove — *H10* | - [ ] P1-10 /push /pull remote+ref restrictions — *H14* |
- [ ] P1-11 rootPath fallback, empty-repo baseline, keep-remote force path — *H12, H15, H16* |
- [ ] P1-12 stored-state rendering (no live checks per render) — *H13* |
- [ ] P1-13 unlink: `response.ok` checks on DELETE + unlink keeps remote folder (D4: no remote delete) — *H7, D4, U6* |
- [ ] P1-14 Dropbox modal full project path — *U3* | - [ ] P1-15 remove `/poll` stub + dead env (D1) — *H11* |

### Phase 2 — UX, provider parity, robustness
- [ ] P2-1 Gitea/Forgejo merge via GitHub-API compat (base-URL map + auth) — validate on live Gitea — *D3* |
- [ ] P2-2 GitLab merge adapter (v4 endpoints) — *D3* |
- [ ] P2-3 unified merge UX (banner gone; conflict list all providers) — *D3* |
- [ ] P2-4 (follow-up, optional this release) git-CLI unified merge engine in githubinterface — *D3* |
- [ ] P2-5 dead-code prune (HistoryManager, TokenManager dedupe, legacy client, dead Bearer paths) — *M2, L* |
- [ ] P2-6 limits & tmp names & json limits & GET-body password removal — *M3, M9, M13* |
- [ ] P2-7 project-name sanitization + null-root guard + dropbox path abort — *M4* |
- [ ] P2-8 binary detection whitelist + dead Latin-1 branch — *M7, M8* |
- [ ] P2-9 treeCompare size-fallback → unknown/review — *M6* |
- [ ] P2-10 indexes + settings.defaults dedupe + /status latest fix — *M17, M10, L* |
- [ ] P2-11 non-merge parity docs + /status ahead/behind real-or-unknown — *M11, M12* |
- [ ] P2-12 test battery (C1 gate, C5, C6, H1, H3, i18n lint, unlink flows) — *M18* |
- [ ] P2-13 widget parity (webdav hint, dropbox latest-state, empty-import msg) — *M19, M20* |

### Phase 3 — polish
- [ ] P3-1 LOG_LEVEL per env; no creds in logs — *M16* | - [ ] P3-2 dead endpoints pruned — *L* |
- [ ] P3-3 Docker node_modules sanity (express hoist) — *L* | - [ ] P3-4 service READMEs + provider-matrix table — *L* |
- [ ] P3-5 eslint clean + node --check on all changed .mjs — *DoD* |
- [ ] P3-6 TWO fresh reviewer passes on final diff, agreement — *DoD* |
- [ ] P3-7 single rebuild (`make all`) → restart → log check (token warnings gone, "Enabling WebDAV module") — *DoD* |
- [ ] P3-8 end-to-end UI matrix: webdav connect/link/push/pull/conflict/unlink (remote folder stays), git PAT link + export + merge (GitHub + Gitea, + GitLab if P2-2), dropbox push/**pull-clobber regression**/unlink, widgets, i18n spot-check — *DoD* |
- [ ] P3-9 final report: what/why/commands/exact log lines — *DoD* |

---

## 9. Plan adjustments from decisions & your observations
- **D1** ⇒ H11 becomes a *removal* task (P1-15), not a poller build.
- **D2** ⇒ new P0-8; keep the excluded-list in one const per service (or a small shared util)
  with a lint test asserting the lists are identical across services.
- **D3** ⇒ Phase 2 parity committed (P2-1…P2-3); P2-4 flagged as optional follow-up.
  Note: legacy github-sync state docs lack `syncProvider` → default to `github` (correct).
- **D4** ⇒ simplified on 2026-08-15: no remote deletion anywhere; P1-13 is only the
  `response.ok` fix. Unlink always keeps the remote folder/repo (UI copy states this: "The
  remote folder stays in place.").
- **D5** ⇒ P0-3 migration tolerates 0 Dropbox docs; legacy decrypt shim stays one release.
- **Patrol note**: after P0-3, verify the *real* Nextcloud creds (nc.uni-bremen.de) still
  decrypt under the new key before declaring done (that's the only live provider account).

*End of additions.*

### Rollout
Single rebuild after P0–P2 code lands; P3 can follow in a second build window. The compose env
changes (P0-2, P0-3) require a container restart + the one-off re-encryption script (order:
deploy code with backward-compatible decryptors → run migration → restart → verify old creds
still decrypt → done).

---
*End of plan.*
