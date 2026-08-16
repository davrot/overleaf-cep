# Slice I — test battery — DONE (2026-08-15)

## Tests added (all green)
| Service | File | Result |
|---|---|---|
| datamanipulator | `test/unit/treeCompare.test.js` (I.1) | 4/4 pass (unknown class, size-mismatch conflict, D2 exclusion from both sides, checksummed baseline) |
| webdavinterface | `test/unit/server.test.mjs` (I.3) | 6/6 pass (401/404/409 mapping, no credential leak in body, log redaction observed, degraded + enforced service-token modes, Bearer form) |
| githubinterface | `test/unit/cloneValidation.test.mjs` (I.4) | 4/4 pass (file:// reject, insecure-http reject, host-mismatch reject, missing fields) — new test/ dir (harness: vitest+supertest devDeps already present) |
| webdav module | `test/unit/i18n-sanity.test.mjs` (I.5) | 5/5 pass (no `{{}}`, no empty provider values, your_username, six error keys in en.json + extracted) |

## Existing test repaired (was broken by pre-existing WIP + B2 contract change)
- `services/web/modules/webdav/test/unit/src/ConflictResolver.test.mjs` (user-WIP file,
  failed at collection since B2 added the `WebdavSync` import): added `WebdavSync` +
  `WebdavCredentials` mocks, rewrote the `resolve` block to the C2 contract
  (real content work first, `$set`/`$unset` separate operators — asserts the
  historical `$unset`-inside-`$set` bug cannot silently return, sync-failure leaves
  state uncleared, credentials-side conflict recognized). 16/16 pass.

## Full-suite totals (acceptance)
- datamanipulator `npm test`: 4 files / 21 tests PASS (17 pre-existing + 4 new)
- webdavinterface `npm test`: 3 files / 18 tests PASS (12 pre-existing + 6 new)
- githubinterface `npm test`: 1 file / 4 tests PASS (all new)
- webdav module `npx vitest run`: 7 files / 46 tests PASS (30 pre-existing incl. repaired file + new)
- eslint clean on all touched test files

## Deferred (per timebox rule)
- I.2 — SKIP: `isSyncExcluded` already covered by pre-existing `syncExcluded.test.js` (25 refs).
- I.6 — SKIP: dropbox module has NO vitest harness (no test script / vitest devDep in its
  package.json); adding one would be scope creep. `isSyncExcluded` logic duplicated from the
  shared pattern exercised by the datamanipulator + webdav-interface tests.

## Residual risks
- `ConflictResolver.test.mjs` now pins the C2 contract (behavioral guard — intended).
- githubinterface has no shared vitest config (default config used); fine for these pure
  validation tests, but future heavier tests may need one.
