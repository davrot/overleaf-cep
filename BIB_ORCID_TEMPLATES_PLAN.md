# Plan: ORCID picker · bib-editor fixes · templates

Branch: `bib-editor` (origin `davrot/overleaf-cep`) — checkout `/root/junk_bib/overleaf-cep`
Status: FINAL v4 (2026-08-28) — all open decisions agreed by the user (2.2 zip + pdf-optional, 2.3 ORCID semantics, 2.4 stray string confirmed, 3a publish fields, 3c encrypted secrets, 3d SSRF implementation). Executing: **P0 DONE → P1 DONE → P2 (ORCID port) next** (2026-08-28).

### Progress log (verified)
- **P0 DONE (2026-08-28)** — stray helper removed on both surfaces;
  mapping now a tested pure `helperKeyForField` (`utils/bib-form-helper.ts`,
  4 unit tests); key dropped from `en.json` + `extracted-translations.json`.
  Gates: eslint 0 warn, vitest 424/424, image `bib-editor-5c6dacf…` built
  (stray string absent from bundle), container cycled healthy (image-ID match,
  /tmp 1777, port 4000), **live-verified**: project form (greenwade93 → Author
  row has no helper) + library Add→"Enter manually" (Author row no helper),
  `strayOnPage=false` on both. Committed `011b72458a` (code) + `08b50ebc96`
  (this plan), pushed to origin/bib-editor.
  - Note: root `yarn install` was required (known-broken lockfile; sanctioned
    ~4.7k-line prune committed with P0; `yarn install --immutable` passes).
  - i18n pipeline follow-up (LOW, separate task): scanner glob
    `modules/*/frontend/js/**` misses modules without `js/` (reference-picker,
    symbol-palette) and drops some TSX `t()` calls → regenerating
    `extracted-translations.json` now removes 797 keys (773 stale, 24 still used
    incl. bib-editor strings + `Page range` helper). Do NOT regenerate until the
    scanner config/transform is fixed + the 24 re-added (list obtainable via a
    key-diff of the scanner output vs HEAD file).
- **P1 IN PROGRESS** (2026-08-28) — deployed build now = current tree + P0.
  Repro harness: CDP driver `/tmp/oly-e2e/cdp.mjs`; open entry = click
  `.bibtex-entry-card-clickable` (role=button, id `bibtex-entry-card-<key>#0`);
  list = `.bibtex-entry-list-body [data-index]`; panel = `bib-editor-panel` /
  `bibtex-list-and-preview` (a CM6 `cm-panel` under `.cm-panels`); Visual mode =
  "Visual" span near editor; project `sample.bib` entry `greenwade93` = baseline.
  Open: identify the save control for the project form (no Check/Save button
  inside `#bibtex-entry-form`; footer likely in panel toolbar) before the
  reviewer-sequence repro (edit author → save → main.tex → back).

  **2026-08-28 update — REPRODUCED (3×) + ROOT CAUSE identified + fix designed:**
  Sequence (live TestProject/`sample.bib`, entry `greenwade93`): Visual → open
  entry → type new author into `#bib-field-author-0` (flush fires on the file
  switch — `bib-editor-panel.tsx` leave-watcher; spy: exactly ONE
  `bib-editor:write`, zero `write-failed`) → click main.tex → click sample.bib →
  **list shows the entry TWICE** (both rows with the new author). **Server truth
  (fresh load) = exactly 1 entry with the new author** after every repro run →
  server is correct; corruption is client-side only. Console (`?debug=true`):
  `[inflightOpTimeout] Sending` ×N, `aborted`, `Received an ack for an op with
  an outdated version.` ×3, `pollSavedStatus: assuming not saved` forever (op
  never acked) → reviewer's 'Out of sync' on next interaction; reload → 1 entry.

### P1 ROOT CAUSE (code-verified; FIXED + VERIFIED 2026-08-28)

Protocol: vendor `services/web/frontend/js/vendor/libs/sharejs.js` +
`services/real-time/app/js/DocumentUpdaterController.js`:
1. `submitOp()` applies the op to the local snapshot WITHOUT advancing `version`
   (`flush()` sends `v: this.version` pre-increment; version only advances in
   `_onMessage` on ack/remote-apply).
2. Server applies once (mongo content proves it) and acks the SENDER with pure
   `{v, doc}`; the full op goes to collaborators — EXCEPT a `dup`-marked op
   (resend already applied): controller comment: "Duplicate ops should just be
   sent back to sending client for acknowledgement" → **sender receives its own
   op back** (`client.emit('otUpdateApplied', update)`).
3. Client own-op branch (`sharejs.js:1094`) requires
   `inflightSubmittedIds.includes(msg.meta.source)` — but that list is only
   pushed in `_connectionStateChanged('disconnected')` (~line 977), never on a
   normal send. A mid-op socket/session churn (observed `aborted` = transport
   abort/reconnect → new session id) → server-recorded `meta.source` (old
   session) ∉ list → **dup echo misroutes to the REMOTE-OP branch (~line 1230)**:
   `msg.v === this.version` still passes; `_xf(inflightOp, op)` self-xform
   keeps BOTH inserts → **op applied a 2nd time locally** (duplicate entry,
   `version++`).
