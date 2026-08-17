# Plan: Dropbox mirror sync + UI cleanup (2026-08-17)

Context: user demands the same UX as the (deployed, verified) WebDAV module:
project-level mirror in BOTH directions, no per-file conflict UI, modal warnings
explaining the destructive direction, and removal of the "Dropbox App Folder"
settings input (display-only, no UX value).

## Root cause found: modal shows "/A5 test" instead of "Apps/Overleaf Dev/A5 test"

The state endpoint (`DropboxRouter.mjs` ~line 798) computes `state.fullPath` by
assigning a NON-SCHEMA property onto the mongoose document, then
`res.json(state)` → `toObject()` DROPS non-schema properties → `fullPath` never
reaches the modal → fallback `status.projectPath` (a schema field) = "/A5 test".
`fullPath` is NOT in the `dropboxsyncprojectstates` schema; `projectPath` IS.
Fix: build a plain response object (`state.toObject()` + computed fields).
(Previous in-process "verification" printed the computed value directly — it
never exercised serialization; that's why this survived live.)

## Changes

### 1. State endpoint display fix (DropboxRouter.mjs)
- Compute `projectPath`/`fullPath`, respond with a plain object:
  `res.json({ ...state.toObject(), projectPath, fullPath })`.
- Remove `displayRoot` references (feature removed); keep chain:
  credentials `path` (≠ "/") → legacy path → "Apps/Overleaf Dev".

### 2. Remove "Dropbox App Folder" settings feature (per user)
- `dropbox-widget.tsx`: remove label/description/input/Save + handler + state.
- `DropboxRouter.mjs`: remove `POST /user/dropbox/display-root`.
- `dropboxUserCredentials.mjs`: remove `displayRoot` field.
- i18n: remove `dropbox_app_folder_label`/`dropbox_app_folder_description`.

### 3. Mirror sync both directions (like WebDAV) in DropboxRouter.mjs
Push (Export, local wins):
- Upload all non-excluded local docs+files (existing behavior, minus conflict gate).
- List remote project folder FIRST (409 → empty set = folder will be created;
  hard error → abort, no mutation).
- After successful uploads: delete remote files not in local set
  (never `isSyncExcluded` names; project folder itself never a target).
- Update state: remoteFiles snapshot (post-op), `conflicts: []`,
  `lastConflict: null`, `mergeStatus: 'clean'`, `lastSyncError: null`.

Pull (Import, remote wins):
- List remote project folder (409 → existing protective "folder missing"
  message; no local deletion).
- Apply every non-excluded remote file: remote wins — applies unconditionally
  except when remote rev unchanged AND local content unchanged AND entity
  present (skip for churn). Locally-deleted entity → re-apply (remote wins).
- Delete non-excluded local-only files (entity API same as WebDAV import;
  guard root "/" against project soft-delete).
- Create remote-only folders / delete local-only empty folders (parity).
- Same state update + conflict clearing as push.

- `importNewProjectFromDropbox` (link flow, source of the current 8 spurious
  "conflicts"): stop recording conflicts when the local file exists — apply
  (remote wins), reusing the import core.
- Remove `planRemoteDeletions` + conflict gates (dead under mirror semantics).
- Remove `POST /project/:project_id/dropbox/conflict/resolve` (dead; new syncs
  self-heal stale conflict state by clearing it).

### 4. Modal (dropbox-sync-modal.tsx)
- Remove conflict section (warning list + "Keep Overleaf/Dropbox version"
  buttons), `resolveConflict` handler, conflicts alert branches.
- Add notes (i18n): `dropbox_import_note` / `dropbox_export_note`:
  - "Import replaces this project's content with the Dropbox folder. Files
    that exist only locally are deleted."
  - "Export replaces the Dropbox folder with this project. Files that exist
    only on Dropbox are deleted."

### 5. i18n
- Add `dropbox_export_note`, `dropbox_import_note` to en.json (alphabetical,
  U+2019 apostrophes) + extracted-translations.json ("" values).
- Remove `dropbox_app_folder_*` from both files.

### 6. Tests (dropbox module vitest)
- Update `DropboxPushGuard.test.mjs`: drop `planRemoteDeletions` tests;
  keep `joinDisplayPath`/`resolveDisplayRoot` (now 2-arg calls); add tests for
  the new pure mirror helpers (delete-set computation with exclusion guard,
  import apply-decision: missing-local → apply, unchanged → skip,
  rev-changed → apply).
- Run all dropbox unit tests; `node --check` every touched .mjs;
  scoped eslint `--max-warnings 0`.

## Verification
1. Static: lint + unit tests + parallel reviewer subagents on the diff.
2. Rebuild image (`make all`), md5-verify deployed files, restart,
   "Enabling Dropbox module"/web log healthy.
3. Live in-process (container): drive the REAL state route handler via a bare
   express app + fake res → assert response JSON contains
   `fullPath: "Apps/Overleaf Dev/A5 test"` (serialization regression covered).
4. Live E2E (project "A5 test", user-connected Dropbox):
   - verify both trees identical + hash-compare before;
   - local-only file → Export → appears on Dropbox;
   - remote-only file (uploaded via client) → Export → deleted on Dropbox,
     never created locally;
   - locally-deleted file → Import → re-applied; local-only file → Import →
     deleted locally;
   - after each op: both trees identical; conflict state cleared;
   - final: user's 8 files identical both sides, zero test leftovers.
5. Report: what changed, commands, exact evidence lines.

## Data-safety invariants (same discipline as WebDAV lane)
- Deletions only after a successful FULL listing (no partial-list deletes).
- `isSyncExcluded` entries are never created/applied/deleted on either side.
- Project folder path "/" never passed as a delete target.
- Remote folder missing → no local deletion; user is told and project is kept.

## Review round (2026-08-17)
- ui-i18n reviewer (fresh context): all 5 categories clean; note N1 = stale
  README endpoint doc → FIXED (README sync-behavior + endpoint table updated).
- correctness reviewer (fresh context, hit 30-min cap late): confirmed finding —
  `getAllDocs/Files` keys carry a LEADING SLASH (live-verified for "A5 test").
  → FIXED: canonical key handling in localHashes (push/link baselines),
  normalized local-doc maps for the churn guard; mirror-delete helpers were
  already format-agnostic (normKey on both sides).
- Parent-added fix (would have been DATA LOSS): importProjectFromDropbox
  swallowed the 409 listing error internally → an import with a missing remote
  folder would look like an empty folder and the mirror deletion would wipe the
  whole project. Now the helper sets remoteFolderMissing (both roots 404) and
  the pull route aborts with the ARC-06 "folder not found" message, no local
  mutation; legacy conflict state is still cleared by any completed sync run.
