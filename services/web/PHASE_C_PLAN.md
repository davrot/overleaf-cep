# References module: implementation plan (reconciled to the overleaf.com reference)

**Status: SUPERSEDED-BY-THIS-PLAN → ACTIVE.** **Progress: C1 ✔ C2 ✔ C3 ✔ C5 ✔ C6 ✔ C7 ✔ C9 ✔ committed; C4 mostly done (D15 per-row search highlight done in b5e3ff208a; D9 Add modal + D11 error-tooltip click open, both deferred per plan).** Details below in §3. The Phase-B plan (2026-07-20) is a *redesign* plan built from reviewer notes. The overleaf.com reference (the four capture/asset files) is now the **authoritative source of truth** and where it disagrees with the Phase-B plan, **the reference wins** (per user instruction). This plan re-grounds every decision on what the reference actually ships, and the single deliberate deviation (an "Import from Library" add-item) is called out explicitly.

This is a plan, not code.

**Scope (unchanged):** the `services/web` bib-editor CEP `visual` provider and the `visual` provider registration. The editor stays `.bib`/BibTeX; we do not add LaTeX/Biber engines, a `.bibtex-log` language, or a log-pane view mode.

**Repo:** a fork of overleaf-cep (`davrot/bib-editor`). **Module:** `services/web/modules/bib-editor`. **Web root:** `services/web`. **Build (C8):** `make all` **build-only** (label==sha; no webpack ERROR); live matrix is not asserted. **ESLint:** scope `services/web/modules/bib-editor`, gate **0 errors** (`--max-warnings 0`).

**Live matrix:** DEFERRED/optional. No live container is available in this environment; `make all` build-only is the required gate and the live matrix is documented but not run.

**Committed & kept (Phase A–B, revertible individually):**
- `services/web/modules/bib-editor/frontend/js/utils/overleaf-type-map.ts` — 48 machine↔label + requiredFields + all/optionalFields (machine→human label map, `formatBibTypeLabel`, `getBibTypeDisplayFields`)
- `services/web/modules/bib-editor/frontend/js/utils/bibtex-schema.json` — `publicationTypes` (per-type required/optional/defaultOptional), `fieldLabels`, `optionalFieldsByGroup`
- `services/web/modules/bib-editor/frontend/js/utils/bib-types.ts` — `BibTypeSpec`, `getBibTypeDisplaySpec`
- `services/web/modules/bib-editor/frontend/js/utils/preview-model.ts` — `previewRow`/`previewBody`/`previewMissingGroups`
- `services/web/modules/bib-editor/frontend/js/utils/bib-write.ts` — `applyBibSourceEdit` (C3)
- `services/web/modules/bib-editor/frontend/js/utils/doi-fetcher.ts` — `fetchBibFromDoi` (C4)
- W5 `importEntry` flow; `bib-editor-context.tsx` (C1b–C4); extension `BIB_VISUAL_DELETE_EVENT` (C2b), `BIB_IMPORT_EVENT`, `BIB_RESOLVE_DOI_REQUEST/RESPONSE`, `BIB_VISUAL_WRITE_REQUEST/RESPONSE`.
- C1: `bibtex-schema.json` re-derived (D1/D2/D3, commit 28bb2e225f) ✔
- C2: extension `destroy()` listener duplication fixed ✔
- C3: `planBibWrite` anchor semantics (`originalId ?? entry.id`, NOT_A_BIB_REASON) ✔
- C5 WIP: Add dropdown + paste-references import flow (commit 9a4275d3c1) ✔
- C9: Add menu `Paste references` → `Enter manually` → disabled `Import from Library` (9a4275d3c1) ✔

**Kept, NOT reverted:** the Add-menu item **Import from Library** (C9, user-added) despite being absent from the reference — this is the one deliberate deviation (§C9).

---