4. The true pure-ack then arrives `v < this.version` → "ack for an op with an
   outdated version" → **discarded** → `inflightOp` never cleared → endless
   `[inflightOpTimeout] Sending` + `assuming not saved` (dead state).
5. Next state rebuild shows the corrupted snapshot (2 entries); next edit hits
   the desynced version state → Out of sync modal; reload restores server truth.

**Fix (minimal, vendor file — already carries Overleaf modifications):** extend
the own-op branch condition at `sharejs.js:1094`: if `this.inflightOp` is set,
`msg.v === this.version`, and the incoming op deep-equals `this.inflightOp`
→ treat as own-op ack (reuse existing ack path: clear inflight, callbacks,
`delayedFlush()`), plus a debug log when the rescue fires. GATES: CDP repro →
1 entry / saved / no outdated-ack warn / no resend loop; plain-edit sanity; two-
session collab sanity; eslint (scoped, 0 warn); bib-editor vitest 424/424;
`make all` + cycle + live verify both surfaces; commit+push. Regression
artifacts: move the CDP repro scripts from /tmp into the repo (scripts/ or the
bib-editor module test dir) as the standing repro/test.

**FIX APPLIED** (`frontend/js/vendor/libs/sharejs.js`): the own-op branch
condition (the `msg.op === undefined …` line) is extended with
`|| isOwnOpEcho(this, msg)`; helpers `sameOpJson()` (safe deep JSON
equality) + `isOwnOpEcho()` (requires a live unacked `inflightOp`, matching
`msg.v === this.version`, and content equality) route the dup echo into the
existing ack path (clears inflight, callbacks, `delayedFlush()`), with an
always-on debug warn when the rescue fires.

**VERIFIED (2026-08-28, deployed image `bib-editor` = `e05d63b1…`):**
- RED baseline (pre-fix build): repo regression test FAILED exactly as
  predicted — entry duplicated (2 rows), 2× `ack … outdated version`, 2×
  `[inflightOpTimeout] Sending`, op left un-acked.
- GREEN (fixed build): **11/11 checks PASS (twice)** — one entry, new author
  present, 0 outdated-ack discards, 0 resends across the 5s watchdog
  window, final `pollSavedStatus: no inflight or pending ops` (saved), no
  Out-of-sync modal.
- Collab sanity (two sessions): B ran the reviewer sequence while A held
  the file — A sees exactly the single updated entry; B's console clean.
- GATES: eslint 0 warn (scoped; vendor file eslint-ignored by design),
  bib-editor vitest 424/424, `make all` clean, container cycled healthy
  (image-ID match, /tmp 1777, port 4000), rescue string present in the
  served bundle, live-verified on the FQDN (testjoe).
- Regression artifact now in the repo:
  `services/web/modules/bib-editor/test/e2e/` (cdp.mjs driver +
  out-of-sync-repro.mjs + README) — env-only credentials, exit 0 on pass.
- Server dedup was never at fault (mongo content = 1 entry after every
  repro run); the fix is entirely in the vendored sharejs client. Residual
  (out of scope, low): a genuine two-user identical-op race could in theory
  be classified own — content-identical, invisible no-op.

---

## 0. Current state (verified in this tree / live container)

**Layout (this tree — reorganized CE):**
- Web app: `services/web/{app,frontend,modules,config}`. `services/web/app` = `src/`, `templates/`, `views/` (templates live in `services/web/app/templates/` → `plans/`, `project_files/`).
- Modules: `services/web/modules/<name>/{app/src/*.mjs routers, frontend/js/{components,context,utils,pages}, index.mjs}`.
- Module registration: `services/web/config/settings.defaults.js` — `moduleImportSequence` (backend routers, e.g. `'template-gallery'`, `'git-bridge'`), `sourceEditorExtensions`, `visualEditorProviders`, … (bib-editor is already registered: `sourceEditorExtensions: [bib-editor-extension.ts]`, line ~1080).
- `AuthenticationController` import path used by current modules (admin-tools, bib-editor `LibraryRoutes.mjs`): `../../../../app/src/Features/Authentication/AuthenticationController.mjs` — i.e. the **old orcid-picker router imports are layout-compatible with this tree** (verified).

