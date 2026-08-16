# gitfix — provider selection in export modal + sortable provider table

## C) Export-to-git: provider selection

**Files:** `modules/github-sync/frontend/js/components/modals/git-sync-export-modal.tsx`

No backend change was needed — the plumbing already existed and was provider-aware:
- `POST /project/:id/github-sync/export` body already carries `provider`/`serverUrl`/`username`.
- `GitHubSyncController.exportProject` → `GitHubSyncHandler.exportProject(userId, projectId, repoOptions)` → `resolveCreds(userId, repoOptions?.provider, ...)` (TokenManager per-provider token + `GitServerClient.setApiBaseForServer` handles gitea/forgejo/gitlab).
- `GET /user/github-sync/orgs?provider=&serverUrl=` already resolves owner/orgs for the given provider.

What was missing: the choice itself. Now, in the export modal:
1. On mount it fetches `GET /user/git-servers` (same endpoint as the settings list; shape `{id, provider, url, username[]}`), building `candidates` — the preselected server (e.g. arriving from the need-auth flow) first, then the linked providers, deduped by `id`.
2. **Preselection:** if the modal received a `server` prop, it is preferred; otherwise the first linked provider is selected automatically (so with exactly one provider the export goes to it with no extra click).
3. **When `candidates.length > 1`** a `Provider` `<select>` is rendered (label `t('provider')`); options read `GitHub — https://github.com`, `Gitea — https://gitea.example.org`, …
4. The org fetch and the export POST now use the selected server's `provider`/`url`/`username`. Switching the select re-fetches owner/orgs for that provider (existing `orgs` effect keyed on provider/url).
5. Fallback preserved: if the server list fetch fails or is empty, behavior degrades to the previous `server`-prop-only path (provider undefined → backend default), so a single-GitHub setup is byte-identical to before.

## D) Settings "Git sync" widget: sortable providers table

**File:** `modules/github-sync/frontend/js/components/git-servers-list.tsx`

- The previously `visually-hidden` `<thead>` is now a real, visible header row (Bootstrap `table table-sm` classes kept).
- The three data columns (Provider / Server URL / Username) are `<th scope="col">` with `aria-sort` (`ascending`/`descending`/`none`) containing a `<button type="button" class="btn btn-link p-0 small text-decoration-none">` that toggles sort: first click asc, second click desc, clicking another column resets to asc on that column.
- Arrow indicators: `▴` (asc) / `▾` (desc) shown next to the active column's label only.
- Sorting is client-side on the already-loaded rows: case-insensitive `localeCompare` (`sensitivity: 'base'`) over a copy (`useMemo`); empty usernames sort as `''`.
- The Actions column is untouched (plain `th scope="col"`, no sort button).
- Row ordering, Test/Delete/Link behavior, and loading/empty states are unchanged.

## i18n

No new user-visible strings were required — all labels use existing keys that are present (verified) in `services/web/locales/en.json` and `services/web/frontend/extracted-translations.json`:
`provider`, `server_url`, `username`, `actions`, `github`/`gitlab`/`gitea`/`forgejo`.
Locale files were **not modified**; `modules/webdav/test/unit/i18n-sanity.test.mjs` untouched (it only checks that en.json has no `{{ }}` and specific webdav/dropbox keys — all still pass).

## Validation

- `npx eslint --max-warnings 0 --format unix modules/github-sync/` → 0 issues (exit 0)
- `npx vitest run --project=Parallel modules/github-sync` → pass (no test files in module; `passWithNoTests`)
- `npx tsc --noEmit` (services/web) → 201 errors **both with and without** this change (all pre-existing, incl. the 3 in git-sync-export-modal.tsx that predate this edit); zero new errors introduced, `git-servers-list.tsx` clean.
