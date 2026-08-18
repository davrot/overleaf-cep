# Plan: multi-account git providers + coexisting GitHub OAuth (2026-08-18)

## Requirements (user)
1. Multiple PAT/username/URL entries for **any** provider (incl. same URL, different accounts).
2. GitHub OAuth2 usable **in addition to** PAT entries.
3. Resolve collision: widget "Unlink your GitHub account" vs per-row Delete.
4. i18n: "Export Project to GitHub" → "Export Project to Git";
   "Create a GitHub repository" → "Create a Git repository".
5. OAuth entry may be hidden from the PAT table.

## Design
Credential identity = **provider + serverUrl + username**. Two kinds:
- **PAT entries**: `tokens[provider][url][username] = enc` +
  `servers[provider][url][username] = {createdAt,lastUsedAt}`.
  Shown in the settings table (rows: Test / Delete; id `provider:url:username`).
- **OAuth slot** (github only): `credentials.github =
  {token: enc, username, linkedAt}` (legacy plain-string value still readable).
  Not shown in the table; included in provider *selection* lists (export modal,
  need-auth modal, import modal) with an "(OAuth)" marker.
  Widget button: OAuth linked → **Unlink** (POST /user/github-sync/unlink,
  now scoped to the OAuth slot); else "Link to your GitHub account".
  Row Delete removes a PAT entry. No functional collision.

Rules:
- Same (provider,url,username) save = token replacement (account identity).
- No username + multiple entries for (provider,url) → explicit 400 ambiguity
  error, never silent wrong-account.
- Username becomes **required** in the "Add new provider" form (identity).
- Legacy shape `tokens[p][url] = "string"` remains readable everywhere;
  migrated on first write to that bucket.
- OAuth callback saves to the OAuth slot with the resolved login (reuses
  interface /orgs → /user login) — PAT entries untouched.

## File changes
- `TokenManager.mjs` — 3-level PAT maps + oauth slot fns
  (getOAuth/saveOAuth/removeOAuth; getUserPAT(username?); getPublicServers
  incl. id `p:u:x`, source tag; removeServer(username?); drop
  updateServerUsername; `removeUserToken` → oauth-slot removal (H10 footgun
  removed); `getConnectionStatus` shape via controller).
- `GitHubSyncController.mjs` — linkPAT (username param), removeServerConfig
  (id parse with username), testServer (body.username), listUserRepos /
  importRepo / getUserAndOrgs (username), unlink → removeOAuth,
  oauth2Callback → saveOAuth(username), status → {connected, providers
  [pat+oauth], oauth:{linked,username}}.
- `GitHubSyncHandler.mjs` — resolveCreds(p,u,usernameHint?) over pat+oauth
  candidates; listUserRepos/importRepo/getUserAndOrgs (+username).
- `GitMerge.mjs` — pass project-state `syncUsername` into
  getUserPATCredentials.
- Frontend:
  - `github-sync-widget.tsx` — button from `status.oauth.linked` (Unlink via
    POST unlink; Link via href); table stays PAT-only.
  - `git-servers-list.tsx` — test body +username; optional `serversFilter`.
  - `git-sync-need-auth-modal.tsx` — selection list includes OAuth rows.
  - `git-sync-export-modal.tsx` — options from status.providers (pat+oauth),
    "(OAuth)" marker; sends username (already did).
  - `import-from-github-modal-wrapper.tsx` — provider selector (pat+oauth),
    pass provider/url/username to /repos + /project/new/github-sync.
  - `git-provider-modal.tsx` — canSubmit requires username.
- i18n: `export_project_to_github` → "Export Project to Git",
  `create_project_in_github` → "Create a Git repository"
  (+ `your_username` placeholder already exists; `unlink_github_account` kept).
- `README.md` — credential model, endpoints, multi-account + OAuth coexistence.

## Data migration (dev instance, probe)
- davrot: move `tokens.github['https://github.com']` (was linked via the
  OAuth button) to the OAuth slot with username `davrot`; keep gitlab/gitea/
  forgejo buckets as PAT entries (legacy string shape readable; migrates on
  next write).
- testjoe: none (no PAT entries at probe time; test entries cleaned after).

## Verification
1. Scoped eslint `--max-warnings 0` on the module + frontend files.
2. Rebuild `make all` + `cycle_overleafserver.sh`; "Enabling WebDAV module".
3. Probes: davrot enumeration + resolveCreds per provider (legacy read);
   testjoe saveOAuth/removeOAuth round-trip; ambiguity error with 2 entries.
4. Browser E2E (testjoe): two github.com PAT rows (different usernames),
   test/delete per row, export-modal options incl. (OAuth) marker after
   probe-saved OAuth row, widget Link↔Unlink toggling on the OAuth slot,
   import-modal provider selector + repo list for the chosen account.
5. Reviewer pass on the diff (data-safety: no cross-account token use).

## Final status (implemented, 2026-08-18)

Implemented in one commit-ready change set:

