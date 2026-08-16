# Slice E2 — Git-provider merge parity (D3 / P2-1) — DONE (2026-08-15)

## Files changed
- `services/web/modules/github-sync/app/src/GitMerge.mjs` — only file edited.

## Changes
1. **E2.1 provider gate** (`doGitMergeWithoutLock`): replaced `provider !== 'github'` 501-gate
   with allowed set `['github', 'gitea', 'forgejo']`. GitLab still 501 but with a precise
   message ("Automatic merge is not supported for GitLab yet — import (pull) and export
   (push) work normally"). Unknown providers get a generic 501 naming the provider.
2. **CRITICAL parity bug fixed**: `TokenManager.getUserPATCredentials(userId, 'github',
   serverUrl)` hardcoded the provider key. Gitea/Forgejo PATs live at
   `tokens[gitea|forgejo][serverUrl]` — the old code would have raised InvalidTokenError
   (or, worse, fall back to a github token) for exactly the providers E2.1 just enabled.
   Now passes the resolved `provider`.

## Verified, unchanged (E2.2 / E2.3)
- `setApiBaseForServer`: github.com → api.github.com, all other hosts (incl. gitea.com,
  codeberg.org, self-hosted) → `${origin}/api/v3`. Correct for the GitHub-compat providers.
- `getUserAndOrgs` (GraphQL): NO live callers on the provider path — the UI's user/orgs
  route goes `GitHubSyncHandler.getUserAndOrgs` → `gitClient.listUserAndOrgs`
  (git-based, provider-agnostic via githubinterface). `getUserAndOrgsREST` is already
  commented out. No fallback needed; GitHub path untouched.
- `buildHeaders`: `Authorization: Bearer <pat>` — valid for GitHub/Gitea/Forgejo (and
  GitLab if ever routed). Unchanged.
- `getPushPermission`: REST `${apiBase()}/repos/:owner/:repo` → Gitea/Forgejo-compatible.
- Controller merge path: `gitMerge` → `doGitMerge` (single gate in GitMerge, as intended);
  `getMergeOverview` → handler → git-based `getCommitsWithStatus` (provider-agnostic;
  H15 null-baseline guard present). No `'github'` gate found anywhere on the merge path
  (grep `provider ===/!==` in controller → none).

## Residual risks (verify in live E2E)
- Gitea/Forgejo GitHub-compat endpoint coverage: confirm `/git/blobs/:sha` content,
  `/git/trees` (create + read), `/git/refs` update, `/commits`, `createRepo` all behave on
  the live Gitea instance (Gitea implements most; watch pagination on `listBlobsAtCommit`
  and `createTree` with base_tree).
- `UpdateMerger` origin label stays `'github'` for gitea/forgejo history entries
  (display-only; switching to a new origin string risks unknown-icon regressions).
- GitLab remains 501 for automated merge only (import/export/pull via git unaffected).
- PAT scoping still matters: Gitea needs `repo:read+repo:write` (or `repo`) on the repo.
