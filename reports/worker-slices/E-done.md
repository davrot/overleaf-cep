# Slice E — github-sync module flow fixes — DONE (2026-08-15)

Files changed:
- `services/web/modules/github-sync/app/src/TokenManager.mjs` (E.1)
- `services/web/modules/github-sync/app/src/GitHubSyncHandler.mjs` (E.2)
- `services/web/modules/github-sync/app/src/GitServerClient.mjs` (E.3)
- `services/web/modules/github-sync/app/src/GitHubSyncController.mjs` (E.1 route — sanctioned 4th file)

## Task results
1. **E.1 (H10) — DONE.** `removeUserToken(userId, { clearAll = false } = {})`:
   - default: under existing `withUserLock`, loads doc, shallow-copies `tokens`/`servers`,
     deletes ONLY the `github` key from each copy; if both maps end up empty → `deleteOne`;
     otherwise saves the trimmed doc (gitlab/gitea/forgejo entries preserved byte-for-byte).
   - `clearAll: true` keeps the old `deleteOne({userId})` behavior for explicit opt-in.
   - Export name unchanged (`removeUserToken` in `export default`).
   - Route: the sole caller is `GitHubSyncController.unlink` (routed from
     `GitHubSyncRouter.mjs:26-30` `POST /user/github-sync/unlink` → `GitHubSyncController.unlink`);
     it previously passed only `(userId)` → now passes `{ clearAll: req.body?.clearAll === true }`.
     No frontend caller exists (grep across `frontend/js` — none).
2. **E.2 (H15) — DONE (both halves in GitHubSyncHandler.mjs; nothing else needed).**
   - `importRepo`: `getBranchHead` wrapped in try/catch → on throw (empty repo / no refs —
     the service returns non-ok for `ls-remote` with no refs) `defaultBranchHead = null` +
     `logger.warn`; flow continues into the existing empty-clone → blank-project path
     (GS-05 `zipInfo.entryCount === 0` branch) and `createProjectState` stores
     `lastSyncCommit: null` (model `githubSyncProjectStates` line 14: `type: String, default: null` —
     null is schema-valid; `GitServerClient.clone` passes falsy `ref` through and
     githubinterface `/clone` only adds `--branch` when `ref && ref !== 'HEAD'`).
   - `getMergeOverview` (exact shape kept: returns `{ ...commitsAndStatus, isProjectUpdated }`
     where commitsAndStatus = `{ commits, diverged }`): new guard right after the
     `mergeStatus === 'conflict'` early-return, before `resolveCreds`:
     `if (!lastSyncCommit) return { commits: [], diverged: false, isProjectUpdated: false }`
     — no commits-API call with an empty sha.
3. **E.3 (LOW) — DONE (verified dead first).** `githubinterface/app/src/server.mjs` `/log`
   (L405) and `/status` (L461) handlers were grepped: neither (nor any code in their ranges)
   reads `authorization`/`Bearer`/`req.headers` → the Bearer PAT was dead. Removed only the
   two `headers.set('Authorization', 'Bearer …')` lines in `GitServerClient.log()` and
   `status()`; `X-Server-Url`/`X-Username` and `serviceHeaders` (incl. `x-service-token`)
   untouched; method signatures and the `&& token` guard kept to preserve behavior exactly.

## Acceptance
- `node --check`: TokenManager.mjs, GitHubSyncHandler.mjs, GitServerClient.mjs,
  GitHubSyncController.mjs → all CHECK_OK.
- `npx eslint --max-warnings 0` on all four files from `services/web` → ESLINT_OK.
- Re-read E.1: default path trims only `tokens.github`/`servers.github`; gitlab entries
  (e.g. `tokens.gitlab['https://gitlab.com']`) are untouched by the code path;
  empty-after-trim → doc deleted; non-empty → trimmed doc saved via `markModified`+`save()`.

## Residual risks
- `clearAll` is body-gated; a client sending `POST /user/github-sync/unlink` with no body gets
  the safe trimmed behavior (intended).
- E.2: a *no-access* error on `getBranchHead` (bad token) now proceeds to `clone`, which will
  fail with the (already good) `failed importing git repo` tag — the auth error surfaces one
  step later; acceptable per the approved plan.
- `removeUserToken` keeps legacy-`credentials.github` (old OAuth) field untouched when other
  providers exist — harmless; default unlink of a github-only account still deletes the doc.
