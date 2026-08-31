# PLAN — overleaf-cep (live: psintern.neuro.uni-bremen.de)

**Single source of truth for open work.** The round documents in this repo
(`UI_ROUND10_PLAN.md`, `UI_ROUND11_PLAN.md`, `UI_ROUND12_PLAN.md`,
`SSO_MULTI_PROVIDER_PLAN.md`, `BIB_ORCID_TEMPLATES_PLAN.md`,
`BUGHUNT_REPORT.md`) are **historical logs** — wherever they disagree with
this file, **this file wins**.

Last updated: **2026-08-31** — live image `sharelatex:bib-editor` @
`a41f364064ab` (build 45), `overleafserver` healthy.

---

## 1. OPEN items

### O1 (P1) — Batch G, sweep G3: admin-API edge-case sweep — NOT RUN
Exercise every `/admin/site` tab's save/validate contract via the real API
(`PUT /admin/site-settings/:section`, CSRF header):
- invalid types / wrong shapes per section (expect 422 + clear message)
- unknown keys (expect 422 "unknown key" — allow-list from 2026-08-30 fix)
- secret fields: stored secret never returned in plaintext (masked),
  empty-PUT keeps the stored secret (not wiped)
- `sso-*` sections: disabling a provider via API removes its login button
  from `/login` within one request; re-enabling restores it
- sandboxed-compiles: images list round-trip; empty list allowed
- externalUrl: regex validation (broken regex → 422, not silent allow-all)
Acceptance: results table (tab × case × status ✓/✗) appended to O3 report;
any bug fixed + regression-tested + built.

### O2 (P1) — Batch G, sweep G6: bib/editor + library sweep — NOT RUN
In-project (test user) flow:
- `.bib`: visual ↔ code sync both directions; entry create/edit/delete;
  add-from-DOI/ORCID/Zotero still wired (ORCID picker returns to entry form);
  resizer drag + position persistence; both themes clean console
- `/library`: entry list, reorder, delete, import/export round-trip,
  scrollbar behavior (hidden until hover/scroll), both themes
- "Out of sync" guard: no regression (R5 fix) after R11/R12 builds
Acceptance: results table appended to O3 report; any bug fixed + tested.

### O3 (P2) — `BUGHUNT_ROUND2_REPORT.md` — NOT WRITTEN
Deliverable closing Batch G. Must contain:
- **P0 incident**: the recurring `sharelatex.site_settings` destruction —
  root cause (**our own unit-test suite in the shared vitest worker bound
  the default `mongodb://127.0.0.1/sharelatex` before per-file env ran**;
  oplog proof: 43 ops/70s idle-cluster windows, delete→seed→delete triad,
  times matching our test runs), the three-layer defense (unit-env setup
  file, manager tripwire, test cleanup guards) and the proofs (36/36,
  before/after byte-identical, 0 live writes, positive/negative controls)
- G1 console sweep (20/20 clean) + G2 SSO result (resolved; SAML/OIDC/LDAP
  E2E pass)
- G3 (O1) + G6 (O2) results tables
- R12 outcomes (14 items) + R12-15/16/17 (bundle 500, placeholder,
  Permissions-Policy) one-liners with build/commit refs
- Known non-issues: `Permissions-Policy` warning (fixed), `ssoConfigs`
  read-only prod doc, 404 on `GET /admin/site-settings/:section` (route is
  whole-doc GET + per-section PUT)

### O4 (P2) — Pre-existing core-suite flakiness (~17 files / ~183 tests)
Measured **baseline without our changes: 185 failing** (17 files, shared
`isolate:false` worker); with our changes: 183. **Not a regression**, but it
makes CI unreliable. Direction:
- switch vitest pool to `forks`/`threads` with `isolate: true` for the
  affected projects, and audit each flaky file for shared-state assumptions
  (DB singletons, mongoose connection leaks, timers)
- goal: the 17-file set green in a full parallel run
Out of scope until O1–O3 close.

### O5 (P3) — Cosmetic: `/user/mysettings` & `/admin/panel` height
Horizontal overflow: **0** (sw == cw). Body is ~40–50 px taller than the
viewport (footer bar) → slight vertical scroll. Fix only if requested:
re-flow the footer into the viewport (shell grid tweak).

### O6 (P3) — Image tag hygiene
Build tag stamps the latest commit **at image build time**; builds launched
from a working tree ahead of HEAD end up tagged one commit behind content
(last: tag `2af01ad…` on content incl. `f9baea…`). Cosmetic; consider
commit-before-build discipline in the build script.

