# Phase C — overleaf.com reference-editor parity (UI adoption)

**Status: plan (post-compact)**
**Supersedes:** the Phase B W4 card-selection UI (modifier-click card selection)
**and** REDESIGN_PLAN UI decisions where they conflict — the shipped overleaf.com
reference editor is the spec (user decision, 2026-08-22).
**Branch:** `bib-editor`. **Validation:** static + module vitest (no live container
on this machine; live matrix hands off).

## 1. Scope (user-confirmed)

1. **All 48 human type labels** are exposed in the Entry type selector, mapped to
   BibTeX/biblatex **machine** types. Machine types overleaf.com uses but our
   schema doesn't have (e.g. `dataset`, `audio`, `video`) are **added to
   `bibtex-schema.json`** so round-tripping (read → form → write) is exact
   for entries created by overleaf.com.
2. **Year and Date** are two separate form rows for every type (as captured in
   overleaf.com HTML). Write behavior: `year = ...` when the Year row is
   non-empty, `date = ...` when Date is non-empty; both read back into their
   respective rows. See open question OQ-2 for the both-filled case.
3. **Panel layout** is adopted: compact row list + per-row checkbox + select-all
   bulk bar ("N reference(s)") + prev/next chevrons + Close + Actions
   dropdown (Download, Delete) + Details/Abstract tabs + "Required fields
   missing" warning banner (list of missing required fields). Collapsible
   "Optional" section at the bottom of the Add/modify form.
4. The Add button is a **dropdown**: "Paste references (BibTeX, DOI)" and
   "… man… manually" (capture truncated — see OQ-3). Our module today
   auto-opens the Add reference modal; the modal itself already matches
   (title "Add reference", Cancel/Save).

## 2. Add reference modal — captured anatomy (spec)

From live overleaf.com DOM (capture, session 2026-08-22). Present for
**every** type; the only per-type variance is the main-field block.

- Header: "Add reference" + close.
- `Entry type` — selector button (`entry-type-selector-btn`), 48 labels (list
  below, §3). Default/initial: unselected; Save disabled until a type is
  chosen (observed on the empty modal).
- `Citation key` — text input, two helper lines:
  "Unique key for citations, no spaces or special characters" /
  "Auto-generated from the author and year, if left blank".
- Main-field block (§3 table): Author/Editor rows carry the helper
  "Separate multiple names with \"and\"".
- `Year` row (no helper). `Date` row follows immediately after, for **every**
  type (no per-type difference).
- Collapsed `Optional` section (aria-expanded=false, "Expand Optional"
  aria-label; caret icon). Contents + Add-field autocomplete in §5.
- Footer: Cancel / Save.