**bib-editor (project + library surfaces):**
- File is truth (R2): CodeMirror document is the source of truth. `bib-editor-extension.ts` re-parses the doc on change (300 ms debounce) and emits `BIB_ENTRIES_EVENT` (`entries`, `source`, `isBibFile`, `written?`). `bib-editor-provider.tsx` bridges events → React context (`setEditorState(isBibFile, entries, source, written)`). Writes are guarded pure plans in `bib-write.ts` (`planBibWrite/planBibDelete/planBibBulkDelete/planBibImport`, guards: `key-taken`, `not-a-bib-file`, `entry-gone`, clamp-on-stale-range).
- Components: `bib-editor-panel.tsx` (list + toolbar + write-failure banner "Could not save: the file changed or is no longer a bibliography."), `bib-entry-list.tsx` (Add dropdown: Paste references [BibTeX, DOI] / Enter manually / Import-from-Library stub — C5/C9), `bib-entry-form.tsx` (shared form, kinds `new`/`edit`/`inplace`), modals `bib-manual-modal.tsx` / `bib-import-modal.tsx` / `bib-import-from-library.tsx`.
- Library: `frontend/js/library/*` (`library-page.tsx`, `library-context.tsx`, `library-api.ts`) + backend `app/src/LibraryController.mjs` (409 on duplicate key), `LibraryRoutes.mjs`.
- Library feature flag pattern exists: `OVERLEAF_BIB_LIBRARY` (settings.defaults.js:847 comment).
- **Stray string (point 2) located:** `bib-entry-form.tsx:339-341` — `rowHelper()` returns `t('Separate multiple names with "and"')` for `author`/`editor`, rendered as helper line under the field in the **shared entry form** (hence visible in both project edit and library edit). Related but separate: `reference/capture/field-map.json` `helperText` (capture UI). Reviewer's "stray" = the helper line rendered under Author/Editor in the edit form.

**ORCID source (old tree `../old-doi-orcid-picker`, commit `e3c75ff517d21048cf76e273c57c004d0c1de814`, "Initial files"):**
- `services/web/modules/orcid-picker/app/src/OrcidService.mjs` (285 lines): ORCID pub API (`https://pub.orcid.org/v3.0`), `isValidOrcid()` (regex, no Luhn), SSRF guard, 10 s timeout, 2 MB body cap; `searchAuthors(q)`, `fetchWorks(orcid)`, `fetchBibtexFromOrcid(...)`.
- `OrcidPickerRouter.mjs` (86 lines): `GET /orcid-picker/search?q=`, `GET /orcid-picker/works?orcid=` (+ bibtex route — verify exact path during port), all `AuthenticationController.requireLogin()` + `expressify`.
- `orcid-picker-modal.tsx` (583 lines): 2-step modal (search name/ORCID → works list with put-code checkboxes → import), `onInsert(bibtex)` callback; uses `@/shared/components/ol/*` (OLModal, OLButton, OLForm*, OLNotification) + `@/infrastructure/fetch-json` (`getJSON`) — **both exist in this tree** (`services/web/frontend/js/shared/components/ol/`, `.../infrastructure/fetch-json.ts`).
- Old registration: `sourceEditorToolbarEndButtons` + `moduleImportSequence` (`doi-picker`, `orcid-picker`) + `doi-picker` module (parallel DOI-search UI — **not needed here**: DOI import already exists client-side in bib-editor via `frontend/js/utils/doi-fetcher.ts`; do not port unless requested).

**Templates (point 3):**
- Module: `services/web/modules/template-gallery/` (gallery + template manage UI: `manage-template-modal/*`, `menubar-manage-template.tsx`, `template-gallery-context.tsx`).
- Categories today = **env**: `OVERLEAF_TEMPLATE_CATEGORIES=presentation thesis` + `TEMPLATE_<CAT>_NAME` / `TEMPLATE_<CAT>_DESCRIPTION` + `TEMPLATE_ALL_*` (live compose `/data_1/docker/compose_cep/overleafserver/compose.yaml:105-118`), consumed in `template-gallery/index.mjs:26` and injected into the page (`ol-templateCategory` meta; `template-gallery-root.tsx`).
- Gallery on: `OVERLEAF_TEMPLATE_GALLERY=true`; `OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES=false` (admin publish).

**"Out of sync" (point 4) — exact mechanism:**
- The toast/modal the reviewer hit is the **stock editor OT modal**: `services/web/frontend/js/features/ide-react/components/modals/out-of-sync-modal.tsx` (`t('out_of_sync')`), triggered by `closeConnection('out-of-sync')` in `editor-manager-context.tsx:570` — "displays when an op is rejected" (`share-js-history-ot-type.ts:82`), i.e. server/sharejs rejected the client's doc op (version mismatch) → local doc desynced from server.
- So the bug is: bib-editor write/re-sync path produced a client doc state the server rejected (or diverged), and separately the entry list showed a **client-side duplicate** (reviewer: after reload, only one entry remains → the file had one entry).

---

