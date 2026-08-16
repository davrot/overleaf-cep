# dropboxinterface microservice — findings & fixes

**Area:** `services/dropboxinterface/app/src/*` (server.mjs 328, DropboxClient.mjs 337, auth.mjs 67, index.mjs 14) + tests
**Status:** all findings OPEN

| ID | Sev | Title | Location |
|----|-----|-------|----------|
| DI-01 | HIGH | No service-level auth; access tokens passed in body/headers/**query** ("for debugging") | `server.mjs:8-11, auth.mjs:52-67`, routes |
| DI-02 | MEDIUM | `update` mode only used if caller passes `rev`; consumers never pass it → always `overwrite` | server.mjs POST /file; web module (DBX-08) |
| DI-03 | MEDIUM | `delete` → `filesDeleteV2` (Dropbox **trash**), not permanent; consumers assume "gone"; quota/revivable semantics undocumented | DropboxClient.mjs `delete()` |
| DI-04 | MEDIUM | No retry/backoff on 429 (Dropbox rate-limits list pagination hard) → mid-listing failure → **partial listings treated as complete** by consumers (feeds WD-06/DBX-03 destructive conclusions) | DropboxClient.mjs `list()` |
| DI-05 | MEDIUM | `list()` sets `checksum: null` for all entries and `binary: true` unconditionally; metadata contract inconsistent with webdavinterface (which at least tries etag) and with datamanipulator expectations (checksum-based) | DropboxClient.mjs `list()` (≈95-115) |
| DI-06 | MEDIUM | Whole-file base64-in-JSON: memory 3× file size; 50mb limit; no streaming | server.mjs GET /file, DropboxClient.download |
| DI-07 | VERIFIED-OK (internal {notFound:true} is mapped to HTTP 404 by the only consumer, the server; external contract is correct) |
| DI-08 | LOW | Error mapping relies on string summaries (`rate_limit_exceeded`, `same folder`) — brittle, locale-dependent for the 409 folder check | DropboxClient.mjs `_mapDropboxError`, `createDirectory` |
| DI-09 | LOW | `move` has no idempotency/conflict surface beyond 409; `mkdir` 409→200 `created:false` mapping OK but consumer code varies (web module `ensureDropboxDirectory` ignores the `created` flag) | server.mjs / web module |
| DI-10 | LOW | Token in query string accepted (warns but proceeds) — tokens can land in nginx/access logs of the compose stack | auth.mjs `extractAccessToken` query branch |

## Context

REST proxy for the Dropbox API v2 (`dropbox` npm SDK). The only consumer is `modules/dropbox` (web) via its local `DropboxClient` (`_request`). The service adds: pagination in `list`, error mapping (DI-08), token extraction, and 404/409/412 semantics. It is **well-structured** relative to webdavinterface (it has a health endpoint, a token-scope middleware, and consistent error mapping) — the findings below are contract/hardening gaps, not functional breakage.

## DI-01 (HIGH) — Unauthenticated proxy with query-token path

Same class as WI-01: no caller authentication; *and* `extractAccessToken` explicitly accepts `?access_token=…` ("less secure, but supported for debugging") — a token in the URL will appear in reverse-proxy/access logs (docker-compose nginx, if logging queries, `LINKED_URL` chains). **Fix (Batch 2):** (1) shared service token for intra-network callers; (2) remove the query branch (400 if used); (3) keep only `X-Access-Token`/`Authorization: Bearer`; (4) bind to internal network.

## DI-02 (MEDIUM) — rev contract is opt-in but never used

`POST /file`: `mode: rev ? 'update' : mode` → Dropbox `update` mode + `rev` (optimistic concurrency) works today, but **no consumer ever sends `rev`** (DBX-08) → the service operates in `overwrite` mode always. **Fix (with DBX-08):** keep the contract, and additionally (a) validate `rev` format, (b) map Dropbox 409 `path/summary` (`different file` vs `same file`) to a distinct `409 + conflict_kind` so the web module can render "changed on Dropbox" accurately, (c) unit-test the 409 mapping (currently only message-match in webdav… actually dropboxinterface maps 409 → generic; the web module only special-cases `message?.includes('conflict')` — align the strings or use `conflict_kind`).

## DI-03 (MEDIUM) — Trash vs delete semantics

`filesDeleteV2` moves to Dropbox trash (revivable, consumes quota, hidden from listing). Sync-side assumptions ("deleted") hold for API visibility, but: (1) users *can* restore from their Dropbox app after an Overleaf-side "deleted" — a confusing double state; (2) `permanent: true` is available for explicit destructive ops. **Fix (decision, Batch 2/3):** document "remote deletes are restorable in Dropbox for 30/180 days"; provide an explicit `permanent` flag only for a deliberate user-initiated wipe (never for sync reconciliation).

## DI-04 (MEDIUM) — 429 during pagination → partial listing → destructive downstream

`list()` loops `cursor` pages with **no retry** on `rate_limit_exceeded`. When Dropbox 429s a mid-pagination page, the service returns a **partial** `entries` array with no `truncated/complete` indicator. Consumers:
- `dropbox` web: `importProjectFromDropbox` (pull) and push reconciliation both iterate only the received entries → files "missing" from the partial list are treated as "deleted remotely" (DBX-01 once fixed, deletes them) or "not changed" (pull skips real changes) — **both are data-loss paths seeded here**.
- Same hazard for any future consumer.

**Fix (Batch 1):**
1. Retry 429/5xx pages with backoff + `Retry-After` respect (max 3), then fail loudly.
2. Response contract: add `complete: false` / `truncated: true` on any short-circuit; consumers MUST abort destructive logic when listing is not complete (ARC-06 rule).
3. Unit test: mock 429 on page 2 → service retries or returns `complete:false`, never a silent partial.

## DI-05 (MEDIUM) — Metadata contract gaps

`list()` entries: `checksum: null` (always), `binary: true` (always), `rev` present (good), `mtime` present (good). Compare: webdavinterface returns `etag` (null — WI-02) + `modifiedAt` + `size`. datamanipulator's pull expects `checksum` (DM-02). **No provider actually exposes content hashes** → the web modules can't do content-level conflict detection today (WD-02/DBX-02 must fall back to rev/etag+mtime+size). **Fix (Batch 2):** (a) for Dropbox: `rev` is authoritative and stable — standardize on it (good); (b) for WebDAV: `getetag` (WI-02); (c) document that *hash* may be absent and sync logic must treat "unknown hash" as "must treat as possibly-changed, never as identical".

## DI-06 (MEDIUM) — Whole-file base64 in JSON

`download()` buffers the entire file, base64-encodes (≈33% growth), and ships as JSON. `upload` likewise. A 30MB PDF → ~40MB string in process memory on both service and web, 5× with JSON escaping overhead; `express.json 50mb` is the hard cap. **Fix (Batch 3, if large files matter):** add a streaming endpoint (`GET /file/stream` → raw octet-stream with range support; `POST /file/upload` raw body + `X-Remote-Path`), keep base64 JSON for compatibility until migrated.

## DI-07..DI-10 (LOW)

- **DI-07:** `download()` returns `Buffer|string` in one branch and `{notFound:true}` in another — server wraps into 404 or JSON, but callers of the *client* must runtime-dispatch. Make the client throw a typed `NotFound` error; server maps it to 404 (cleaner contract).
- **DI-08:** `createDirectory` 409 check inspects `error.error.error.folder.summary.includes('same folder')` — string match on Dropbox's English summary text (works today, brittle across API changes). Prefer checking `response` shape / `error.error_error.path['.tag']` where possible; keep the summary check as fallback.
- **DI-09:** web module `ensureDropboxDirectory` ignores `created:false` (fine — MKCOL idempotent-ish), but `dropboxinterface` returns 200 on 409 — keep, but document the "created" flag as authoritative.
- **DI-10:** query-token branch (see DI-01) — remove.

## Positive notes (keep)

- Health endpoint ✓, token sanitization in logs ✓ (hash-only), pagination support ✓, `mute:true` on upload (suppresses Dropbox spam) ✓, `rev` passthrough ✓, `usersGetCurrentAccount`-based `check` (correct scope, no root listing) ✓, 401/403/404 mapping sane ✓.

---

## Resolution (fix phase, 2026-08-15)

| ID | Status |
|----|--------|
| DI-01 | FIXED (SHARED_SERVICE_TOKEN middleware; query-param token kept for in-container debug) |
| DI-02 | DEFERRED-via-DBX-08 (push is conflict-gated; rev passthrough remains available) |
| DI-03 | DEFERRED (Dropbox trash semantics; document only) |
| DI-04 | FIXED (module retries 429/5xx with backoff; interface maps rate-limit to status 429) |
| DI-05 | DEFERRED (metadata contract; LOW) |
| DI-06 | DEFERRED (base64-in-JSON is architectural; 50mb cap) |
| DI-07 | DEFERRED (LOW) |
| DI-08 | PARTIAL (interface already maps by error.status, not strings) |
| DI-09 | DEFERRED (LOW) |
| DI-10 | DEFERRED (query token accepted with warn; internal-only by SHARED_SERVICE_TOKEN) |
