# githubinterface (services/githubinterface) — "fix me" report
Audit date: 2026-08-15 · Auditor: overleaf-cep audit phase 2 · Scope: `services/githubinterface` (runs in-container under runit as `githubinterface-overleaf`, port 4013, `GITHUBINTERFACE_API_URL=http://localhost:4013`)

## Severity summary
| ID | Sev | Title |
|----|-----|-------|
| GHI-01 | CRITICAL | No service authentication; bound 0.0.0.0:4013 + `cors()` — any network client can use it as an unauthenticated git/HTTP proxy |
| GHI-02 | HIGH | Client-supplied `dir` / `target_dir` used with no confinement (arbitrary-path git operations + isomorphic-git read/write anywhere on the container fs) |
| GHI-03 | HIGH | SSRF: `server_url` may be any host (cloud metadata, internal services); client token attached to the outgoing request |
| GHI-04 | HIGH (bug) | `/list-repos`: `Array.isArray(await r.json()) ? await r.json() : []` — double body read / undefined deref → **always fails** (GitHub: "body already read"; GitLab: `.map` on undefined) → "list repos" UI is 100% broken |
| GHI-05 | MEDIUM | No concurrency cap; 10 min timeout + 512 MB `maxBuffer` per git op → OOM/CPU amplification by any caller |
| GHI-06 | MEDIUM | `/commit`: only `author.name` (no email/committer) and no existence validation of `files[].path` → misleading failures; content contract (files must pre-exist in `dir`) undocumented |
| GHI-07 | LOW | `app.use(cors())` wildcard — widen attack surface for unauthenticated callers |
| GHI-08 | LOW | `/check` returns the upstream error body verbatim (`detail: text`) — information disclosure |
| GHI-09 | LOW | `/log` pagination: O(limit+skip) walk, `has_more` inaccurate at exact page boundaries |
| GHI-10 | LOW | `/commits`: full `git clone` (unshallowed) per call just to list ≤50 commits |
| GHI-11 | LOW | `/commits` temp dir name uses `Math.random()` — use crypto (low risk, tmpdir is 0700) |
| GHI-12 | LOW | Dead code: `app/src/GitServerClient.mjs` + `app/src/index.mjs` (nothing in repo imports them; runit executes `server.mjs` directly) |
| GHI-13 | LOW | askpass file per call (0700, pid+timestamp name, removed in `finally`) — verified acceptable; noted for the record |

## Findings

### GHI-01 (CRITICAL) — no service authentication
`server.mjs` has **no auth middleware at all**. The process listens on `0.0.0.0:4013` (container network = the host LAN in this setup), with `cors()` wide open. Any client on the reachable network can:
- run git clone/push/pull/commit/log/status against **any** `dir` on the container (see GHI-02),
- make the service issue authenticated HTTP requests to **any** `server_url` using a caller-supplied token (SSRF, GHI-03),
- exhaust resources (GHI-05).

The three sibling services (webdavinterface/dropboxinterface/datamanipulator) already use `SHARED_SERVICE_TOKEN` (enforced when set, warn+allow when unset so the existing compose deployment keeps working). Apply the **same** pattern here:
```
env SHARED_SERVICE_TOKEN=<secret>   (optional; unset = degraded mode, warning logged once)
header x-service-token: <secret>    (or Authorization: Bearer <secret>)
```
`/health` stays open (monitoring). The module client (`modules/github-sync/app/src/GitServerClient.mjs`) must forward the header when the env var is set.

### GHI-02 (HIGH) — unconfined working directories
`runGit(args, {cwd})` and the `git.add/commit/log/status` calls accept `dir`/`target_dir` straight from `req.body`:
- `/clone` → `cloneArgs.push(repo_url, target_dir)` — **arbitrary absolute path**,
- `/push /pull /commit /log /status` → `cwd: dir` / `isomorphic-git {dir}`.

There is no validation that `dir` is inside an Overleaf-owned work area. Confinement requirement: resolve the given path and require it to be inside `GITHUBINTERFACE_WORKDIR_ROOT` (default `${os(tmpdir)}/ghif`), rejecting `..` escapes and symlinks outside (use `path.resolve` + prefix check; module always uses `dumpFolder`/tmp under the container — verify module call sites comply: they pass `Settings.path.dumpFolder/github_*` and `/tmp/ghif_commits_*`).

### GHI-03 (HIGH) — SSRF
`/check`, `/orgs`, `/create-repo`, `/list-repos` fetch `server_url` (caller-chosen) with `Authorization: <caller token>`. Inside a host with other services (and potentially cloud metadata endpoints), that is an authenticated-request oracle. Mitigations: (a) GHI-01 auth gate (unauthorized callers can no longer trigger), (b) validate scheme `http://`/`https://` only and log outbound targets at info level. Optional hardening env `GITHUBINTERFACE_BLOCK_PRIVATE_NETS` (default off to keep self-hosted git working).