## The new authority
- **Reference capture (authoritative, wins over this plan's earlier claims and over the Phase-B plan):** `/home/davrot/bib_notes.txt`, `/home/davrot/bibtypes_notes.txt`, `/home/davrot/bib_style.html`, and the live session captured under `/home/davrot/ref_bib/` (`1..4.html`, `1_files/`, `2_files/`, `3_files/`, `4_files/`). The machine-readable reference is the deployed bundle `ref_bib/1_files/library-*.js` (the `bibtex` module: type map, field map, taxonomy, `BibEntry` model, import/preview/resolve components) plus `ref_bib/2_files/9324-*.css` (the `bibtex-*` class spec). These are *our* reference, not a different product.
- **What the reference is:** the live overleaf.com IDE `.bib` visual editor (BibTeX), same module we shipped (Phase A–B). It is the target we must match.

**Precedence (final):**
1. Reference capture (overleaf.com IDE) — highest.
2. `REDESIGN_PLAN` — only where the reference is silent.
3. Committed Phase A–B data layer (W1–W3, `overleaf-type-map.ts`, `bibtex-schema.json`, `bib-types.ts`).
4. Phase-B plan review notes (2026-07-20) — *only* where the reference is silent; superseded wherever it conflicts.

**What stays unchanged (verified present in the reference and we build it):** W1–W3 data layer (`overleaf-type-map.ts`, `bibtex-schema.json` — *data shape corrected below*; `bib-types.ts`), W5 `importEntry`, extension C1b/C2b/C4 (`BIB_RESOLVE_DOI_REQUEST/RESPONSE`), the 48-type + taxonomy coverage, the C3 bulk-delete + `applyBibSourceEdit`, the C5 `importMany`/Paste flow, and the C9 `Import from Library` stub (our addition).

---

## 0. Decisive deltas (reference vs our current code)
Verified by diffing the reference bundle against this repo. Every "fix" in §C1–§C10 below is a direct consequence of these deltas:

| # | Aspect | Reference (authoritative) | Our current (Phase B) | Action |
|---|---|---|---|---|
| D1 | **requiredFields** | **OR-aliases** as arrays: `[year\|date]`, `[journal\|journaltitle]`, `[doi\|eprint\|url]`, `[author\|editor]`, `[school\|institution]`; ~half the "generic" types have **no** required fields (misc, artwork, audio, commentary, image, jurisdiction, legal, legislation, letter, movie, music, performance, software…); booklet/manual = `title` only | 45/48 types **differ**; we use bare `year` + `journal` + over-stated requireds (e.g. software=`author,title,year`, misc=`author,editor,title,year`) | **Re-derive `requiredFields` from the reference** (`§C1`): 45 spec diffs |
| D2 | **optionalFields** | *Minimal* typed lists (article ≈ 25: author/editor/title… `journaltitle`, `journaltitleaddon`, `journal`, `journalsubtitle`, `issuetitleaddon`, …) — *not* the full 74-field catalogue | ~74 fields per type (the whole catalogue is optional) | **Re-derive `optionalFields` + `defaultOptionalFields` from the reference** (`§C1`) |
| D3 | **optional-field taxonomy groups** | 8 groups / 64 items; *Periodicals and journals* includes `journaltitle` (7) | Our `OPTIONAL_FIELD_TAXONOMY` is 8 groups / **63** items; *Periodicals and journals* has 6 (**no `journaltitle`**) — all 7 other groups already match verbatim | Add `journaltitle` to the *Periodicals and journals* group (D3). 7/7 other groups already match. |
| D4 | **preview panel** | ...slide-out... | flex `split`... | **Preview = fixed 30rem slide-out; list `margin-right`** (CSS-only, §C7) — DONE (C7) |
| D5 | **entry list** | **virtualized** (react-window): absolutely-positioned rows `translateY(start−overscan)`, `overflow:hidden scroll`; row props `searchTerms, compileErrors, hasDuplicateKey, checked, …` | Committed HEAD C3: virtualized (custom visible-window) absolutely-positioned `bibtex-entry-card-row` with `data-index` + error icon + per-row card (not `<table>`). *Missing*: `searchTerms` highlight per row, `hasDuplicateKey`, `showErrorTooltip` | Add per-row `searchTerms` + error tooltip (§C4) |
| D6 | **Add menu items** | `Paste references` → `Enter manually` (reference has no Upload in this capture) | Committed HEAD: separate nav button "Add new entry" + C5 Add dropdown (Paste references / Enter manually / Import from Library stub) | Wire C5 Add dropdown (in progress this phase) + keep the reference `Paste references` → `Enter manually` order (§C5, §C9) |
| D7 | **Add / search layout** | `.bibtex-entry-list-panel` = search form-control-wrapper (leading icon) width **320px** + Add button (`margin-left:auto`); search + Add in the *same* row | Committed HEAD (C5 WIP): search + Add dropdown **in the same row** (`bibtex-entry-list-toolbar`) — matches the reference layout | (no change) |
| D8 | **preview card** | header (prev/next chevrons + close) → summary (key chip + title + `author · year` meta) → **kebab** [Download / Delete] → **Details / Abstract tabs** → inline form | Committed HEAD C4 **already has** all of it (header nav, summary, kebab Download/Delete, Details/Abstract tabs, inplace form) — *matches D8* | (no change) |
| D9 | **form** | **modal** for Add (type selector button + "Select a type to see the required fields." helper + **Cancel**/**Save**) | Committed HEAD: form is a full-view *inline* (`selection.kind==='new'` — the split view); C4 preview form is inplace. The reference **Add modal** is not built in our C2 | Defer (out of scope for this sync; §C9 keeps the C9 stub) |
| D10 | **import preview** | ...no_references empty | ...footer warning + no_references empty | Add the missing `bibtex-import-preview-footer-warning` row — DONE (C5: footer-warning + `-empty` + already-in-library tag) |
| D11 | **error affordance** | `.bibtex-entry-error-icon` + `.bibtex-tooltip-errors` (click → error tooltip/blockquote) | Committed HEAD C3: row error **icon is present**; the **tooltip** (`.bibtex-tooltip-errors`, lists errors) is not yet | `.bibtex-tooltip-errors` CSS DONE (C7); row click wiring still open (§C4 — D11 remains OPEN) |
| D12 | **author humanize** | von/first/last parsing; 1 = "First Last"; 2 = "A and B"; ≥3 or et-al = "Last et al."; import heading shows "Last (year)" or "(no author)" / "(no year)" / "(no title)" | Committed HEAD C3/C4: `citationAttribution` is "Last et al." (no year) | Use "Last (year)" in preview meta + import heading (§C4) |
| D13 | **i18n keys** | `paste_references`, `upload_bib_file`, `enter_manually`, `select_entry_type`, `required_fields_missing`, `no_references`, `no_references_found_in_this_file`, `select_all`, `some_dois_could_not_be_resolved`, `already_in_your_library`, `previous_reference`, `next_reference`, `actions`, `delete_permanently`, `restore`, `reference_count` (plural), etc. | **Note:** we key by English **strings** (not snake_case). The reference strings we need are already in `en.json` (`Paste references`, `Enter manually`, `Previous reference`, `Next reference`, `Select all entries`, `Required fields missing`, etc.). `Import from Library` **is** missing (ours, §C9). | Add `Import from Library` + `Import` (already present) keys to both locales (§C6) |
| D14 | **CSS** | 121 `bibtex-*` rules incl. card, error-icon, tooltip, preview tabs/summary/actions, import cards, `:root`/`[data-theme]` custom properties, `bibtex-toolbar` (32px, `inset 0`), `bibtex-entry-list-panel` (320px search) | Committed HEAD C3/C4 CSS: card, error-icon, preview tabs/summary/actions all present. Missing: the fixed 30rem slide-out geometry, `bibtex-import-preview-footer-warning`, `bibtex-tooltip-errors`, `:has(...)` list shift, `--bibtex-already-in-library-*` | Add the reference geometry + the two missing component blocks (§C7) |
| D15 | **search scope** | `searchTerm` passed to every row (`searchTerms` prop) → highlight matches + filter; `no_entries_matching` when filtered empty | Committed HEAD C3: filter-only (no per-row highlight) | Add per-row highlight (§C4) — DONE (b5e3ff208a: `matchesSearch`/`splitHighlighted` + `<mark>` per row) |

Every §C section below is a re-statement of one of these deltas; nothing is invented. Phase-B "gotchas" that the reference does not support (e.g. "C1 is correct on substance") are discarded in favor of the reference.

---

## 1. Authoritative reference inventory (what the capture actually contains)
The machine-readable artifacts extracted from the reference bundle (the implementer's copy-from source) are persisted at
**`services/web/modules/bib-editor/reference/capture/`** (committed), so the plan is self-contained:
- `overleaf-48.json` — 48-type `req`/`opt` (per-type **required** and **default-optional** field arrays); OR-groups appear as `"[year,date]"` tokens.
- `field-map.json` — 74 field `label`/`helperText` entries (the reference's field map; contributor name-fields use the `Separate multiple names with "and"` helper).
- `taxonomy-windows.txt` — the 8-group optional-field taxonomy, verbatim from the bundle.
- `bibtex-css.txt` — all 121 `bibtex-*` CSS rules (the class spec, §1.4).
- `all48.json`/`required.json` (derived) — kept as intermediate artifacts of the same extraction.

### 1.1 Field map (74 entries) — author source: `reference/capture/field-map.json`
The reference field map is a 74-entry `{key: {label, helperText}}` object. **Copy it verbatim** from `reference/capture/field-map.json` (earlier draft lists in this plan were mis-extracted; the JSON file is the source). Verified facts:
- **12 contributor name-fields** (helperText: `Separate multiple names with "and"`): `author, editor, editora, editorb, editorc, translator, annotator, commentator, introduction, foreword, afterword, bookauthor`. (No `authora`/`authorb`/`arxiv`/`archiveprefix`/`editiontype`/`journalvolume` exist in the map.)
- Two **distinct** fields: `journal` (label "Journal") and `journaltitle` (label "Journal title").
- `number` = **"Number"** (not "Volume"); `volume` = "Volume"; `urldate` = "URL date"; `school` = "School"; `institution` = "Institution".
- 36 of the 74 entries have empty helperText.
- This map feeds `bibtex-schema.json.fieldLabels`. It is *separate* from the per-type `requiredFields` OR-groups (that is §1.2/C1) and from the 8-group taxonomy (also §1.2/C1).

### 1.2 Optional-field taxonomy — 8 groups / 64 items (reference)
The reference's 8 groups (verbatim, extracted from `reference/capture/taxonomy-windows.txt`). The only item we currently miss is `journaltitle` in *Periodicals and journals*:

| Group | Fields |
|---|---|
| Common (7) | `abstract`, `subtitle`, `titleaddon`, `language`, `note`, `addendum`, `pubstate` |
| Contributors (12) | `editor`, `editora`, `editorb`, `editorc`, `translator`, `annotator`, `commentator`, `introduction`, `foreword`, `afterword`, `bookauthor`, `holder` |
| Books and volumes (14) | `maintitle`, `mainsubtitle`, `maintitleaddon`, `booktitle`, `booksubtitle`, `booktitleaddon`, `volume`, `volumes`, `part`, `edition`, `chapter`, `pages`, `pagetotal`, `eid` |
| **Periodicals and journals (7)** | `journaltitle` ← we have 6 (no `journaltitle`), `journalsubtitle`, `journaltitleaddon`, `issuetitle`, `issuesubtitle`, `issuetitleaddon`, `issue` |
| Events and conferences (4) | `eventtitle`, `eventtitleaddon`, `eventdate`, `venue` |
| Publication details (13) | `publisher`, `location`, `organization`, `institution`, `series`, `number`, `type`, `version`, `month`, `isbn`, `issn`, `isrn`, `howpublished` |
| Digital and online (6) | `doi`, `eprint`, `eprintclass`, `eprinttype`, `url`, `urldate` |
| Language and origin (1) | `origlanguage` |

**Total = 64** (ours: 63 — add `journaltitle` to Periodicals). Do *not* re-derive group boundaries; the other 7 groups already match the reference verbatim.

### 1.3 Preview card humanization (D8/D12)
- Row / preview summary heading: `author (year)` → `Last (year)`, no year → `Last (no year)`, no author → `(no author)`; title line is the `title` field or `(no title)`.
- Author summarize algorithm (from the reference `Name` class): split on `\s+and\s+` (case-insensitive); `hasOthers` if trailing token is "others"; von/first/last; summary joins `von last` tokens: 1 = "Last", 2 = "A & B" (the *list* uses ` & `), ≥3 or hasOthers = "First et al." (import heading shows "First (year)").
- Preview summary meta: `<span>{authorSummary}</span> <span>{year}</span>` (both optional; hide if absent).
- Preview summary key chip (mono) + title (semibold) in `.bibtex-entry-preview-summary-content`; meta on the right of `.bibtex-entry-preview-summary`.

### 1.4 Reference CSS inventory (121 `bibtex-*` rules) — key anchors
- `.bibtex-visual-editor{position:absolute;inset:0;flex column;font-size:14px;background var(--bg-primary)}`
- `.bibtex-toolbar{height:32px;box-shadow inset;padding:0 5px}`
- `.bibtex-entry-list-panel{flex;gap 8px;padding:8px 8px 10px}` (search + Add row)
- `.bibtex-search{width:320px}`
- `.bibtex-bulk-actions-bar` sticky `top:0; z-index:3` (selected vs unselected bg)
- `.bibtex-entry-card-row` absolute; `.bibtex-entry-card` (border, radius-m, hover/selected/previewing, `:before` 6px previewing accent bar)
- `.bibtex-entry-card-key` (mono chip), `-author/-year/-title/-updated-at`, `-meta`, `-checkbox`
- `.bibtex-entry-error-icon{color:var(--red-50)}`, `.bibtex-entry-error-icon-static`, `.bibtex-tooltip-errors{column;ul/blockquote}`
- `.bibtex-entry-preview-panel{position:fixed;right:0;width:30rem;transform:translateX(100%);transition .3s;z-index:20}` + `-open{transform:none}` + `-contained{position:absolute}` + `-overlay{inset:20% 0 0;transform:translateY(100%)}` (mobile)
- `.bibtex-list-and-preview{flex column;position:relative}` ; `:has(-panel-contained.open){.bibtex-entry-list{margin-right:30rem;transition .3s}}`
- `.bibtex-entry-preview-header(-nav)` ; `.bibtex-entry-preview-summary(-content|-key|-title|-meta|-actions)` ; `.bibtex-entry-preview-tabs(-tab|-tab-active)` ; `.bibtex-entry-preview-body(-abstract)`
- `.bibtex-import-preview-card(-check|-content|-key|-details|-heading|-field|-tags)` ; `.bibtex-import-preview(-empty|-header|-count|-list|-check-all|-footer|-footer-buttons|-footer-count|-footer-warning|-footer-actions)` ; `.bibtex-import-textarea{font-family:DM Mono}`
- `:root{--bibtex-card-hover-bg:var(--neutral-85); ...}` + `[data-theme=light]{...}` + `[data-theme=default]{--bibtex-already-in-library-color:var(--yellow-20);...}` custom properties.
*(Full spec verbatim in `reference/capture/bibtex-css.txt`; source: `/home/davrot/ref_bib/2_files/9324-*.css`.)*

---

## 2. Synced i18n (from the reference) — DONE (`en.json` + `extracted-translations.json` in sync) — sv.json doesn't matter
Add (additive; do not translate — copy reference strings): `paste_references`, `upload_bib_file`, `enter_manually`, `select_entry_type`, `required_fields_missing`, `no_references`, `no_references_found_in_this_file`, `select_all`, `select_all_entries`, `some_dois_could_not_be_resolved`, `already_in_your_library`, `previous_reference`, `next_reference`, `actions`, `delete_permanently`, `restore`, `reference_count` (plural: `{count} reference|{count} references`), `filter` (search placeholder), `error`/`errors`. **Keep** ours only: `import_from_library` (D6 deviation) and existing `could_not_import`, `paste`, `preview`, `no_entries_matching` (reconcile phrasing with the reference where the reference has the same intent). Do not add the reference's internal `no_year`/`no_title`/`no_author` (those are code-side fallback strings, not i18n). (`§C6`) — status: DONE. All in-use English strings (incl. `Import from Library`, import-preview, preview-nav) are present in `services/web/locales/en.json` + `services/web/frontend/extracted-translations.json` (verified by the module i18n sanity test). (sv.json is not a concern.)

---

## 3. Per-change tasks
Each change is individually revertible and gated: ESLint 0 errors (scope `modules/bib-editor`), module `yarn vitest` green, `make all` build-only green.

### C1 (fix data layer) — re-derive the data (was "already correct", now the main task) — DONE (28bb2e225f)
- **Input (durable, in-repo):** `reference/capture/overleaf-48.json` (48-type `req`/`opt`, machine-extracted from the reference bundle; OR-groups appear as `"\[year,date\]"` tokens), `reference/capture/field-map.json` (the 74 field `label`/`helperText` entries — copy verbatim), `reference/capture/taxonomy-windows.txt` (verbatim 8-group list for `journaltitle` placement). Source of truth: `/home/davrot/ref_bib/1_files/library-*.js`.
- **Data-only rewrite of `bibtex-schema.json`** (no engine/parse changes), for each of the 48 types:
  1. `requiredFields` = reference `req` with `"[a,b]"` tokens converted to `["a","b"]` OR-group arrays (our `BibTypeSpec` already handles `string | string[]` and `bib-validate.ts` already implements OR semantics). Spot checks to assert: `article.req = [author, title, [journal|journaltitle], [year|date]]`; `book.req = [[author|editor], title, [year|date]]`; `software.req = []` (note: reference requires **nothing** for software); `misc.req = []`; `booklet.req = [title]`; `inreference.req = [author, title, editor, booktitle, [year|date]]`.
  2. `defaultOptionalFields` = reference per-type `opt` array (this is what drives the kind-new form: per `bib-types.ts`, the form shows `required + defaultOptionalFields` only). The union across all 48 `opt` arrays is 34 distinct fields — do **not** use the full ~145-field catalogue here.
  3. `optionalFields` (full citation-js catalogue; feeds `getFieldsForType` + the dynamic Add-field combobox) stays as today. This is *not* the reference form model; it only feeds the Add-field combobox.
- **`overleaf-type-map.ts`:** `OPTIONAL_FIELD_TAXONOMY` gains `journaltitle` in *Periodicals and journals* (D3; 63 → 64). 7 groups already match — do not re-derive.
- **`bibtex-schema.json.fieldLabels`:** sync from `reference/capture/field-map.json` (74 entries; 12 contributor name-fields with the `Separate multiple names with "and"` helper — verbatim).
- **Tests:** `test/unit/src/overleaf-type-map.test.mjs` — assert per-type `requiredFields` OR-group shape (all 48 types vs `reference/capture/overleaf-48.json`, not just spot cases); assert `defaultOptionalFields` == reference `opt`; assert taxonomy has 64 items incl. `journaltitle` in Periodicals. `make all` green.
- *Replaces* the Phase-B claim "C1 is correct on substance; C3 is wrong on shape" (reversed: the reference is the source of truth).

### C2 (keep bulk delete + `applyBibSourceEdit`; fix the extension listener bug) — DONE
- Keep `BIB_VISUAL_DELETE_EVENT` / `BIB_IMPORT_EVENT` handlers (reference has bulk-delete via `bibtex-bulk-actions-bar`).
- **Fix** `destroy()` double-removal of `BIB_DELETE_EVENT` (delete the first, stale line) — reference does not depend on the bug.
- `make all` green.

### C3 (keep `applyBibSourceEdit`; align the `existing` anchor to the reference id semantics) — DONE
- Keep `mode:'new'` append. For `mode:'existing'`, the reference resolves by the **display `key`** (the mono chip) and accepts `id` when present (Phase A–B `bibtex-schema` uses `key`/`id` — keep both, matching the capture's "Key" chip).
- `NOT_A_BIB_REASON` guard unchanged.
- `make all` green.

### C4 (fix structure: preview slide-out + virtualized list + search/Add row + form modal + error icon + humanize + download) — DONE (except D9 modal + D11 click wiring, both deferred)
Status (as of plan annotation): preview card structure (D8: header/summary/kebab/tabs/inplace form) DONE in C4 commit; preview slide-out geometry (D4: fixed 30rem slide-out + `:has` list shift) DONE via C7; row error icon DONE (D11 icon) and `.bibtex-tooltip-errors` CSS DONE (C7); humanize (D12/D13) DONE for the import heading ("Last (year)" via `humanizeCitationHeading`) and for the preview meta ("Last et al." + separate `<span>{year}</span>`); D15 per-row `searchTerms` highlight DONE (b5e3ff208a: `matchesSearch`/`splitHighlighted` pure utils + `<mark>` in the row key/details). OPEN (deferred): (a) the D9 Add modal (Save-gate, type-selector helper) per D9 row — open inline until then; (b) D11 row error-tooltip *click* wiring (CSS is in) — the icon itself is a persistent aria-labeled affordance, tooltip blockquote is styled but not yet click-attached.
- **Preview (D4/D8/D13/D14):** replace the flex `split` with the reference `contained` panel: `.bibtex-entry-preview-panel-contained{position:absolute;width:30rem}` slides in; list `.bibtex-entry-list{margin-right:30rem;transition:.3s}` via `:has(...)`. Header (prev/next chevrons + close), summary (key chip + title + author/year meta), **kebab** [Download / Delete], Details/**Abstract** tabs, inline `BibEditorForm` (`autoSaveOnBlur`). Add `Download` (export entry `@type{key,...}` as `.bib`), `Prev/Next reference`.
- **List (D5/D7/D15):** virtualized rows (react-window or an equivalent scroll container) rendered as `.bibtex-entry-card` (not `<table>`); row props per §1.4 (`compileErrors`, `hasDuplicateKey`, `onEdit`, `onDelete`, `isPreviewing`, `showUpdatedAt`, `showErrorTooltip`); search row merged with Add into `.bibtex-entry-list-panel` (search width 320, leading icon); search is filter **+** highlight (`searchTerms` per row) and shows `no_entries_matching` when filtered empty.
- **Form (D9):** Add → modal (`modal` + fixed panel / offcanvas) with type-selector button + "Select a type to see the required fields." helper + **Cancel**/**Save** (Save disabled until type selected); remove the old full-view inline `selection.kind==='new'` host in favor of the modal (keep the split preview for existing entries).
- **Error icon (D11):** row `.bibtex-entry-error-icon` + `.bibtex-tooltip-errors` (lists compile errors for that entry).
- **Humanize (D12/D13):** `preview-model.ts` gains `authorSummary` (von/first/last + ` & ` / `et al.` rules) + year, used by row meta, preview meta, and import heading (`"Last (year)"`, `(no author)`, `(no year)`, `(no title)`).
- `make all` green; add `preview-model` author-summary unit tests.

### C5 (extend import preview to the reference card layout) — DONE
- Keep `importMany`/`PlanBibImport` (all-or-nothing, key-conflict reject, DOI resolve, error reasons) — reference-compatible.
- **Render** the preview as `bibtex-import-preview-card` rows (checkbox + key chip + `author (year)` heading + title + `already_in_your_library` **tag** when a key already exists) + `bibtex-import-preview-header` select-all + count + `bibtex-import-preview-footer-warning` + `no_references` empty. Keep ours: `some_dois_could_not_be_resolved` (matches reference), `Could not import this reference` (ours).
- `make all` green.

### C6 (i18n) — DONE (en.json + extracted-translations.json; sv.json not a concern)
- Add the reference keys (§2) to both locales + `extracted-translations.json` (additive). Keep `import_from_library`. Run the extraction script if present (do NOT hand-run `yarn i18n-extract` per the repo convention).

### C7 (CSS) — DONE (C7 css pass, see git log at the bottom): fixed 30rem slide-out preview + `:has` list shift (D4), `bibtex-tooltip-errors`, `bibtex-import-preview-*` cards + `bibtex-import-preview-footer-warning` + `-empty` + already-in-library tag, 320px search + Add toolbar (D7), `--bibtex-*` theme custom properties (`:root`/`[data-theme='light']`, incl. `--bibtex-already-in-library-*`)
- Replace `bib-editor-panel.css` with the reference `bibtex-*` spec (§1.4). Remove the flex `split` rules (no longer used) and add: card, row (absolute, `translateY`), error-icon, `bibtex-tooltip-errors`, preview `contained/overlay` + `-header/-summary/-tabs/-body`, import-preview cards + footer-warning, `bibtex-toolbar` (32px inset), `bibtex-entry-list-panel` (search 320 + Add), bulk bar, custom properties (`:root`/`[data-theme]`/`[data-theme=default]`, incl. `--bibtex-already-in-library-*`).
- `make all` green.

### C8 (verification — gates, live matrix optional)
- ESLint `services/web/modules/bib-editor` → 0 errors (`--max-warnings 0`).
- `yarn vitest run` (module) green (data-layer, plan, import, doi-fetcher, preview-model, new taxonomy/required tests).
- `make all` **build-only green** (label==sha; no webpack ERROR) — required.
- [ ] **Live matrix: DEFERRED** (no container). Document the intended manual pass (visual editor open, preview slide-out, Add menu items incl. Import-from-Library, Import Paste flow, bulk-delete, form modal Save-gate, error tooltip) in the PR description; do not assert it ran.

### C9 (Add menu + the user-added Import-from-Library stub) — DONE (9a4275d3c1): menu order `Paste references` → `Enter manually` → disabled `Import from Library` (tooltip `Library import is not available in this build yet.`); Paste opens the C5 modal; Enter-manually currently opens the C2 full-view inline form (until the D9 modal lands per C4)
- Add menu = reference items in order: **`Paste references`** → (optional, hidden here) **`Upload BibTeX file`** → **`Enter manually`** (opens the form modal). **Then keep the user-added** disabled **`Import from Library`** tooltip `library_import_not_available` (or `import_from_library`) at the *bottom* — the single deliberate deviation (not in the reference).
- Paste opens the §C5 import modal; Enter-manually opens the §C4 form modal.
- `make all` green.

### Final commit order
Individual commits, each revertible: `C1 data re-derive (JSON + tests)` → `C2 extension listener fix` → `C3 anchor semantics (28bb2e225f…b839784630)` → `C4 structure (b839784630: panel/preview; b5e3ff208a: D15 search highlight)` → `C5 import preview (9a4275d3c1: modal+WIP; 37ebd89686: cards/footer-warning/empty/already-in-library)` → `C6 i18n (24fe0212ca)` → `C7 css (2e1756ae40)` → `C9 add-menu + Import-from-Library stub (folded into 9a4275d3c1)`. Push after `make all` is green.

---

## 4. Verification (C8) — the gate
**Required (build-only):** `../../node_modules/.bin/eslint --no-cache --max-warnings 0` (scope `modules/bib-editor`) → 0 errors; `yarn vitest run` → green; `make all` → build-only green (label==HEAD sha; no webpack ERROR).
**Deferred (optional, documented):** full live `.bib` matrix (open visual editor, preview slide-out + `:has` list shift, Add menu `Paste references`/`Enter manually`/`Import from Library`, Import Paste preview cards + `already_in_your_library` tag + footer-warning, bulk-delete + `applyBibSourceEdit` append, form modal Save-gate, row error tooltip + `.bibtex-tooltip-errors`, DOI row statuses, search filter+highlight, prev/next reference, Download `.bib`). No assertion in CI since no container exists here.

---

## 5. Non-goals (unchanged)
LaTeX/Biber engines; `.bibtex-log` syntax/highlight; log-pane view toggle; `onBeforeFileSave` re-attach (re-attach **only** runs the existing `BIB_RESOLVE_DOI_REQUEST/RESPONSE` flow — it is **not** extended to an `onBeforeFileSave` hook); full DOI catalog; backend endpoints; a second module; touching `frontend/js/bib-editor-provider.ts` outside the existing provider registration.

---

## 6. Phase-B claims now superseded (for the record)
- ~~"C1 is correct on substance; C3 is wrong on shape"~~ → **False** (D1: 45/48 `requiredFields` differ; the reference is the source of truth).
- ~~"63 optional-fields, 7 groups; 7-item Common/Digital membership"~~ → **8 groups / 64 items** (D3: add `journaltitle` to *Periodicals and journals*; the other 7 groups already match verbatim).
- ~~"preview is a flex split"~~ → **fixed 30rem slide-out + `:has` list shift** (D4).
- ~~"add menu = Enter reference / Paste BibTeX or DOIs"~~ → **reference `Paste references` → `Enter manually` (+ our `Import from Library`)** (D6).
- ~~"Add button separate from search row"~~ → **search + Add in `.bibtex-entry-list-panel`** (D7).
- ~~"form is a full-view inline (selection 'new')"~~ → **modal + Save/Cancel** (D9).
- ~~"no row error icon"~~ → **`.bibtex-entry-error-icon` + `.bibtex-tooltip-errors`** (D11).
- ~~"no author humanize"~~ → **author/year summarize** (D12).
- ~~"no `already_in_your_library`"~~ → **import preview tag** (D10) — reference has it; we adopt it.
- ~~"no `some_dois_could_not_be_resolved` / `no_entries_matching`"~~ → reference *does* have `some_dois_could_not_be_resolved` (adopt) — keep `no_entries_matching` for the filtered-empty list.
