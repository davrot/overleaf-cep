# F1 — datamanipulator sync-path fixes — DONE (2026-08-15)

## Where isSyncExcluded landed
Defined ONCE in `app/src/fileUtils.mjs` (exported + in default export). Applied in:
- `fileOperations.mjs` walkTree: excluded entries skipped entirely (no listing, no recursion, no checksumming); node_modules list-don't-recurse behaviour preserved. Covers: /tree, /files, /push manifest (server.mjs consumes walkTree), and sync.mjs localMaps (consume walkTree).
- `server.mjs` `/pull` route: `remote_files` + `deleted_paths` filtered before `pullFiles` → excluded entries never applied locally, never deletable (sync.mjs untouched, per file list).
- `server.mjs` `/sync/full` route: `remote_files` filtered before `fullSync`.
- `treeCompare.mjs` compareTrees: excluded paths dropped from BOTH left/right maps.
Note: sync.mjs pullFiles/pushFiles/fullSync loops are NOT in the editable file list; the route-level
filters above are the funnel (all three routes live in server.mjs).

## F1.2 (M6)
compareTrees: equal-size no-checksum pair now → new `unknown[]` array (with note), NOT `identical`.
Size mismatch still → conflict. Return shape backward compatible (added key only). Debug log includes unknown count.

## F1.3 (M8)
detectFileType: removed the always-false `0<=byte<=255` loop; behaviour identical (non-UTF-8 + zero nulls → text/latin1, with nulls → binary). Comment left.

## F1.4 (M5)
walkTree single isSyncExcluded gate replaces the dot-special-casing; re-read all loops — no other place special-cases dotfiles (readFile/writeFile/deletePath intentionally left unfiltered: explicit single-file contract preserved).

## Cross-slice repairs (needed for acceptance; flagged)
- package.json: removed devDep `mongodb-legacy@^5.8.0` — version does NOT exist in the npm registry
  (5.x stops at 5.0.0; 6.x exists) and it is unused (zero references), which made every
  `npm install` in this service fail → node_modules was empty. (pre-existing, not introduced by F1)
- test/unit/projectIdValidation.test.js (slice A): `process` no-undef → `import process from 'node:process'` (eslint-env comments unsupported by this eslint version).
- Ran `npm install` in services/datamanipulator (364 pkgs, supertest + @overleaf/logger present).

## Validation
- node --check: fileUtils/fileOperations/treeCompare/server — all pass
- npx eslint --max-warnings 0 app/ test/ → ESLINT_OK (0 warnings)
- npx vitest run → 3 files, 17/17 pass (includes new test/unit/syncExcluded.test.js)

## Residual risks
- /file GET/POST/DELETE single-file routes remain unfiltered by design (explicit file contract) — callers choosing excluded paths can still touch them; sync endpoints are protected.
- pushFiles()/fullSync() called directly (not via routes) would bypass the remote-side filter; all live callers are the routes (verified: server.mjs only).
- `unknown` is a new key: any consumer switching on compareTrees keys must tolerate it (it is additive).