**Admin/feature env state (verified live + tree, 2026-08-28):**
- `ENABLED_LINKED_FILE_TYPES=project_file,project_output_file,url,zotero` (live) — Zotero + url linked-file features are **on live**.
- Zotero module (`services/web/modules/zotero`): router + linked-file agent + `Settings.zotero{clientKey,clientSecret,callbackURL}` are **boot-gated** on `zotero` in enabledLinkedFileTypes (`zotero/index.mjs:6,11-17`); OAuth credentials from `ZOTERO_CLIENT_KEY/SECRET` (set live). Token cipher: `app/src/AccessTokenEncryptorHelper.mjs` (env/file read; default file `/var/lib/overleaf/data/.token-cipher.json`, label `OL_CEP-v3`) — **`github-sync` reuses the same cipher pattern** (shared password ⇒ changing it re-connects BOTH integrations' tokens).
- `enabledLinkedFileTypes` is consumed **per request**: `Features.mjs:76-84`, `LinkedFilesController.mjs:177` (provider check) ⇒ runtime toggling feasible.
- url fetch path: `app/src/Features/LinkedFiles/{UrlAgent,LinkedFilesHandler,LinkedFilesController}.mjs` — **no SSRF blocklist/allowlist is consumed anywhere in this tree** (CE+ wiki's `OVERLEAF_LINKED_URL_BLOCKED_NETWORKS/ALLOWED_RESOURCES` are absent ⇒ must be implemented: §3d).
- Sign-up: `registration-page/index.mjs:6-19` is **boot-gated** (explicit env, else enabled when no ldap/saml/oidc — live has no SSO env ⇒ registration effectively on by default); domain allowlist consumed per-request `RegistrationPageController.mjs:20,64`; feature flag `Features.mjs:55`.

## 1. Goals & acceptance

1. **ORCID picker** available under `/library` → **+ Add → From ORCID.org** and `/project/[id]` → **+ Add → From ORCID.org**; UI matches current Overleaf design language; full audit of all ported code (ported code is suspect); no regressions in lint/tests/build.
2. **Stray string** gone on both surfaces (project entry edit + library entry edit) — root cause named, not just hidden.
3. **Templates**: "Save template" export bundle (zip: project.zip + pdf + template.json) **and** import to make exchange workable; categories stored in MongoDB (see recommendation §2.1).
4. **Out of sync / duplicate entry**: named root-cause mechanism at line level; fix verified with the reviewer's exact repro **in the deployed environment**.
5. **Admin console**: four admin-only "Manage X" pages — Manage Templates, Manage Zotero, Manage External URLs, Manage Sign Up Page — with live-editable settings persisted in MongoDB (env as seed); "Manage X" naming; admin-only access; secrets stored encrypted and masked in UI.

---

## 2. Open decisions & recommendations

### 2.1 Template categories in MongoDB — **ADOPTED (2026-08-28) with user-designed admin UI**
- **Design (user-specified)**: new **"Manage Templates" admin page** (alongside Manage Site/Users/Projects) with:
  - **On/Off switch** for the template gallery (`OVERLEAF_TEMPLATE_GALLERY`, now runtime-stored instead of boot-only).
  - **Table, one row per valid category key** (the 12 from the official manual: `academic-journal`, `book`, `presentation`, `poster`, `cv`, `homework`, `bibliography`, `calendar`, `formal-letter`, `report`, `thesis`, `newsletter` — plus `all`): **a)** category name, **b)** on/off checkbox per category, **c)** number of templates in that category, **d)** "Edit" button → modal to set **name + description** (what `TEMPLATE_<KEY>_NAME` / `TEMPLATE_<KEY>_DESCRIPTION` provided). `all` row: checkbox disabled (code always appends `all`), Edit available (manual has `TEMPLATE_ALL_NAME/DESCRIPTION`).
  - **Defaults = the manual's EXAMPLE block** (12 categories with official names + descriptions, e.g. `thesis` → "Theses" / "Templates for writing theses and dissertations, following institutional formatting and citation guidelines.") embedded as seed defaults in code.
- **Seeding rule**: upsert on boot only if the doc is missing — env wins if the values are set (current compose values preserved), else manual defaults; never overwrite an existing doc (env then only a seed source).
- **Key implementation fact (verified)**: today `template-gallery/index.mjs:13-46` is **boot-gated** — `OVERLEAF_TEMPLATE_GALLERY==='true'` decides whether the router even registers and builds `Settings.templateLinks` from env. The runtime switch therefore requires: register the router **unconditionally**; gate `/templates*` in middleware on the stored setting (404/redirect when off); account-menu "Templates" link and gallery category links must read the stored setting per request (`frontend/js/shared/components/navbar/account-menu-items.tsx` + `admin-menu.tsx` hold the Manage Site/Users/Projects links where "Manage Templates" will be added; `Settings.templateLinks` is built at boot today → must become per-request).

### 2.2 Bundle format — recommended: **zip** (tar = same, but zip is what users expect)
```
<slug>.oltemplate.zip
├─ template.json   { version: 1, name, description, category, tags[], license, language, publishedAt? }
├─ project.zip     (identical shape to the project download/export)
└─ output.pdf      (last successful compile; OPTIONAL on import)
```
- Import validates structure, creates the Template (existing Template model + `services/web/app/templates/` directory), admin-gated (consistent with `OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES=false`).

