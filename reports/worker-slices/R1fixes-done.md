# Slice R1-FIXES — completion note (final, 2026-08-16)

Independent-review repairs. Per-file, per-task status follows. Acceptance evidence is at the bottom.

## RF.1 (CRITICAL claim — webdav key-shape divergence) — **SKIPPED: reviewer false positive**
Supervisor decision 2026-08-16: APPROVED to skip; invariant pinned by
`test/unit/keyShape.test.mjs`. No key shapes changed anywhere.

Evidence (verified against source this run):
1. `ProjectEntityHandler._getAllFolders` seeds the root folder with path `'/'`
   (`processFolder('/', project.rootFolder[0])`); `getAllDocs`/`getAllFiles` build
   keys with `path.join(folderPath, doc.name)` → Node POSIX `path.join('/', 'main.tex')`
   = `'/main.tex'`. Entity keys are LEADING-SLASH (contradicting the report's
   "verified key fact: slash-less").
2. Push lane (`syncProject`) writes `nextState[filePath]` with those leading-slash
   keys and builds remote URLs via `remotePath(rootPath, projectName, filePath)`,
   which requires a leading slash: verified `remotePath('/Overleaf','Proj','/main.tex')`
   = `/Overleaf/Proj/main.tex`, while `remotePath('/Overleaf','Proj','main.tex')`
   = `/Overleaf/Projmain.tex` (corrupt).
3. Pull lane (`pollUser`) derives `relativePath = entry.path.slice(projectRoot.length) || '/'`
   → `/main.tex`; lookups `localDocs['/main.tex']`, `localFiles['/main.tex']`,
   `previousState['/main.tex']` all HIT against real shapes, so the C1 local-changed
   gate and the no-phantom guard were already working.
Applying the specified fix (strip the leading slash) would have broken both lanes:
`localExists` would always be false (silent remote-apply clobber over local edits)
AND push/pull remote URLs would corrupt (`/Overleaf/Projmain.tex`).

## RF.2 (HIGH) — conflict UI reachability — DONE
`WebdavSync.mjs`: conflicts (push lane `syncProject` and poll lane `pollUser`) now
mirror onto the project STATE doc via separate Mongo operators:
`$set: { mergeStatus: 'conflict', lastSyncAt, lastConflict: { path, allPaths,
projectId, detectedAt, remoteEtag } }`; clean syncs set `mergeStatus: 'clean'` and
`$unset: { lastConflict: 1 }` (no-op when no state doc). Field names match the modal
(reads `mergeStatus === 'conflict'` + `lastConflict.path`) and the resolver
(`conflictMatches` on `.path`/`.projectId`). Credentials-side bookkeeping kept
(resolve() consults both).

## RF.3 (HIGH) — cross-user delete scope — DONE
- `WebdavCredentials.remove()`: strict `{ ownerId: userId }` selector (the `$or`
  `baseUrl` branch removed; legacy docs without ownerId deliberately left).
- `webdav/index.mjs` `expireDeletedUser` hook: same strict scope (was the second
  cross-user `$or` selector in the module — not in the slice's file list, but RF.3's
  acceptance criterion "zero baseUrl delete selectors in the module" required it;
  flagged here explicitly). Also removed the now-unused `WebdavTokenEncryption`
  import/decrypt (no lint regressions).

## RF.4 (MEDIUM) — Dropbox push deletion reconciliation — DONE
`DropboxRouter.mjs` push route: the remote-identity lookup now uses the normalized
map `remoteRemoteMap[normalizedFilePath]` instead of raw `remoteBeforePush[...]`
(keys WITH a leading slash → the old lookup always missed, so every legitimate
deletion was skipped as "remote changed"). The local-existence set is also
normalized to slash-less keys (entity paths carry a leading slash; the old
mixed-style `has()` never matched, defeating the guard). `skippedDeletions`
semantics unchanged (collect + warn + no deletion when identity changed).

## RF.5 (MEDIUM) — sync-exclusion parity — DONE
- `datamanipulator/app/src/fileUtils.mjs`: `isSyncExcluded` now checks EVERY path
  segment for a dot-prefix (was first+last only; `sub/.git/config` now excluded);
  extension rules unchanged.
- `WebdavSync.mjs`: local `isSyncExcluded` helper (identical rules, comment points
  at the two sibling implementations). Applied to: poll-lane remote walk entries,
  push-lane docs/files upload loops, and BOTH push-lane remote deletion loops
  (excluded remote entries are never reported deletable).

## RF.6 (LOW) — Dropbox link rollback window — DONE
`DropboxRouter.mjs` `/project/:id/dropbox/link`: the try/catch now covers the whole
post-upsert window — `uploadProjectToDropbox`, `getDropboxRemoteFiles`, the C1
localHash merge, the state mutations and `state.save()` (plus `res.json`). ANY
throw in that window rolls back the state doc ONLY when this request created it
(`!statePreExisted`, owner-scoped) and rethrows. Previously a failure in
`getDropboxRemoteFiles`/`state.save()` left an orphan `connected:true` doc with no
`remoteFiles` baseline (which disabled the C1 gate).

## RF.7 (LOW) — empty-remote-listing guard — DONE
- `datamanipulator/app/src/sync.mjs` `pullFiles`: the ARC-06 throw now honors
  `options.allowEmptyRemote` (default false — strict for every other caller).
  (The throw lives in `pullFiles`, the function the `/pull` route calls;
  `fullSync`/`/sync/full` were never guarded and are unchanged.)
- `datamanipulator/app/src/server.mjs` `/pull` route: passes `allowEmptyRemote: true`
  (a single known project folder may legitimately be empty).

## RF.8 (LOW) — Dropbox modal false success — DONE
`dropbox-sync-modal.tsx`: `handlePull` and `handlePush` now inspect the 200-response
payload; when `success === false` (e.g. `remoteMissing`) they surface the server
`message` in the alert/error path, refresh state, and KEEP the linked UI state
(previously "Successfully imported/exported" was shown for these failures).

## Verification (final run results)
- `node --check` on all 7 changed .mjs files → all OK
  (WebdavSync, WebdavCredentials, index.mjs, DropboxRouter, sync, fileUtils, server)
- `npx eslint --max-warnings 0` (services/web, 5 web files incl. the tsx) → clean
- `npx eslint --max-warnings 0 app/` (services/datamanipulator) → clean
- `npx eslint --max-warnings 0 test/unit/keyShape.test.mjs` (webdav module) → clean
- `npx vitest run` services/web/modules/webdav → **Test Files 8 passed (8); Tests 49 passed (49)**
  (6 unit + 1 integration + 2 other = incl. 3 new keyShape tests; no regressions)
- `npx vitest run` services/datamanipulator → **Test Files 4 passed (4); Tests 21 passed (21)**

## Residual risks / notes
- RF.2 clean-mirror in `pollUser` fires only for single-match projects (`projects.length === 1`);
  same-name multi-project iterations skip it (conservative; no state corruption).
- RF.3 leaves legacy ownerless state docs in place (documented trade-off, same as H6).
- RF.4: deletions now actually happen when the documented 3-condition guard holds
  (previously always skipped); only files absent locally, from the previous sync, and rev-unchanged.
- The cross-module D2 exclusion rule is duplicated by design (3 small copies) — drift risk
  covered by comments; a cross-package lint test is out of scope here.
- No build/docker changes; backend stays pure .mjs; modal stays tsc-clean under eslint.