### GHI-04 (HIGH, guaranteed bug) — /list-repos
`server.mjs:557` (approx):
```js
const json = Array.isArray(await r.json()) ? await r.json() : []
```
GitHub returns an **array** → second `await r.json()` throws (body already read) → 500. GitLab returns an **object** → `json` stays `undefined` → `json.map` throws → 500. The endpoint can never succeed. Fix: parse once:
```js
const json = await r.json()
if (!Array.isArray(json)) return res.status(502).json({ error: 'unexpected list-repos payload' })
```

### GHI-05 (MEDIUM) — resource amplification
No cap on concurrent git operations; each may hold a 512 MB `maxBuffer` for up to 10 minutes. Add: in-flight counter with `GITHUBINTERFACE_MAX_OPS` (default 8, 503 when saturated), `maxBuffer` from `GITHUBINTERFACE_MAX_BUFFER_MB` (default 64).

### GHI-06 (MEDIUM) — /commit contract
`git.commit({ author: author || { name: username } })` — no `email`/`committer`; isomorphic-git may reject or create broken commits. Also `files` is only used for `fs.add(filepaths)` — if a path was never written into `dir` the failure message is a low-level ENOENT. Fix: require `author.email` (derive from `username` if absent: `${username}@overleaf.local` fallback), pre-validate each `files[].path` exists in `dir` and return 400 with the missing list; document: "content must already exist on disk (shared container fs); /commit only stages & commits".

### GHI-07/08 (LOW) — cors + error-body disclosure
Drop `app.use(cors())` (service is process-to-process; browsers never call it directly). In `/check` return bounded details (`text.slice(0, 300)` or omit `detail` entirely).

### GHI-10 (LOW) — /commits cost
`git clone` is full and unshallowed while only ≤50 commits are needed: use `--depth <limit+1>` (keep full fallback if depth fails).

### GHI-12 (LOW) — dead files
`app/src/GitServerClient.mjs` (+ `index.mjs` re-export) is referenced by nothing (runit script: `node -e "import('...server.mjs')"`). Deletion deferred pending owner sign-off (consistent with WD-17 posture).

## Non-issues (verified)
- Credentials over git protocol use a per-call `GIT_ASKPASS` 0700 script with shell-quoted values, removed in `finally` (GHI-13) — no credentials in argv/URL.
- `execFile('git', [...args])` — no shell interpolation (injection-safe; values validated as git args).
- `runGit` sets `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, 10-minute `timeout` ✓.

## Resolution (applied 2026-08-15)
| ID | Status | Evidence |
|----|--------|----------|
| GHI-01 | FIXED | `SHARED_SERVICE_TOKEN` middleware (enforced when set, warn-allow when unset; `/health` open); module `GitServerClient` forwards `x-service-token` when the env is set |
| GHI-02 | FIXED | `resolveWorkDir()` confines `dir`/`target_dir` (and all internal work dirs, incl. `/commits` clone dir) to `GITHUBINTERFACE_WORKDIR_ROOT` (default `<tmpdir>/ghif`, 0700, pre-created at startup); 400 on escape |
| GHI-03 | FIXED | `validateGitServerUrl()` (http/https only) on every endpoint that uses `server_url`; 400 otherwise (SSRF via file:// etc. closed) |
| GHI-04 | FIXED | `/list-repos` parses the body exactly once; non-array → 502 with a clear message |
| GHI-05 | FIXED | `GITHUBINTERFACE_MAX_OPS` (default 8) in-flight limiter (503 when saturated); `GITHUBINTERFACE_MAX_BUFFER_MB` (default 64) instead of 512MB |
| GHI-06 | FIXED | `/commit` validates file existence (400 with missing list), derives full author+committer identity, handles unborn HEAD (root commit) |
| GHI-07 | FIXED | `cors()` removed |
| GHI-08 | FIXED | `/check` detail truncated to 300 chars; `/list-repos` error text truncated to 500 |
| GHI-09 | DEFERRED | Pagination is O(limit+skip) with an off-by-one `has_more` — low impact (module uses small pages); no change |
| GHI-10 | FIXED | `/commits` shallow clone (`--depth limit+1 --single-branch`) with full-clone fallback (partial dir cleaned first) |
| GHI-11 | FIXED | `crypto.randomBytes` dir names |
| GHI-12 | DEFERRED | `app/src/GitServerClient.mjs` + `index.mjs` are dead (runit runs `server.mjs` directly) — kept, made lint-clean; deletion needs owner sign-off |
| GHI-13 | VERIFIED OK | askpass 0700 script, argv-free, removed in `finally` |
