# Plan — Git Provider rename, WebDAV project-level mirror sync, Dropbox path, widget text

Date: 2026-08-17. Requested changes (user, 2026-08-16/17 session):

1. Rename feature "GitHub" → "Git Provider" (integrations card + sync modal title).
2. Fix `ReferenceError: force is not defined` (WebdavSync.mjs push lane, WebDAV export 500).
3. WebDAV conflict management → **project level** (like Dropbox UX):
   - Export (push): local project → remote; afterwards both file trees + files identical.
   - Import (pull): remote → local project; afterwards both file trees + files identical.
   - No per-file keep-local/keep-remote conflict churn.
4. Dropbox modal path must show the app-folder path in front of the project name
   (currently `/A5 test`; credential `path` is `/`, files live in the Dropbox app sandbox).
5. WebDAV user-settings widget: remove "Last synced …" text.

## Investigation findings (evidence)

- Deployed container == local working tree (md5-identical WebdavSync.mjs/DropboxRouter.mjs/modal).
  The `force` bug: working tree removed `syncProject`'s `{ force = false }` parameter but the
  start-logger (line 192) and `syncAllProjectsForUser` still reference/pass `force`.
- Live data (mongo `sharelatex`):
  - `dropboxsyncprojectstates` ("A5 test", 6a73aec4…): `path:"/"`, `projectPath:"/A5 test"`,
    ownerId set. `dropboxusercredentials` (new collection): `path:"/"`.
  - `DEFAULT_DROPBOX_PATH='/'` (DropboxRouter.mjs:22) — OAuth callback + connect endpoint store
    `path:'/'`; the Dropbox app sandbox root (API `/`) is the user's app folder, whose *name*
    is not exposed by the API (that is why display showed only `/A5 test`).
  - Current state endpoint already computes `fullPath = joinDisplayPath(root, statePath)` with a
    hardcoded `'Apps/Overleaf Dev'` fallback; verified `resolveDisplayRoot('/', null)` →
    `'Apps/Overleaf Dev'`, `joinDisplayPath(...)` → `'Apps/Overleaf Dev/A5 test'`.
    The user's `/A5 test` capture predates that build's deployment, but the hardcoded fallback
    is still wrong whenever the account's app folder name differs — so make it user-configurable.
- `pollUser` (import lane) is only called from the manual pull endpoint (pollProject) — no
  automatic poller; making import a full local mirror is safe from auto-trigger risk.
- `TpdsUpdateHandler.promises.deleteUpdate(userId, projectId, path, source)` →
  `EditorController.deleteEntityWithPath` exists for per-entity (doc/file/folder) local deletion.
- `en.json` is strictly sorted (3432 keys); `extracted-translations.json` also sorted, values `""`.
  i18n sanity test (webdav) requires new used keys present in both.
- i18n conventions: `__var__` interpolation, curly apostrophe, no empty values for new keys.

## Changes

### 1. WebdavSync.mjs (services/web/modules/webdav/app/src/)
- `syncProject(userId, projectId, { force = false } = {})` — restore options param (fixes 192:63
  ReferenceError; `syncAllProjectsForUser` already passes `{ force }`).
- Export lane (project-level, local wins):
  - keep unconditional overwrite of every local doc/file (skip sync-excluded),
  - **un-mirror**: delete ALL remote files + remote directories that are not present locally and
    not sync-excluded (remove the previousState-based deletion guard),
  - only on a successfully completed remote listing (listing failure still aborts before writes),
  - push lane no longer records per-file conflicts (conflicts array drops out of the push path;
    clean status always written; `resolveConflict` endpoint kept for legacy conflict state).
- Import lane (pollUser, project-level, remote wins):
  - keep unconditional apply of changed/new remote entries (remote wins),
  - **un-mirror**: after a successful remote walk, delete local docs/files (and folders) that are
    absent from the remote tree and not sync-excluded via
    `TpdsUpdateHandler.promises.deleteUpdate(userId, projectId, path, 'webdav')`,
  - remote folder missing → still no local deletion (report "remote folder not found"),
  - pull lane no longer records per-file conflicts (clean status written; legacy conflict
    resolution endpoint untouched).