Form field labels captured and their write-mapping (label → schema field):
`Digital object identifier (DOI)` → `doi` (helper: "The identifier only, not
the full URL, e.g. 10.1000/xyz123"), `Eprint` → `eprint` (helper: "The
preprint archive identifier, e.g. math/0307200v3"), `Number` → `number`,
`Type` → `type`, `Note` → `note`.

### 3. The 48-type table (labels in selector order)

Machine types: **all 48 ✓-verified** from the user's exported `.bib` lines
(delivered 2026-08-22: first set + second set + `mvreference`).
Main fields listed after the citation key, before Year/Date (abridged:
auth.=author, ed.=editor, book=Book title, jtitle=Journal title,
inst.=Institution; DOI=Eprint helpers §2).

| Human label | Machine | Main fields |
|---|---|---|
| Article | `article` ✓ | auth., ed., title, journal, jtitle |
| Artwork | `artwork` ✓ | auth., ed., title |
| Audio | `audio` ✓ | auth., ed., title |
| Book | `book` ✓ | auth., ed., title, publisher |
| Book in book | `bookinbook` ✓ | auth., ed., title, book, chapter, pages (helper "Page range"), publisher |
| Booklet | `booklet` ✓ | auth., ed., title |
| Commentary | `commentary` ✓ | auth., ed., title |
| Conference | `conference` ✓ | auth., title, book |
| Collection | `collection` ✓ | ed., title |
| Dataset | `dataset` ✓ | auth., ed., title |
| Electronic resource | `electronic` ✓ | auth., ed., title, DOI, Eprint, URL |
| Image | `image` ✓ | auth., ed., title |
| In proceedings | `inproceedings` ✓ | auth., title, book |
| In book | `inbook` ✓ | auth., ed., title, book, chapter, pages ("Page range"), publisher |
| In collection | `incollection` ✓ | auth., title, book, publisher |
| In reference | `inreference` ✓ | auth., ed., title, book |
| Jurisdiction | `jurisdiction` ✓ | auth., ed., title |
| Manual | `manual` ✓ | auth., ed., title |
| Master's thesis | `mastersthesis` ✓ | auth., title, inst., school |
| Miscellaneous | `misc` ✓ | auth., ed., title |
| Movie | `movie` ✓ | auth., ed., title |
| Music | `music` ✓ | auth., ed., title |
| Multi-volume book | `mvbook` ✓ | auth., title |
| Multi-volume collection | `mvcollection` ✓ | ed., title |
| Multi-volume proceedings | `mvproceedings` ✓ | title |
| Multi-volume reference | `mvreference` ✓ | ed., title |
| Legal | `legal` ✓ | auth., ed., title |
| Legislation | `legislation` ✓ | auth., ed., title |
| Letter | `letter` ✓ | auth., ed., title |
| Online resource | `online` ✓ | auth., ed., title, DOI, Eprint, URL |
| Patent | `patent` ✓ | auth., title, number |
| Performance | `performance` ✓ | auth., ed., title |
| Periodical | `periodical` ✓ | ed., title |
| PhD thesis | `phdthesis` ✓ | auth., title, inst., school |
| Proceedings | `proceedings` ✓ | title |
| Reference | `reference` ✓ | ed., title |
| Report | `report` ✓ | auth., title, type, inst. |
| Review | `review` ✓ | auth., ed., title |
| Software | `software` ✓ | auth., ed., title |
| Standard | `standard` ✓ | auth., ed., title |
| Supplemental material in book | `suppbook` ✓ | auth., ed., title, book, chapter, pages, publisher |
| Supplemental material in collection | `suppcollection` ✓ | auth., ed., title, book |
| Supplemental material in periodical | `suppperiodical` ✓ | auth., title, jtitle |
| Tech report | `techreport` ✓ | auth., title, inst. |
| Thesis | `thesis` ✓ | auth., title, type, inst. |
| Unpublished | `unpublished` ✓ | auth., title, **note** (extra main field) |
| Video | `video` ✓ | auth., ed., title |
| WWW | `www` ✓ | auth., ed., title, DOI, Eprint, URL |

First-set export (21 `@type{...}` lines) + second set (11) + `mvreference` =
**48/48 machine names explicitly verified ✓** (delivered: session 2026-08-22;
no deviations — every name is a standard biblatex form: `electronic`,
`bookinbook`, `suppbook/collection/periodical`, `thesis`, `mvreference`,
`www`, `inreference`, `jurisdiction`).

Notes:
- `Article` shows BOTH `journal` and `journaltitle` rows (two distinct
  fields: `journal` and `journaltitle` in our schema? — see OQ-4; likely
  they map author/editor/title/`journal`/`journaltitle`).
- Per-type Year/Date rows are identical everywhere → implemented once.
- "Unpublished" is the only type with a main-field beyond the common set and
  no publisher/venue (`note`).

### 4. Entry type selector list (48 labels, exact strings)

Article, Artwork, Audio, Book, Book in book, Booklet, Commentary, Conference,
Collection, Dataset, Electronic resource, Image, In proceedings, In book, In
collection, In reference, Jurisdiction, Manual, Master's thesis,
Miscellaneous, Movie, Music, Multi-volume book, Multi-volume collection,
Multi-volume proceedings, Multi-volume reference, Legal, Legislation, Letter,
Online resource, Patent, Performance, Periodical, PhD thesis, Proceedings,
Reference, Report, Review, Software, Standard, Supplemental material in book,
Supplemental material in collection, Supplemental material in periodical, Tech
report, Thesis, Unpublished, Video, WWW.

*(Table above has 48 rows = the 48 captured labels; re-verify the label set
one-to-one with the live combobox when building the selector (any label added
by overleaf.com since the capture needs one more exported `@type` line —
the OQ-1 pattern — before it goes in the table).*

### 5. Optional section + Add-field autocomplete (taxonomy captured)

The collapsed `Optional` section holds the per-type optional fields (same
as schema optionalFields). The **Add-field autocomplete** offers these 60
fields, grouped (labels as captured, category headers mine for structure):

- **Common:** Abstract, Subtitle, Title addon, Language, Note, Addendum,
  Publication state
- **Contributors:** Editor A/B/C (editora/b/c), Translator, Annotator,
  Commentator, Introduction, Foreword, Afterword, Book author, Holder
- **Books and volumes:** Main title, Main subtitle, Main title addon, Book
  title, Book subtitle, Book title addon, Volumes, Part, Edition, Chapter,
  Page total, EID
- **Periodicals and journals:** Journal title, Journal subtitle, Journal
  title addon, Issue title, Issue subtitle, Issue title addon, Issue
- **Events and conferences:** Event title, Event title addon, Event date,
  Venue
- **Publication details:** Publisher, Location, Organization, Institution,
  Series, Type, Version, Month, ISBN, ISSN, ISRN, How published
- **Digital and online:** DOI, Eprint, Eprint class, Eprint type, URL, URL
  date
- **Language and origin:** Original language

These expand `allKnownFields` (biblatex field set). Round-trip rule: any
field value present on an entry must survive form open → save unchanged
(parser preserves unknowns; form shows known-only + valued-unknown via
existing `displayFieldsFor`).

### 6. List + preview panel (adopt from overleaf.com DOM, captured in session)

- Toolbar: undo/redo + Code/Visual radio (`cm6`/`rich-text`). (Already have.)
- `bibtex-entry-list-panel`: search ("Search sample.bib"), Add
  button/dropdown (§1.4).
- `bibtex-bulk-actions-bar`: select-all checkbox ("Select all entries") +
  "N reference(s)" count label.
- `bibtex-entry-list-body`: role="list", windowed rows (absolute,
  `data-index`), `bibtex-entry-card-compact` role="button" with "Select
  entry" checkbox → the bulk bar's checkbox set.
- `bibtex-entry-preview-panel` (contained or overlay): prev/next chevrons +
  Close; summary line; **Actions** dropdown: **Download, Delete**; tabs
  **Details | Abstract**; warning banner "**Required fields missing** —
  <missing field names>" (e.g. "Book title", "Editor"); Abstract tab:
  textarea `ref-abstract` (writes `abstract` field — same guard/write path
  as any field).

### 7. Add-field "Paste references" (captured modal)

- Dropdown item "Paste references", sub-label "BibTeX, DOI".
- Modal: "Add reference" again; one `Reference` textarea (helper "Paste
  BibTeX or DOIs here."), Cancel / **Preview** (disabled until non-empty).
- **Open (OQ-5):** what "Preview" does next (parsed-entries confirmation
  list? DOI fetch?) was not captured — the flow after Preview is unknown
  from the HTML provided. Decision needed before build (or defer the Paste
  modal to a follow-up if overleaf.com parity is "form + panels" only).

## 8. Data-layer changes (module, order)

1. `bibtex-schema.json` → expansion to the 48-machine-type set (all names
   verified, OQ-1 closed): 48 `(label, machineType, mainFields[])` entries
   driving the selector + form. Machine types missing from
   `publicationTypes` get schema blocks (requiredFields/optionalFields) so
   `getEntryType` works for them — additive keys only, existing blocks
   untouched.
2. `bib-types.ts`: `ENTRY_TYPES` becomes the 48-list (schema-driven);
   `toLabel`/label map replaced by explicit `humanLabel` per machine type;
   `getNewEntryInitialType` unchanged (default machine is `article`).
3. Form component: Year row + Date row (both types always), per-type main
   fields from table (not just schema required/optional), collapsed
   Optional (existing "All fields"/showAll behavior re-skinned as the
   overleaf.com "Optional" collapse), Add-field autocomplete driven by §5
   (adds known field values; same write path).
4. List panel: compact rows + checkboxes + select-all + bulk bar (replaces
   the reverted W4 card selection; W5 core committed — see `d82833ac88` — is
   the write path: `BibDeleteRequest { entryIds }`).
5. Preview panel: prev/next + Close + Actions (Download = file export of the
   entry's serialized block? needs OQ-6; Delete = single delete reusing
   existing single-delete path; bulk Delete from bulk bar). Details/Abstract
   tabs (Abstract = `abstract` field editor). Warning banner from existing
   `getMissingRequiredFields` per visible machine type.
6. i18n: additive only, both `services/web/locales/en.json` and
   `services/web/frontend/extracted-translations.json`, `{ count }` style;
   **no re-sort of the shared files**. New keys: the 48 labels' UI strings,
   "Select all entries", "N reference(s)" (plural), "Download", "Delete",
   "Details", "Abstract", "Optional", "Add field", helper texts (§2/§3),
   per-type field rows' labels (mostly reuse existing field-label keys),
   "Paste references", "Paste BibTeX or DOIs here."

Reuses (already built): bulk planner + guarded bulk event `d82833ac88`
(`planBibBulkDelete`, `BibDeleteRequest.entryIds`), W1 preset (`article` is
still a valid default), W2 Esc-out, W3 rebind/Check.

## 9. Gates / commit sequence

1. Machine-type mapping table (48/48 verified, OQ-1 closed) → one commit
   (schema + `bib-types.ts` 48-list + tests incl. 48 round-trip cases:
   create entry per machine type → parse → form fields present → write →
   byte-identical field block).
2. Form parity (Year/Date, per-type main fields, Optional collapse,
   Add-field autocomplete).
3. List panel + bulk bar (checkboxes/select-all/"N reference(s)") —
   re-wires `entryIds` (W5 core).
4. Preview panel (chevrons, Actions, tabs, missing-fields banner).
5. Paste modal — **only** after OQ-5 is decided (may defer).
6. i18n (both JSONs, additive, `{ count }`).
7. Scoped ESLint (module) clean, module vitest green, repo runner green.
8. `make all` (build-only; image label == HEAD sha; no webpack ERROR).
9. Push; live-matrix handoff + PR note (live Overleaf container not
   available on this machine — same as before).

Revert rule (unchanged): one work-item per commit, each independently
revertible; schema expansion is additive to `bibtex-schema.json` (new keys,
no edits to existing type blocks) → revert-able as one file.

## 10. Open questions (need user / their overleaf.com)

- **OQ-1 (RESOLVED — 48/48).** Machine `@type` names, explicitly verified
  from the user's export lines (session 2026-08-22): `article, artwork,
  audio, book, bookinbook, booklet, commentary, conference, collection,
  dataset, electronic, image, inreference, jurisdiction, inbook,
  incollection, inproceedings, legal, legislation, letter, manual,
  mastersthesis, misc, movie, music, mvbook, mvcollection, mvproceedings,
  mvreference, online, patent, performance, periodical, phdthesis,
  proceedings, reference, report, review, software, standard, techreport,
  thesis, unpublished, video, www` (+ `suppbook, suppcollection,
  suppperiodical` — 47 explicit + `mvreference` = 48; `electronic` ≠ `online` —
  "Electronic resource" maps to `electronic`, "Online resource" to
  `online`, and `www` is its own type). All twelve unverified guesses
  (see table) hit exactly — no name deviations. Schema expansion is thus
  unblocked: **35 machine types** get added to the schema (48 − 13
  existing); the 13 existing (article/book/booklet/inbook/incollection/
  inproceedings/manual/mastersthesis/misc/phdthesis/proceedings/techreport/
  unpublished) are a strict subset of the 48, so no existing entries can
  become orphaned. Key deltas vs. current schema: `electronic`, `www`,
  `report` AND `techreport` (two distinct types; we only had `techreport`),
  `thesis` distinct from `phdthesis`/`mastersthesis`, `inreference`, and
  `mastersthesis`/`phdthesis` now show the form's `Institution`+`School`
  row pair (we already write both — no schema change needed there).
- **OQ-2.** Both Year *and* Date filled → do they write `year=` **and**
  `date=` as two fields (my current plan), or does Date win?
- **OQ-3.** Add dropdown — the second item is truncated ("… man…" +
  likely "Enter manually"); confirm the exact "manually" label.
- **OQ-4.** Article shows both `Journal` and `Journal title` rows —
  confirm they map to `journal` (BibTeX) and `journaltitle`
  (biblatex) respectively (vs. both to `journaltitle`).
- **OQ-5.** "Paste references" — what does **Preview** do (parsed-entries
  list? DOI resolve?)? The post-Preview HTML was not captured. If
  overleaf.com parity for this phase is manual-form-only, say so and I
  skip the Paste modal (commit 5) entirely.
- **OQ-6.** Preview panel Actions → **Download**: download the whole `.bib`
  or just that entry's @-block? (affects scope of the Download key.)