- `TokenManager.mjs` — username-keyed PAT buckets `tokens[provider][url][username]`,
  legacy single-account shape readable + migrated on next write; dedicated
  `credentials.github` OAuth slot (`saveOAuth`/`getOAuth`/`removeOAuth`,
  legacy string still readable); `getPublicServers` rows carry
  `{id: provider:url:username, provider, url, username, source}`;
  `removeUserToken` = OAuth slot only (legacy `clearAll` removed);
  anonymous lookups with several accounts raise a 400 naming the usernames
  (never a silent pick); github.com OAuth slot is the fallback account.
- Controller: `unlink` removes the OAuth slot; `oauth2Callback` stores
  login + token in the slot after a non-fatal `/user` lookup; `linkPAT`
  REQUIRES username (account identity) and verifies with it;
  `removeServerConfig` parses `provider:url:username`; `test`, `repos`,
  `orgs`, `import` all accept `username`; `status` also returns
  `oauth:{linked,username}`.
- Handler: `resolveCreds(userId, provider, url, usernameHint)` — PAT first,
  github.com OAuth-slot fallback; `getMergeOverview` passes the
  project-state `syncUsername`; `GitMerge.mjs` resolves credentials with the
  stored `syncUsername`.
- Frontend: widget Link/Unlink pair = OAuth slot (Unlink now posts
  `/user/github-sync/unlink`); widget table PAT-only; provider form requires
  username; export + import modals select among PAT accounts AND the OAuth
  entry ("— OAuth" marker); test/delete payloads carry `username`.
- i18n: `export_project_to_github` → "Export Project to Git";
  `create_project_in_github` → "Create a Git repository"; new `import_from`
  (selection label). `en.json` + `extracted-translations.json`.
- `README.md` rewritten sections: credential model, endpoint parameters,
  OAuth-slot semantics.

Static verification (pre-rebuild)
- `node --check` clean on all changed backend files.
- `eslint --max-warnings 0` clean on `services/web/modules/github-sync`
  (app + frontend) from the repo root.
- In-container TokenManager probe suite (old file backed up, new file
  swapped in, then restored): 10/10 OK —
  two PAT accounts on same provider+URL with distinct ids; named resolution
  returns the correct token per account; anonymous lookup with two accounts
  raises the ambiguity 400 naming both usernames; single-account lookup still
  works; single-account removal deletes exactly that account; OAuth slot
  appears with username; anonymous github.com lookup falls back to the OAuth
  slot with `source:'oauth'`; `removeUserToken` (widget Unlink) removes ONLY
  the OAuth slot while GitLab PAT entries survive; legacy single-entry bucket
  (string token + servers.username) migrates and both accounts remain
  readable; anonymous legacy entries migrate under "" key.
- Bug caught by the probe: `delete doc.github` on this Mongoose build
  silently no-ops (and `doc.unset` does not exist) — OAuth slot removal now
  uses a raw `$unset`, probe-verified.

Results (all done, 2026-08-18)
1. `make all` + `cycle_overleafserver.sh` — "Enabling WebDAV" verified in
   `/var/log/overleaf/web.log`; container healthy.
2. Davrot migration — his `credentials.github` OAuth token now lives in the
   slot with username `davrot`; the 4 PAT buckets (github/gittlab-fachschaften/
   gitea/forgejo) are readable in the legacy shape and enumerate as
   username-keyed PAT rows. Live API state verified in-container:
   `github.com:(gittest26-itp|PAT)`, `github.com:(davrot|OAuth)`,
   `gitlab.fachschaften.org:(davrot|PAT)`, `gitea.com:(gittest26-itp|PAT)`,
   `v15.next.forgejo.org:(gittest26-itp|PAT)`. His A5-test project state
   (`syncUsername: davrot`) resolves to the OAuth slot, so it keeps working.
3. Live UI E2E as testjoe (CDP, 15/15 checks):
   - widget: Unlink button appears when the OAuth slot is linked (PAT-only
     table still shows only PAT rows — an oauth-slot entry for the same
     account does NOT leak into the table),
   - "Add new provider" adds a github.com PAT row next to a gitlab row,
   - export modal: title "Export Project to Git", create button
     "Create a Git repository", provider select shows
     `GitHub (gittest26-itp) — https://github.com` (PAT),
     `GitLab (davrot) — https://gitlab.com`, `GitHub (gittest26-itp) — OAuth —
     https://github.com`; a real export created the repo,
   - import modal: account selector + repo list for the chosen account; real
     import created the project (round-trip),
   - widget Unlink removed ONLY the OAuth slot; both PAT rows survived; the
     button reverts to "Link to your GitHub account".
4. Bug found + fixed during E2E: `importRepo` cloned with
   `git clone --branch=<head SHA>` (githubinterface maps `ref` → `--branch`)
   which GitHub rejects (“Remote branch ...”). The handler now clones the
   branch NAME (it still records the head SHA as the import baseline).
   Rebuild + live re-verification → import round-trip passed.
5. Test artifacts cleaned: all scratch projects deleted, all `ol-e2e-*`
   GitHub repos deleted, testjoe's credential doc back to empty,
   uiverify scratch user removed.
6. Committed + pushed (see git log).