### 2.3 ORCID import semantics — recommend:
- `/library` → resolve ORCID works → import via the **library server import path** (same as Paste references; 409 duplicate handling already in `LibraryController.mjs`).
- `/project` → resolve ORCID works → import via the **in-project write path** (`planBibImport`/`importMany`) into the currently open `.bib` (needs a selected/first bib file if none is open → same behavior as Paste references).
- (Old build also had an editor toolbar button inserting BibTeX at cursor — NOT in the new requirements; skip unless you want it.)

### 2.4 Stray string — **CONFIRMED (2026-08-28): the stray string is exactly `Separate multiple names with "and"`.** Action: remove the `author`/`editor` helper line from the shared entry form on **both** surfaces; keep the rest (pages/doi/eprint help lines are intentional capture guidance).

---

- **Zotero off-toggle semantics**: existing Zotero linked files are not deleted; connector entry hidden + new zotero links rejected, existing ones show a "disabled by admin" state (documented in UI copy).

### 2.6 Admin console conventions — **ADOPTED (2026-08-28, user-directed)**
- **Naming + access**: pages follow the existing pattern (Manage Site / Manage Users / Manage Projects): **"Manage Templates", "Manage Zotero", "Manage External URLs", "Manage Sign Up Page"** — admin-only (requireAdmin guard + admin-menu visibility; not listed for normal users).
- **Storage**: one `SiteSettings` Mongo doc (key `global`) with per-feature sections (templates / zotero / externalUrl / signup); **stored doc wins over env** (admin intent persists across container cycles); env only seeds a missing doc (values set live today are preserved); per-section "reset to env/defaults" as optional action.
- **Secrets**: Zotero client secret + cipher password stored **encrypted** (reuse proven AES-256-GCM pattern from this fork; investigate cleanest helper), masked in UI, never returned in GET; page-level warning that the cipher is shared with `github-sync` and a password change forces reconnects.

## 3. Phases

### Phase 0 — Stray string (point 2) · ~0.5 day
1. Confirm on live (project + library entry edit): exact element/class where it renders; capture DOM/screenshot (evidence first).
2. Fix at `bib-entry-form.tsx` `rowHelper()` (drop author/editor case — or gate to the *new-entry* modal only if decision 2.4 changes); audit other `rowHelper` render sites; check `field-map.json` helperText is capture-only (not leaking).
3. i18n: remove now-unextracted key usage; `cd services/web && yarn extract-translations` (bundle is filtered by `extracted-translations.json` — keys must be regenerated or they render raw in-browser).
4. Add/adjust module unit test asserting the form's helper mapping.
5. Gates: scoped eslint `--max-warnings 0` → `make all` → cycle container → **verify on FQDN both surfaces** → commit + push (incremental).

### Phase 1 — "Out of sync" + duplicate entry (point 4) · 1–2 days
**Severity: highest (reviewer blocker). Do before Phase 2 — ORCID wiring depends on the same write path.**
1. **Repro on live with the reviewer's exact steps**: edit author → switch to main-text tab (editor area stays open) → back to bib tab → list → observe duplicate → try open entry → capture: modal text, raw `.bib` content, `web.log` (docker exec tail), network OT traffic. Determine: is the duplicate in the file (server) or only in the list (client)? (Reviewer says server has one → focus client model.)
2. **Root-cause hunt** (name the mechanism at a specific line before fixing):
   - `bib-editor-extension.ts`: write dispatch computed from a **stale snapshot** (plan clamped against an old `source`), 300 ms debounced re-parse emitting `entries` *after* a write with stale data, `written` reconciliation (`{id, mode, originalId}`) mis-handled.
   - `bib-editor-provider.tsx` / `bib-editor-context.tsx`: `setEditorState` list reconciliation — append-not-replace on `written.mode==='new'` when it was actually a replace (list keeps old + new → "both are new" if old was already re-serialized).
   - Double event subscription (effect double-registration) → duplicate state updates.
   - OT rejection path: which op was rejected (sharejs version / revision), why (stale base from a second overlapping write or a flush on tab switch) → `out_of_sync` modal.
   - Tab-switch lifecycle: what fires on hide/show (blur commit? pending flush?) with "26 s of unsaved changes".
3. **Fix design (expected shape, final call after step 2)**: list = *pure projection of the current CM doc* (no independent append/replace bookkeeping); single-flight serialized writes; compute the write plan from the **live** view state at dispatch time; on rejection → authoritative resync (re-read doc, re-parse, re-emit) instead of leaving a diverged local doc; dedupe guard on write plan (same key twice → explicit conflict instead of silent duplication).
4. **Tests**: vitest unit tests for `planBibWrite` stale-range/clamp cases + a regression test encoding the reviewer's sequence (edit → re-emit → open) — put the repro steps as a checklist in `services/web/modules/bib-editor/`.
5. Gates as in Phase 0; **done = reviewer repro passes on the deployed site** (list shows exactly one entry, no out-of-sync modal).