### 2. WebDAV widget (webdav/frontend/js/components/webdav-widget.tsx)
- Remove the "Last synced … (…)" fragment from the connected-state paragraph (user request 5).
  (Project sync modal keeps its own last-synced line.)

### 3. WebDAV sync modal (webdav-sync-modal.tsx)
- Add small muted helper lines under Import/Export: Import replaces local content with the
  remote folder; Export replaces the remote folder with this project (makes the mirror
  semantics explicit in the UI; data-safety clarity).

### 4. GitHub → Git Provider (github-sync frontend + i18n)
- `github-integration-card.tsx`: card title default `t('github')` → `t('git_provider')`.
- `git-sync-modal.tsx`: modal title → `t('sync_with_git_provider')` (static; the provider is
  already selectable in the export form).
- Strings describing the actual GitHub product stay ("Export Project to GitHub",
  "Create a GitHub repository") — report explicitly so the user can widen the rename if wanted.

### 5. Dropbox app-folder display (dropbox module)
- Model `dropboxUserCredentials.mjs`: add `displayRoot` (String) — the app folder name as it
  appears in the user's Dropbox (e.g. `Apps/Overleaf Dev`).
- `POST /user/dropbox/display-root` (requireLogin): trim + persist `displayRoot` (empty clears).
- `/user/dropbox/status`: also return `displayRoot`.
- `/project/:id/dropbox/state`: display root resolution becomes
  `displayRoot || (state.path if real folder) || credentials.path (if real) || legacy || 'Apps/Overleaf Dev'`;
  `fullPath`/`projectPath` as before. (Fixes wrong hardcoded guess + keeps old behavior.)
- `dropbox-widget.tsx`: connected view gets an "App folder" input (prefilled from status) +
  Save button → POST display-root; refresh after save.

### 6. i18n (services/web/locales/en.json + services/web/frontend/extracted-translations.json)
- New keys (inserted at exact alphabetical position, non-empty in en, `""` in extracted):
  `git_provider`, `sync_with_git_provider`, `webdav_import_note`, `webdav_export_note`,
  `dropbox_app_folder_label`, `dropbox_app_folder_description`.

## Verification (definition of done)

1. `node --check` on all touched .mjs; vitest for webdav + dropbox modules (existing suites stay green).
2. `eslint --max-warnings 0` on touched scopes (services/web modules + frontend files).
3. Rebuild `make all` (server-ce) — only after static checks pass (no speculative rebuilds).
4. Restart via `cycle_overleafserver.sh`; log must show "Enabling WebDAV module" and no WebDAV
   init errors.
