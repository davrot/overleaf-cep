# Plan — Dropbox: stop discarding the refresh token (2026-08-17)

## Problem (verified)
- Dropbox OAuth2 access tokens are **short-lived and expire** (official:
  developers.dropbox.com/oauth-guide "access tokens are short lived, and will
  expire after a short period").
- Empirically on this deployment: the user's token was valid at
  2026-08-16T23:52Z (sync) and 2026-08-17T03:20Z (live E2E upload), then
  Dropbox returned `expired_access_token` by 04:30Z — consistent with a
  ~4h lifetime, issued ~23:40Z (user's reconnect).
- `DropboxRouter.mjs` OAuth callback requests `token_access_type: 'offline'`
  (i.e. Dropbox *does* return a `refresh_token`), but only stores
  `accessToken`; **`refresh_token` is silently dropped**.
  `dropboxUserCredentials` model has no refreshToken field.
- Impact: every connection silently dies hours after authorizing; today this
  blocked the live E2E. Pre-existing design gap, not a regression of the
  mirror work.

## Fix (Dropbox module only)
1. **Model**: add `refreshToken: String` (encrypted, same scheme) to
   `dropboxUserCredentials.mjs`.
2. **OAuth callback** (DropboxRouter.mjs): persist
   `encryptToken(tokenData.refresh_token)` when present.
3. **New helper** `getValidAccessToken(credentials)`:
   - decrypt access token; run the target call; on Dropbox
     `401 expired_access_token` (or immediate 401 when a probe fails) AND a
     refresh token exists → `POST https://api.dropboxapi.com/oauth2/token`
     with `grant_type=refresh_token`, `code_verifier` n/a, `client_id`
     (env DROPBOX_APP_KEY), `client_secret` (env DROPBOX_APP_SECRET),
     `refresh_token`.
   - Dropbox rotates credentials on refresh: persist BOTH the new
     `access_token` and the new `refresh_token` (encrypted) before retrying.
   - Guard against concurrent refresh (in-process lock per userId).
4. **Route wiring**: state/push/pull/files/link/status replace
   `decryptToken(creds.accessToken)` + `new DropboxClient(...)` with the
   helper; the DropboxClient receives the fresh token.
5. **Legacy connections**: pre-fix docs have no refreshToken → one-time
   re-authorize (same UX as today; afterwards refresh is automatic).
   `Disconnect` + reconnect is the recovery path; surface a clear
   "connection expired — reconnect" message on 401-without-refresh-token
   (already the effective behavior; keep message explicit).

## Env requirements (already satisfied in deployment)
- `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` present in container env
  (container_environment.json) — the token endpoint needs both.

## Verification
- Unit: refresh-token flow with mocked fetch (expired → refresh → retry
  succeeds; persistence of rotated pair; no-refresh fallback message).
- Lint (`--max-warnings 0`) + `node --check`.
- Rebuild + restart (per AGENTS.md only after static clean).
- Live: after a browser reconnect (stores refresh token), run the E2E
  script; additionally trigger the refresh path directly by calling
  `getValidAccessToken` after rotating the stored access token to an
  expired placeholder — expect automatic refresh + working API call.
- i18n: only if a new user-facing string is added (reconnect hint).

## Out of scope
- WebDAV/Nextcloud (app-password based, no short-lived-token issue).
- GitHub sync (has its own token model).

## Implementation (2026-08-17)
- `dropboxUserCredentials.mjs`: added encrypted `refreshToken` field.
- OAuth callback: persists `refresh_token` when Dropbox returns it
  (authorize flow already requests `token_access_type=offline`).
- `DropboxClient.mjs`: optional `onTokenExpired` callback; `_request`
  detects a 401, invokes the callback ONCE, swaps the token and retries;
  a `reauthRequired` refresh error surfaces as a clear 409
  ("reconnect in Settings").
- `DropboxRouter.mjs`: new exported `getFreshDropboxAccessToken(userId,
  oldToken)` — per-user refresh lock, concurrent-rotation detection
  (stored token != caller's token → reuse without replaying the stale
  refresh token), `grant_type=refresh_token` exchange, persists the
  rotated pair (only re-saves the refresh token when Dropbox returns a
  new one). All five DropboxClient creation sites pass it as
  `onTokenExpired`.
- Tests: `DropboxTokenRefresh.test.mjs` (10 tests: refresh+retry,
  reauth 409, no-callback passthrough, single-refresh guard, pair
  rotation+persist, no-rotate-persist, concurrent-rotation reuse,
  reauthRequired, token-endpoint failure, once-only under concurrency).
- Unit: 31/31 dropbox, 49/49 webdav; eslint --max-warnings 0 clean.
- README: token-lifetime + refresh behaviour documented.