### Phase 2 — ORCID picker (point 1) · 2–3 days
**Port (selective — verify every wiring point against THIS architecture, drop dead code):**
- Port: `app/src/OrcidService.mjs`, `app/src/OrcidPickerRouter.mjs`, `index.mjs` (router module), `frontend/js/components/orcid-picker-modal.tsx`.
- Do **not** port: `doi-picker` (DOI import already exists client-side), `orcid-picker-toolbar-button.tsx` (new UX = Add-menu items, not editor toolbar buttons), old `settings.defaults` `sourceEditorToolbarEndButtons` hunk.
- **Full audit of every ported file** (ported code is suspect): imports resolve here (`AuthenticationController` path verified ✓ — re-check at build), hardcoded strings → `t()` + `extract-translations`, `fetch-json` `getJSON` semantics (known quirk: swallows `AbortError` — verify callsites have timeouts/cancellation that work), loading/error/empty states, accessibility (labels, focus management, `bubbles:true` for any CustomEvents), no `console.*` (use `debugConsole`), async handlers wrapped `expressify` (✓ in old code — re-verify), SSRF/timeout/size guards re-verified, ORCID validation (regex OK; Luhn = nice-to-have), React #137 quirk (no `<option>` children in `OLFormControl` selects if the modal has any), `node:` prefix on builtins.
- **Endpoints**: `GET /orcid-picker/search`, `GET /orcid-picker/works`, bibtex route — all `requireLogin`; add unit tests for `OrcidService` pure parts (`isValidOrcid`, author/works mapping, error normalization).
- **UI (current Overleaf style)**: restyle modal to match `bib-manual-modal.tsx` / `bib-import-modal.tsx` patterns (OLModal header/footer, OLButton variants, OLForm* + feedback, OLNotification, plural helpers, loading states); keep the 2-step search→works flow (it's good); verify the same visual system classes (`ol-modal`, `.form-control`, …) so it is indistinguishable from the existing modals.
- **Integration**:
  - `/library`: Add menu (in `library-page.tsx` flow) → new item `From ORCID.org` → modal → import into Library (server path, 409 dup handling).
  - `/project`: Add menu (`bib-entry-list.tsx` C5 area, next to Paste references / Enter manually / Import from Library) → new item `From ORCID.org` → modal → import into current `.bib` (guarded write path) — **depends on Phase 1 being green**.
  - `settings.defaults.js`: add `'orcid-picker'` to `moduleImportSequence`; consider feature flag `OVERLEAF_ORCID_PICKER` (default on, mirror `OVERLEAF_BIB_LIBRARY` pattern) — decide at implementation.
- **Gates**: eslint `--max-warnings 0` on touched scopes → module vitest → fresh-context reviewer pass (diff + behavior) → `make all` (server-ce of THIS checkout) → cycle container (image ID == built ID) → live smoke: search → works → import on **both** surfaces, duplicate-key case, error case (bad ORCID/orcid.org down) → commit + push.

### Phase 3 — Admin console ("Manage X") + template bundles (point 3, expanded 2026-08-28) · ~4–6 days
**3.0 — Shared admin foundation (~1 d, do first):**
1. `SiteSettings` doc (collection `site_settings`, key `global`): `{ templates: {galleryEnabled, categories:[{key,name,description,enabled,order}], nonAdminCanManage?, templatesUserId?}, zotero: {enabled, clientKey, clientSecretEnc, cipherMode:'file'|'password', cipherFile, cipherPasswordEnc?, cipherLabel}, externalUrl: {enabled, blockedNetworks:[cidr], allowedResourcesRegex}, signup: {enabledExplicit, allowedEmailDomains:[]}, seededFrom, updatedAt }` — sensitives encrypted.
2. Boot: seed doc from env if missing (`ENABLED_LINKED_FILE_TYPES`, `ZOTERO_CLIENT_*`, `OVERLEAF_TEMPLATE_CATEGORIES`/`TEMPLATE_*`, registration envs) + the manual's 12 category defaults (§2.1); stored doc wins thereafter; idempotent.
3. Per-request settings accessor (2 web workers ⇒ no process-local truth); de-boot-gate `template-gallery/index.mjs:13`, `zotero/index.mjs:6`, `registration-page/index.mjs:6-19` (preserve registration default rule: enabled when no ldap/saml/oidc, unless explicitly set).
4. Admin shell: `/admin/<section>` routes (guard per `AdminToolsRouter.mjs`), admin-menu items in `frontend/js/shared/components/navbar/admin-menu.tsx` / `account-menu-items.tsx` (alongside Manage Site/Users/Projects), shared scaffold (switch + table/list + Edit modal, i18n, DS-chrome rules from project memory).
5. Unit tests for accessor/seed/precedence + gates + live smoke of the shell.

**3a — Manage Templates (adopted §2.1 design):**
1. Gallery on/off switch (stored `templates.galleryEnabled`) — runtime: middleware gates `/templates*` (404/redirect when off), account-menu "Templates" link per-request, gallery nav renders only enabled categories.
2. Table, one row per valid key (the 12 from the manual: `academic-journal`, `book`, `presentation`, `poster`, `cv`, `homework`, `bibliography`, `calendar`, `formal-letter`, `report`, `thesis`, `newsletter`, plus `all`): **a)** category name, **b)** on/off checkbox per category, **c)** number of templates in that category, **d)** "Edit" button → OLModal to set **name + description** (what `TEMPLATE_<KEY>_NAME/_DESCRIPTION` provided). `all` row: checkbox disabled (always appended by design), Edit available.
3. **Defaults = the manual's EXAMPLE block** (12 categories with official names + descriptions) embedded as seed defaults; live `presentation`/`thesis` preserved via env seeding.
4. **Agreed (2026-08-28)**: publish-permission fields (`OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES`, `OVERLEAF_TEMPLATES_USER_ID`) in the same page (stored in `SiteSettings.templates`; UI: switch + user-id input).
5. **Investigation step first**: pin the Template data model + per-template `category` field (`app/src/Features/Templates/*` + `TemplateGalleryManager`; runtime `templates` dir; `ENABLE_CONVERSIONS=true` live) — needed for per-category counts and bundle category validation.
6. Gates + **verify on live**: gallery unchanged after deploy; disable a category via UI → gallery updates; toggle gallery off → `/templates` 404s + link hidden; turn back on; edits survive container restart (Mongo-backed).