5. Live smoke (https://psintern.neuro.uni-bremen.de, test login):
   - WebDAV Export button → HTTP 200 (force bug gone), remote folder mirrors project.
   - WebDAV Import → project mirrors remote folder (add a remote-only file, import, verify it
     appears locally and local-only files are removed).
   - Integrations panel: card title "Git Provider", modal title "Sync with Git Provider".
   - Dropbox state endpoint returns `fullPath` = `<displayRoot>/<project>`; widget save persists
     displayRoot; modal shows the full path.
   - User-settings WebDAV widget no longer shows "Last synced".

## Data-safety notes
- Deletions only after successful full remote listing; sync-excluded entries (hidden, LaTeX
  transients) are never touched on either side.
- Import on a missing remote folder never deletes local content (reports instead).
- Dropbox module sync code is otherwise untouched.

## Live verification findings + additional fixes (2026-08-17, before final deploy)

Live E2E (real project "A5 test" + real Nextcloud) exposed four latent bugs that the
mirror work surfaced or that blocked it; all fixed and re-verified:

1. **`deleteUpdate` arity** (reviewer finding): `TpdsUpdateHandler.promises.deleteUpdate`
   takes 5 args `(userId, projectId, projectName, path, source)`; the new WebDAV import
   delete loop passed 4. Fixed both call sites to pass `project.name`.
2. **Push-lane key-format mismatch (catastrophic if shipped)**: push's `projectRoot`
   ends with `/` (so `entry.path.slice(projectRoot.length)` yields slash-less relatives)
   while local doc/file keys + entity folder paths carry a leading `/`. The new
   unguarded remote-deletion loop would have matched nothing → **deleted every remote
   file on every export**. Fixed by normalizing both push-lane relative paths to the
   leading-slash form. (The old guarded loop silently never deleted for the same
   reason — that "guard" was masking this mismatch.)
3. **Import skipped for C3 gate — projectId type mismatch**: live `webdavsyncprojectstates`
   docs store `projectId` as a **string**; `SyncStateManager.getProjectState`/
   `updateProjectState` queried with `ObjectId`, so the C3 "still linked" check failed
   (`hasStateDoc:false`) and Import silently did nothing for all existing links; push
   state writes also matched no doc. Fixed by normalizing all `SyncStateManager` CRUD
   functions to `String(projectId)`.
4. **Remote-wins re-apply on import**: a remote file unchanged since the last sync but
   deleted locally afterwards was skipped (stale-etag/H3 guards assume the local copy
   still "is there"). Fixed with a `localPresentPaths` check (single-linked-project
   case): unchanged/byte-identical remote entries fall through to (re-)apply when the
   local entity is gone. Empty-folder parity also added: local empty folders the remote
   tree contains are kept (remote dir set collected during the walk).

E2E results on final build (all 5 steps pass): baseline forced push OK (original 500
repro gone); remote-only file removed by Export; local-only file uploaded by Export;
locally-deleted file re-applied by Import (remote wins); local-only file removed by
Import; after every step both trees byte-identical; no leftover test artifacts.

5. **ObjectId vs string projectId in poll lane (silent no-op)**: `TpdsUpdateHandler`'s
   `findProjectByIdWithRWAccess` compares `project._id.toString() === projectId` — string
   semantics. WebdavSync's poll lane passed `projects[0]._id` (mongoose ObjectId) to
   `newUpdate`/`deleteUpdate`/`createFolder`, so **every import apply and local deletion
   silently resolved without doing anything** (and the `path === '/'` branch would have
   soft-deleted the project had it matched). Fixed by passing `String(projectId)` at all
   four call sites, plus explicit `"/"` (project root) guards in the folder
   delete/create loops so the root folder can never be a target (a `deleteUpdate(path="/")`
   marks the project as deleted by external source).
6. **Empty-folder creation on import**: remote-only empty directories are created locally
   (`createFolder`, shallowest first) so both trees are structurally identical after
   Import (the `createdLocalFolderCount` poll metric covers it).

7. **Ghost state keys protected local-only files from import deletion**: the import
   delete set was derived from `nextState`, which seeds from `previousState`
   (credentials.remoteState) and therefore keeps entries for paths removed remotely
   since the last sync. The delete set now uses the live walk's file set only.

**Live verification matrix (final build, real project + real Nextcloud, all pass):**
- forced push (original 500 repro) → 200, clean state;
- Export: remote-only file deleted; local-only file uploaded; identical trees after;
- Import: locally-deleted (remote-present) file re-applied; local-only file deleted;
  identical trees after;
- fresh-name targeted test: remote-only file deleted by Export, never created locally.

## Verification caveats
- Live browser (agent_browser) was unavailable in this environment (wrapper
  daemon-policy check hangs; chromium as root repeatedly failed to attach), so UI
  rendering was verified at the shipped-artifact level instead: the built frontend
  bundles contain `git_provider`="Git Provider", `sync_with_git_provider`="Sync with
  Git Provider", the WebDAV import/export helper notes, and the Dropbox app-folder
  labels; the user-settings bundle no longer contains the WebDAV "Last synced"
  string (0 refs to `last_synced`).
- Dropbox `fullPath` verified by executing the route's exact resolution logic against
  live data → "Apps/Overleaf Dev/A5 test" (custom displayRoot → "<root>/A5 test").
- The WebDAV *connected* settings-widget view cannot be rendered under testjoe
  (not the WebDAV user) — code-level verification only (string removed + bundle
  check above).