---

## 2. Verification checklist (the "repeat the prompt" contract)

Past this prompt (or any subset) to force a live re-verification; each point
has the expected outcome and the probe already available under `/tmp`:

1. **`/register` disabled** — anonymous `GET /register` → redirects to
   `/login` (logged-in admin may still open the management page).
2. **`/user/mysettings` layout** — white `.ce-admin-card`, no horizontal
   overflow (`scrollWidth == clientWidth`).
3. **`/admin/panel` layout** — no overflow; only the real sections
   (System Messages, Active Projects, Open/Close Editor); no husk tabs.
4. **"Projects" navbar pill** — visible on `/project`, `/library`,
   `/templates`, `/templates/manage`, `/template/:id`.
5. **`/library` scrollbar** — `.bibtex-entry-list-body`:
   `scrollbar-width: thin`, transparent until hover; content scrolls.
6. **`/templates/manage` → Template bundles** —
   "Download bundle" per template works; "Import from URL…" does **not**
   500 (409 same-name + override for an existing zip, 200 for new);
   input placeholder renders as
   `https://www.example.com/.../Test_1_cccc_v1.bundle.zip`.
7. **Console clean on `/templates/manage`** — no
   `Permissions-Policy … attribution-reporting` warning in response headers.
8. **Site settings intact** — `GET /admin/site-settings` (admin) returns all
   13 sections; `/admin/site` tabs all render; **SAML, OIDC, LDAP logins all
   succeed E2E** (test@example.com / test2@example.com /
   carol.jones@example.com) and land on `/project`.

---

## 3. Incident log (summary)

| Incident | Root cause | Defense | State |
|---|---|---|---|
| Repeated loss of stored site settings (SSO config, SMTP, sandbox, …) — 2026-08-30/31 | **Our own unit tests**: shared vitest worker bound `Settings.mongo.url` to the default `mongodb://127.0.0.1:27017/sharelatex` (published live DB) before per-file env ran; test cleanups then hit the live doc | (1) `test/unit/unit-env.mjs` first import-free setup file pins unit DB for every worker; (2) `SiteSettingsManager` FATAL tripwire in test env when db = `sharelatex` (unswallowable); (3) per-test `assertUnitDb` + non-destructive cleanup; rolling `site_settings_snapshots` (keep 10) + `tools/restore-site-settings.mjs` | **CLOSED + PROVEN** (36/36 green, live doc byte-identical before/after, 0 live writes in oplog window) |
| Bundle "Import from URL" 500 — 2026-08-31 | `fetchWithPolicyRedirects` missing from `UrlAgent` default export surface | exposed (default + promises + named); pre-check on first hop; regression suite (local HTTP: direct, redirect, blocked-host 403) | **CLOSED** (build 45; 409-override flow live) |
| Placeholder lost `https:` | i18next parsed `https://…` **key** as ns `https` + key `//…` | safe key `template_bundles_url_placeholder`, URL in value only | **CLOSED** (build 45) |
| Console: `Permissions-Policy … attribution-reporting` | obsolete directive in default policy | removed from `config/settings.defaults.js` | **CLOSED** (build 45) |
| LDAP SSO "live login drops" (P1) | stored `sso-ldap` section had been wiped (see incident 1) | restored via admin API; strategy refresh on each login attempt | **CLOSED** (E2E pass 2026-08-31) |

---

## 4. Closed rounds (history in the linked files)

- **P0–P4, R1–R9** (stray strings, ORCID/DOI pickers, templates, admin
  console, reviewer out-of-sync, Zotero picker, env-strip, SSO multi-provider
  stored-config) — DONE (see `BIB_ORCID_TEMPLATES_PLAN.md`,
  `SSO_MULTI_PROVIDER_PLAN.md`, `BUGHUNT_REPORT.md`).
- **R10** (13 items) — DONE, build 33 (`UI_ROUND10_PLAN.md`).
- **R11** (17 items, batches A–F) — DONE, build 42 (`UI_ROUND11_PLAN.md`).
- **R12** (14 items) — DONE, builds 42–45 (`UI_ROUND12_PLAN.md`).
- **R12-15/16/17** (bundle 500, placeholder, Permissions-Policy) — DONE,
  build 45 (`UI_ROUND12_PLAN.md` tail).

**Next actions:** close O1 → O2 → O3 (one final build if anything is fixed),
then optionally O4 (suite isolation) and O5 (cosmetic).