**3b — Save/Import template bundle:**
1. Define bundle + version (per §2.2): `<slug>.oltemplate.zip` = `template.json` + `project.zip` + `output.pdf` (pdf optional on import); document in `services/web/modules/template-gallery/`.
2. **Export** ("Save template"): action in the template manage UI (`menubar-manage-template.tsx` / manage modal) → server endpoint assembles: project zip (existing project download/export path), last successful PDF (same source the template preview pulls), `template.json` from Template fields (category validated against stored categories) → downloadable zip (stream; don't spool large files in memory).
3. **Import**: admin-only upload endpoint → validate (structure, size, magic bytes, no zip path traversal) → create Template + files under the runtime `templates` path → feedback + delete/revert.
4. Tests: zip pack/unpack + validation units; manual e2e (export → wipe → import → gallery shows it → new project from it).

**3c — Manage Zotero:**
1. Feature on/off (stored `zotero.enabled` ↔ `zotero` in enabledLinkedFileTypes; per-request providers check `LinkedFilesController.mjs:177` already supports this; boot agent registration stays when booted-on — off-toggle: hide connector, reject new links, existing show "disabled by admin" state, §2.6).
2. OAuth: client key + **secret (encrypted, masked)** — edit modal; read-only callback URL with copy (`${OVERLEAF_SITE_URL}/user/zotero/oauth/callback`); status line (registered? key set?).
3. Token cipher section: mode file (path, default `/var/lib/overleaf/data/.token-cipher.json`) OR explicit password (encrypted, masked) + label (default `OL_CEP-v3`); **warning UI: shared with `github-sync` — changing the password invalidates existing zotero+github tokens (reconnect required)**; status: cipher file exists? active label? (switch `AccessTokenEncryptorHelper.mjs` reads from the stored settings, env/file as seed).
4. **Investigation step**: verify `Settings.zotero.clientKey/Secret` consumers (`ZoteroOAuth.mjs`, `ZoteroApiClient.mjs`) receive per-request stored values; check `ZoteroRouter` boot behavior when toggled post-boot.
5. Gates + **verify on live**: with a test account — connect/disconnect zotero still works after secret edit; off-toggle hides the connector and blocks a new `zotero` link (404/403 from `LinkedFilesController`), no data loss of existing zotero links.

**3d — Manage External URLs (includes NEW SSRF protection — verified absent in tree):**
1. Feature on/off (stored `externalUrl.enabled` ↔ `url` in enabledLinkedFileTypes; affects "Add Files → from URL" + "Insert Figure → from URL").
2. **Implement** (not just manage): in the url fetch path (`app/src/Features/LinkedFiles/UrlAgent.mjs` / `LinkedFilesHandler.mjs` — locate exact fetch): block fixed private ranges (always): `127.0.0.0/8`, `169.254.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (DNS-resolve all A/AAAA incl. redirect target, reuse the SSRF-guard pattern from the orcid/doi picker code), plus admin **`blockedNetworks`** CIDR list and **`allowedResourcesRegex`** override (regex matches ⇒ allowed even if network blocked; regex syntax-validated in UI with test-URL feedback).
3. UI: switch + blocked-networks list editor (CIDR validation, add/remove rows, show fixed ranges read-only) + allowed-resources regex field (validation + "test URL" check).
4. **Tests**: unit tests for the pure decide function (private range, extra CIDR, regex allow-deny cases); live: loopback/internal URL rejected, public URL works, regex allow case works.

**3e — Manage Sign Up Page:**
1. On/off with CE+ semantics preserved (`registration-page/index.mjs:6-19`): explicit true/false wins; unset → enabled only when no ldap/saml/oidc (live: no SSO ⇒ effectively ON — display the **effective** value + the default rule in the UI).
2. Allowed email domains editor (comma/space list, `*.` wildcard) + live sample check ("would `name@domain` be allowed?") against the stored list; enforced per-request in `RegistrationPageController.mjs` (already per-request ✓).
3. Gates + **verify on live**: toggle off → `/user/register` hidden/404 + signup link gone; domain list enforced (registration attempt with non-listed domain rejected, listed one accepted — test with a local test account).

**Ordering inside Phase 3:** 3.0 → 3a (templates page) → 3b (bundle) → 3c → 3d → 3e (each page after 3.0 is independent; 3d is the only one with new security code).

---

## 4. Cross-cutting rules (machine conventions — binding)
- Lint before build: `cd services/web && node ../node_modules/eslint/bin/eslint.js --max-warnings 0 <touched scopes>`; repo-local eslint binary.
- i18n: new `t()` keys → `yarn extract-translations` (bundle filtered by `extracted-translations.json`); `@overleaf/sorted-keys-in-locales` = alphabetical.
- Async routers: `expressify`; builtins `node:` prefix; `debugConsole` not `console`.
- Build: verify tree contains the changes → `cd server-ce && make all` from THIS checkout (harmless first-build registry-cache line); then cycle the shared `overleafserver` compose container per `rebuild-overleaf-docker-image` skill; image ID == built ID.
- Definition of done: lint 0 → tests green → reviewer pass → build → container healthy → startup log module init, no ERRORs → **live verification on `https://psintern.neuro.uni-bremen.de` (DOM-level, per affected surface)**.
- Commits: incremental at natural milestones, push to `origin` (`davrot/overleaf-cep`); PRs are the user's job.
- Evidence bar: every bug fix = named root-cause mechanism (file:line) before patching; "done" = verified in deployed env.
- Subagent use (if delegating): `overleaf-agent-workflows` skill — fresh-context reviewers, tool budgets, `subagent_wait`; architecture decisions stay in the parent session.

## 5. Sequencing & risk
| # | Phase | Est. | Risk | Note |
|---|-------|------|------|------|
| 0 | Stray string | 0.5 d | low | quick win, independent |
| 1 | Out-of-sync + dup | 1–2 d | **high** | reviewer blocker; blocks ORCID project import |
| 2 | ORCID picker | 2–3 d | medium | port + 2 integrations + restyle |
| 3.0 | Admin foundation (SiteSettings, shell, secrets) | ~1 d | medium | precedence + per-request plumbing, de-bootgates |
| 3a | Manage Templates page | 1–1.5 d | medium | de-boot-gate gallery, per-category counts |
| 3b | Template Save/Import bundle | 2–3 d | medium | zip streaming/limits, admin gating |
| 3c | Manage Zotero page | ~1 d | medium | secret encryption + cipher shared with github-sync |
| 3d | Manage External URLs (+ SSRF guard impl) | 1.5–2 d | **medium/high** | new guard in url fetch path |
| 3e | Manage Sign Up page | 0.5–1 d | low | default-logic parity (SSO rule) |

Total ≈ 2–3 weeks (incl. the expanded admin console). Phases 0 and 1 are sequential-quick; 2 and 3a could be parallelized with subagents after their respective decision points, but default = sequential (one writer per tree).

## 6. Decision log
- (done 2026-08-28) 2.1 categories in Mongo: **ADOPTED** — "Manage Templates" admin page per user design: gallery on/off switch, per-category on/off + name + template count + Edit modal (name/description); defaults from the manual's 12-category example.
- (done 2026-08-28) admin console scope (user-directed): **Manage Templates / Manage Zotero / Manage External URLs / Manage Sign Up Page** — "Manage X" naming, admin-only access; shared `SiteSettings` Mongo doc (stored wins over env, env = seed); secrets encrypted + masked; cipher shared with github-sync caveat. Phase 3 restructured (3.0/3a–3e).
- (agreed 2026-08-28) 2.2 bundle: zip; `output.pdf` optional on import.
- (agreed 2026-08-28) 2.3 ORCID import semantics: library → server import API (409 dup handling); project → append into current `.bib` via guarded write path; no editor toolbar button.
- (agreed 2026-08-28) 2.4 stray string confirmed = `Separate multiple names with "and"`; remove author/editor helper line on both surfaces; keep pages/doi/eprint helpers.
- (agreed 2026-08-28) 3a: publish-permission fields on Manage Templates (stored in `SiteSettings.templates`).
- (agreed 2026-08-28) 3c: secrets stored via fork's AES-256-GCM pattern, masked in UI. 3d: SSRF blocklist/allowlist implementation in scope (CE+ wiki features absent in tree).
- (security rule) Live test credentials (local test user) are used only at runtime for E2E verification — **never written into git/repo files** (incl. this plan).
