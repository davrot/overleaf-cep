# webdavinterface microservice — findings & fixes

**Area:** `services/webdavinterface/app/src/*` (server.mjs 238, WebDAVClient.mjs 180, auth.mjs 29, index.mjs 1) + tests; runtime deps resolved from repo-root `node_modules/webdav@5.10.0`
**Status:** all findings OPEN

| ID | Sev | Title | Location |
|----|-----|-------|----------|
| WI-01 | CRITICAL | No service-level auth; any local network client can proxy to a victim's WebDAV server with their server_url | `server.mjs` (all routes) |
| WI-02 | HIGH | `list()` always returns `etag: null` → ETag/If-Match/412 conflict detection in the web layer is dead (direct cause of WD-03 silent overwrites) | `WebDAVClient.mjs:62-75` |
| WI-03 | HIGH | `_executeWithRetry` defined but never called; no HTTP timeouts anywhere | `WebDAVClient.mjs:40-60` (dead), all ops |
| WI-04 | MEDIUM | `upload()` parent-path bug for top-level files: `slice(0, lastIndexOf('/'))` truncates the **filename** → creates bogus directory | `WebDAVClient.mjs:91` |
| WI-05 | MEDIUM | Basic-auth header parse `split(':')` → `[, pass]` breaks for usernames containing `:` | `server.mjs` GET/DELETE /file (≈150-175, 195-230) |
| WI-06 | MEDIUM | Credential/connection failures return 500; consumers can't distinguish client from server errors | `server.mjs` (check/list/mkdir/file handlers) |
| WI-07 | MEDIUM | `check()` PROPFINDs the WebDAV **root**, not the user's sync path; heavy + false negatives | `WebDAVClient.mjs:160-180` |
| WI-08 | MEDIUM | `express.json({limit:'10mb'})` — files >10MB rejected with 413 (inconsistent with dropboxinterface's 50mb) | `server.mjs:8` |
| WI-09 | LOW | `move(overwrite: true)` — dest silently replaced; no If-Match | `WebDAVClient.mjs:147-160` |
| WI-10 | LOW | Retry wrapper dead (see WI-03); error logging may include full server URLs (PII-ish: account paths) | `WebDAVClient` catch blocks |

## Context

`webdavinterface` is a thin REST proxy over the `webdav@5.10.0` npm client. Endpoints: `POST /check|/list|/mkdir|/move|/file`, `GET /file`, `DELETE /file`. The WebDAV **web module** talks to it through `WebDAVServiceClient` (module copy) — that's the only consumer. Password/credentials are passed per request in the body/headers.

## WI-01 (CRITICAL) — Unauthenticated proxy

There is no middleware authenticating callers (only per-request pass-through of *target* credentials). Consequences:
1. Any process/user able to reach the service network port can call `POST /list|/file|/delete|/move` by supplying a victim's `server_url` + username + password (learnable from DB, logs, or a shared account) to move/delete/read the victim's files — an amplifier for any credential leak (DBX-07 class).
2. The Basic-header parsing (WI-05) also means the *service itself* does not validate the password against anything — it just forwards; a typo'd password is the only protection layer, held client-side.

**Fix (Batch 2):**
1. Add a shared service token (env `WEBDAVINTERFACE_TOKEN`) checked on every route for intra-datacenter callers; the web module sends it from server-side code only.
2. Bind to the compose internal network (not 0.0.0.0), document.
3. Optional: per-user scope tokens (long-term) so the service can bind operations to a user.

## WI-02 (HIGH) — ETags are always null

`WebDAVClient.list()`:
```js
return items.map(item => ({
  ...
  etag: null,                 // <-- hardcoded
  modifiedAt: item.lastmod ? new Date(item.lastmod).toISOString() : null,
  ...
}))
```
The `webdav` package's `getDirectoryContents` exposes PROPFIND data (including `getetag` on most servers — Nextcloud/OwnCloud return it; `dist/node/operations` maps response headers; verify at fix time which property carries it — likely `item.etag` from `proplist` or headers on `getDirectoryContents(..., {details:true})`).

**Why critical:** the web module's entire push-safety depends on `If-Match: <etag>` (WebDAVClient.upload → `putOptions.headers['If-Match']`) and the 412 conflict path (server.mjs POST /file maps 412→`{status:412}`; `WebDAVServiceClient.put` surfaces 412). With `etag: null`:
- `existingRemoteByPath.get(path)?.etag` → `undefined` → no `If-Match` header → **uploads always overwrite** (WD-03's "remote edits clobbered" is *caused here*).
- The 412 conflict handlers in both layers are unreachable code → conflicts silently become overwrites.
- `pollUser`'s etag baseline in `remoteState` stores nulls → its etag comparison branch is dead; only mtime+size works (and mtime may be second-granular → missed changes).

**Fix (Batch 1):**
1. Capture the real ETag: `getDirectoryContents(path, { details: true })` and/or `item.proplist / headers['ETag']` per webdav@5.10.0 API surface (inspect `dist/node/operations/getDirectoryContents.js` at fix time); store as-is (including the surrounding quotes).
2. Return it; keep `modifiedAt` as secondary only.
3. Add unit test with a mock server: list returns etag `abc`; put with `If-Match: abc` succeeds; put with stale etag → service returns 412 (assert mapping).

## WI-03 (HIGH) — Dead retries, no timeouts

`_executeWithRetry` (WebDAVClient.mjs:40-60) exists to retry 423/502/503/504 — but **no caller uses it** (list/download/upload/delete/createDirectory/move all call the raw methods). Meanwhile the webdav client has **no request timeout**: a hung remote (locked file 423, slow network, blackholed server) holds the HTTP request indefinitely; combined with the web module's `Promise.all`-free sequential loops, one bad file can wedge a whole sync and its per-project lock (WD-04).

**Fix (Batch 2):**
1. Wire `_executeWithRetry` into all operations (or per-op timeouts + 1 retry on 423/5xx, with backoff; keep idempotent ops only).
2. Add per-request timeouts via AbortController (list 30s, file get/put 120s) and surface a typed `TimeoutError` → web module logs + marks sync-partial (not silent success).
3. Log (at debug) retries with sanitized URL (auth.mjs `sanitizeUrlForLogging` exists but is unused in server.mjs/WebDAVClient — use it).

## WI-04 (MEDIUM) — Top-level upload creates bogus directory

`WebDAVClient.upload()`:
```js
const parentPath = resourcePath.slice(0, resourcePath.lastIndexOf('/')) || '/'
await this.client.createDirectory(parentPath, { recursive: true })
```
For a resource **without** `/` (a file at the WebDAV root, e.g. `main.tex`): `lastIndexOf('/') === -1` → `slice(0, -1)` → `'main.t'` → **MKCOL creates a directory named `main.t`** next to the file, then uploads `main.tex`. Remote pollution on every such push; the bogus dir then shows up in listings and (via WD-03/DBX-01-style mirrorDeletes) can even be cleaned up by delete loops later. (Note: in practice sync roots always contain `/`, but the service API allows root-level paths — and `/files` import flows can produce them.)

**Fix:** `const dir = resourcePath.includes('/') ? resourcePath.slice(0, resourcePath.lastIndexOf('/')) : null; if (dir) await this.client.createDirectory(dir, {recursive:true})`.

## WI-05 (MEDIUM) — Basic auth parse breaks on `:` in username

GET/DELETE `/file`:
```js
const [, pass] = Buffer.from(base64Auth, 'base64').toString().split(':')
```
Username `alice:2024` (or any colon) → destructure takes the middle piece, `pass` gets undefined or the wrong slice → either 401 (password undefined) or forwarded wrong password. Use `split` on the **first** colon: `const i = decoded.indexOf(':'); const [user, pass] = [decoded.slice(0, i), decoded.slice(i+1)]`.

**Fix (Batch 1):** one-line correct parse + unit test with colon username.

## WI-06 (MEDIUM) — Error status taxonomy

- `/check` failure (bad credentials, unreachable) → `500` with `err.message` → web module's `check()` surfaces as `Failed to connect` — fine today, but semantically it's a 401/502-ish client error; a 500 for auth failure misleads monitoring.
- `list` 404 (missing path) → 500; consumers can't tell "folder not created yet" (normal pre-first-push) from "server broken".
- `DELETE` 404 → 200 `notFound: true` (OK, keep); `POST /file` 412 → 412 (keep).

**Fix (Batch 1):** explicit mapping table: 401→401 (add `error: 'unauthorized'`), 404 on list→404, 409/405 on mkdir→200 with `created:false` (keep), network/5xx→502 with `retryable: true`. Web module already branches on status for 412/404 only (safe).

## WI-07 — check() scope

`check()` = `getDirectoryContents('/')`: (1) can be huge (root of a personal cloud), (2) may be forbidden even when the target path is accessible (ownCloud allows listing `files/uid` but `/` may 403) → false "connection failed"; (3) can't catch a wrong `rootPath`. **Fix (Batch 2):** `check()` accepts `path` (default root) — service `POST /check` accepts `path`; web module passes `credentials.rootPath`; webdav client PROPFINDs exactly that path (404 → `not_created: true`, still considered *valid credentials* — let the web layer decide, matching WD-12).

## WI-08 — Body size limit

`10mb` JSON limit on the only upload path (`POST /file` with base64 → real size ≈ 7.5MB). Overleaf binary attachments >7.5MB 413 silently (client sees generic error). Dropbox side uses 50mb. **Fix (Batch 2):** raise to at least 50mb consistently, or better: switch file transfer to streaming/multipart (out of scope for batch 2 — document), and return a clear `413 payload too large` message.

## WI-09/10 (LOW)

- `move(overwrite: true)`: rename flows (if ever wired, WD-14) would silently replace an existing destination. Prefer `overwrite: false` + 409 handling; at minimum document.
- Dead retry wrapper + unused `auth.mjs` helpers (`generateBasicAuthHeader`, `sanitizeUrlForLogging` never called — use them; `validateAuth` is called ✓).

---

## Resolution (fix phase, 2026-08-15)

| ID | Status |
|----|--------|
| WI-01 | FIXED (SHARED_SERVICE_TOKEN middleware, graceful when unset) |
| WI-02 | FIXED (item.etag passed through) |
| WI-03 | PARTIAL (module clients have env-driven retry+timeout; service-side retry wiring DEFERRED — module layer retries) |
| WI-04 | VERIFIED-OK (parent path math correct for top-level files) |
| WI-05 | FIXED (split on first colon only) |
| WI-06 | FIXED (404/412 mapped explicitly) |
| WI-07 | PARTIAL (module passes user root to /check; service change DEFERRED) |
| WI-08 | FIXED (50mb limit, aligned with dropboxinterface) |
| WI-09 | DEFERRED (LOW; move overwrite semantics) |
| WI-10 | DEFERRED (LOW; logger already scopes err+path, no credentials logged) |
