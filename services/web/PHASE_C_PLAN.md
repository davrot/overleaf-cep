# Phase C — overleaf.com reference-editor parity (implementation plan)

**Status: plan (supersedes prior PHASE_C plan draft and the reviewer-given
implementation goals/tasks).**
**Authoritative spec = the three capture files (user-confirmed):**
`/home/davrot/bib_notes.txt` (48 Add-reference form states + empty modal),
`/home/davrot/bibtypes_notes.txt` (48 exported `@type{...}` lines),
`/home/davrot/bib_style.html` (full live page snapshot of the shipped
reference editor: toolbar, list panel, bulk bar, compact cards, preview panel,
in-preview form, Optional + Add-field autocomplete, Paste/Preview import flow).
Wherever these captures conflict with REDESIGN_PLAN decisions or Phase B
reviewer work items (W1–W7 framing), **the captures win**. Committed code
so far (W1–W3, W5 core `d82833ac88`, bulk planner) stays in place as the
data layer; this plan re-bases the *UI and feature* plan on the captures.

---

## 1. What the captures establish (analysis)

### 1.1 Entry type vocabulary (verified 48/48)

`bibtypes_notes.txt` gives the exact machine `@type` for every human label
— 1:1, standard BibTeX/biblatex names:

```
Article→article              In reference→inreference
Artwork→artwork              Jurisdiction→jurisdiction
Audio→audio                  Legal→legal
Book→book                    Legislation→legislation
Book in book→bookinbook      Letter→letter
Booklet→booklet              Manual→manual
Commentary→commentary        Master's thesis→mastersthesis
Conference→conference        Miscellaneous→misc
Collection→collection        Movie→movie
Dataset→dataset              Music→music
Electronic resource→electronic Multi-volume book→mvbook
Image→image                  Multi-volume collection→mvcollection
In proceedings→inproceedings Multi-volume proceedings→mvproceedings
In book→inbook               Multi-volume reference→mvreference
In collection→incollection   Online resource→online
Patent→patent                Performance→performance
Periodical→periodical        PhD thesis→phdthesis
Proceedings→proceedings      Reference→reference
Report→report                Review→review
Software→software            Standard→standard
Supplemental material in book→suppbook
Supplemental material in collection→suppcollection
Supplemental material in periodical→suppperiodical
Tech report→techreport Thesis→thesis
Unpublished→unpublished Video→video
WWW→www
```

(That's 48 rows. Machine set = our 13 + 35 new; **our 13 are a strict
subset of the 48** — no existing entry becomes orphaned. Exact spelling
above is as written in the user's export lines; the machine→type map is
keyed on the lowercased machine name, human display labels are from the
selector.)

Key deltas vs our current schema (13 types, `bibtex-schema.json`):
- 35 machine types to add (from the 48 minus our 13): `artwork, audio,
  bookinbook, commentary, conference, collection, dataset, electronic,
  image, inreference, jurisdiction, legal, legislation, letter, movie,
  music, mvbook, mvcollection, mvproceedings, mvreference, online, patent,
  performance, periodical, reference, report, review, software, standard,
  suppbook, suppcollection, suppperiodical, thesis, video, www` — 24 listed;
  the 35th comes from **the `thesis`/`mvreference` pair being distinct**
  (already counted) — the authoritative count is 48 − 13 = 35; the diff is
  in code (C1 test asserts the count).
- Notable pairs: **`report` AND `techreport`** are distinct (we only have
  `techreport`); **`online` AND `electronic`** are distinct;
  **`thesis`** is distinct from `phdthesis`/`mastersthesis`.

### 1.2 Add-reference modal (from `bib_notes.txt` — 48/48 forms verified)

Modal "Add reference", Cancel/Save footer (Save disabled until a type is
selected — observed on the empty modal). Every form (all 48) has the same
anatomy:
1. `Entry type` — `entry-type-selector-btn` (full-width button + caret).
2. `Citation key` + helpers: "Unique key for citations, no spaces or
   special characters" / "Auto-generated from the author and year, if
   left blank".
3. Per-type main fields (table below) — Author/Editor rows carry helper
   'Separate multiple names with "and"'; Pages carries "Page range".
4. `Year` then `Date` — **for every type, always present** in that order.
   Only exceptions: `electronic`/`online`/`www` add DOI/Eprint/URL rows, and
   `unpublished` adds a Note row, all **after** Date.
5. Collapsed `Optional` (`bibtex-collapsible-heading`, "Expand Optional"
   aria-label, caret icon).
6. Footer: Cancel / **Save** (Save disabled at "Select" state).

Per-type main fields, **exact** from the 48 captured forms (schema field
names, before Year/Date — these are UI rows, NOT validation requiredFields;
they become `CAPTURED_MAIN_FIELDS` in `overleaf-type-map.ts`):

| type | main fields (after citation key, before Year/Date) |
|---|---|
| `article` | author, title, journal, `journaltitle` |
| `artwork`, `audio`, `booklet`, `commentary`, `dataset`, `image`, `jurisdiction`, `legal`, `legislation`, `letter`, `misc`, `movie`, `music`, `performance`, `review`, `software`, `standard`, `video` | author, editor, title |
| `book` | author, editor, title, publisher |
| `bookinbook`, `inbook`, `suppbook` | author, editor, title, booktitle, chapter, pages, publisher |
| `conference`, `inproceedings` | author, title, booktitle |
| `collection`, `mvcollection`, `mvreference`, `reference`, `periodical` | editor, title |
| `mvproceedings` | title |
| `electronic`, `online`, `www` | author, editor, title, doi, eprint, url |
| `incollection` | author, title, booktitle, publisher |
| `inreference` | author, editor, title, booktitle |
| `manual` | author, editor, title |
| `mastersthesis`, `phdthesis` | author, title, institution, school |
| `mvbook` | author, title |
| `patent` | author, title, number |
| `proceedings` | title |
| `report`, `thesis` | author, title, type, institution |
| `suppcollection` | author, editor, title, booktitle |
| `suppperiodical` | author, title, `journaltitle` |
| `techreport` | author, title, institution |
| `unpublished` | author, title, then Year/Date → **note** (after Date) |

Note: the capture forms show `author` **and** `editor` as separate rows
whenever both appear — validation `requiredFields` may still use OR-groups
(`['author','editor']`); rows and validation are separate concerns.

Labels → schema fields: "Digital object identifier (DOI)" → `doi` (helper
"The identifier only, not the full URL, e.g. 10.1000/xyz123"); "Eprint" →
`eprint` (helper "The preprint archive identifier, e.g. math/0307200v3");
"Number" → `number`; "Type" → `type`; "Note" → `note`; "Journal" → `journal`;
"Journal title" → `journaltitle` (OQ-4 resolved: two distinct fields —
the capture shows BOTH rows on `article`, each bound to its own field).

### 1.3 Toolbar + list panel + bulk bar (from `bib_style.html`)

- Toolbar: Undo/Redo actions group + **Code / Visual** switch (fieldset
  "Editor mode.", radios `cm6`/`rich-text`). (Module already has the
  toggle; naming/structure alignment is cosmetic.)
- `bibtex-entry-list-panel`:
  - `bibtex-search` input, aria-label "Search", **placeholder is dynamic:
    "Search <currentDocName>"** (capture: "Search sample.bib") — our current
    search is static text; must derive from open doc filename.
  - `bibtex-add-button` (dropdown, "Add"):
    - "Paste references" — description "BibTeX, DOI"
    - "Enter manually"
- `bibtex-bulk-actions-bar` (between search/Add and the list):
  - select-all checkbox (`bibtex-bulk-actions-select-all`,
    aria-label "Select all entries")
  - `bibtex-bulk-actions-count`: "N reference(s)" (capture: "1 reference").
- `bibtex-entry-list-body` (role=list, `bibtex-entry-card-row`
  role=listitem with `data-index`, absolutely positioned → windowed/virtual
  list):
  - Row = `bibtex-entry-card bibtex-entry-card-compact
    bibtex-entry-card-clickable` role=button tabindex=0, id
    **`bibtex-entry-card-<key>#<index>`**; while previewed the row gets
    `bibtex-entry-card-previewing`.
  - Row contents: checkbox `bibtex-entry-card-checkbox`
    (aria-label "Select entry"), `bibtex-entry-card-key` (the citation
    key), `bibtex-entry-error-icon` (aria-label "Entry has errors", error
    icon shown only when the entry has validation errors),
    `bibtex-entry-card-details` (compact summary line: author, title,
    year — fields `bibtex-entry-card-author/-title/-year/-meta/-author`
    classes present).

### 1.4 Preview panel (from `bib_style.html`)

`bibtex-entry-list-and-preview` holds list + preview side by side
(`bibtex-list-and-preview`); preview has contained and overlay variants
(`...-panel-contained`, `...-panel-overlay`; overlay covers the list on
narrow layouts). `bibtex-entry-preview-panel` role=region,
aria-label "Edit reference"; hidden until a card is previewed
(`bibtex-entry-preview-panel-open`).

Structure (top to bottom):
1. `bibtex-entry-preview-header` / `bibtex-entry-preview-header-nav`:
   - "Previous reference" (chevron_left), "Next reference" (chevron_right),
     "Close" (close icon).
2. `bibtex-entry-preview-summary`:
   - `bibtex-entry-preview-summary-key` (citation key, bold).
   - `bibtex-entry-preview-summary-actions`: **Actions** kebab (more_vert)
     → menu: **Download** (download icon) and **Delete** (delete icon).
   - Warning (only when applicable): `role=alert`, warning icon,
     **bold "Required fields missing"** + the missing field names.
   - `bibtex-entry-preview-summary-title/-meta` (author/year summary line).
3. `bibtex-entry-preview-body`: `bibtex-entry-preview-tabs` (role=tablist):
   - **Details** tab (`bibtex-entry-preview-tab-active`) → tabpanel
     `bibtex-entry-preview-panel-details`:
     - **The full entry form is IN the preview** — same
       `form id="bibtex-entry-form"`, same rows (Entry type selector,
       Citation key, per-type main fields, Year, Date, collapsed
       `Optional`) — and **there is NO Save/Cancel footer in the capture**.
       (Edit-commit model = open OQ-7.)
   - **Abstract** tab → tabpanel `bibtex-entry-preview-panel-abstract`:
     `bibtex-abstract-form-group` label "Abstract" + textarea
     `bibtex-abstract-textarea` id `ref-abstract`.
   - `bibtex-entry-preview-body-abstract` marks the body while Abstract
     is active.

So the entry form is a **shared component** with two hosts:
(a) Add dialog (new entry) — with Cancel/Save footer;
(b) preview Details tab (existing entry) — no footer; commits are
in-place (OQ-7). The Add dialog and the preview must stay in sync (the
preview for entry X shows X's form state; editing the preview and then
reopening the modal reflects it — no separate draft store).

### 1.5 Optional section + "Add field" autocomplete (from `bib_style.html`)

The `Optional` collapse (`bibtex-collapsible-heading`, aria-label
"Expand Optional"/"Collapse Optional") contains a **`bibtex-add-field-button`**
("add" icon + "Add field") plus a combobox:
- label: **"Add optional field"**, input placeholder **"Enter field name"**,
  role=combobox, downshift listbox.
- Grouped options (headings are li role=heading, separators between
  groups, options are li role=option):

| Group | Fields offered |
|---|---|
| Common | Abstract, Subtitle, Title addon, Language, Note, Addendum, Publication state |
| Contributors | Editor, Editor A, Editor B, Editor C, Translator, Annotator, Commentator, Introduction, Foreword, Afterword, Book author, Holder |
| Books and volumes | Main title, Main subtitle, Main title addon, Book title, Book subtitle, Book title addon, Volume, Volumes, Part, Edition, Chapter, Pages, Page total, EID |
| Periodicals and journals | Journal subtitle, Journal title addon, Issue title, Issue subtitle, Issue title addon, Issue |
| Events and conferences | Event title, Event title addon, Event date, Venue |
| Publication details | Publisher, Location, Organization, Institution, Series, Number, Type, Version, Month, ISBN, ISSN, ISRN, How published |
| Digital and online | Digital object identifier (DOI), Eprint, Eprint class, Eprint type, URL, URL date |
| Language and origin | Original language |

Note for implementation: the list **excludes the current type's main fields**
(capture for Article: Journal/Journal title already main → not offered;
but Journal subtitle IS offered). Both "Volume" and "Volumes" exist
(distinct biblatex fields `volume`/`volumes`). "Editor" appears in
Contributors even though it's a main field for most types — i.e. the
filter is by *form position*, not by name.

### 1.6 Paste references / import flow (from `bib_style.html` + `bib_notes.txt`)

Add → "Paste references" (desc "BibTeX, DOI") opens modal "Add reference"
with `bibtex-import-form`:
- Label "Reference", `bibtex-import-textarea` (rows≈6), helper "Paste BibTeX
  or DOIs here."
- Footer: Cancel + **Preview** (disabled until textarea non-empty).
Then (Preview) a second modal "Preview" (back arrow → return to textarea):
- `bibtex-import-preview-header`: "Select all" checkbox +
  `bibtex-import-preview-count` ("N reference(s)").
- `bibtex-import-preview-list` of `bibtex-import-preview-card`:
  - checkbox (`bibtex-import-preview-card-check`, label = citation key)
  - `bibtex-import-preview-card-content`:
    - `bibtex-import-preview-card-key` (citation key)
    - `bibtex-import-preview-card-details` →
      `bibtex-import-preview-card-heading` (humanized: "Ernst et al. (2007)")
      + `bibtex-import-preview-card-field` (title line "Efficient
      Computation Based on Stochastic Spikes") +
      `bibtex-import-preview-card-tags` (type badge)
- Footer: count + buttons (Cancel + **Import**).

Paste input is BibTeX text AND DOIs (capture input: `doi:
10.1162/neco.2007.19.5.1313` → previewed as @article Ernst2007 → DOI
**resolution is part of the Paste flow**, OQ-8 scope decision). Conflict
behavior (existing same key) not captured — OQ-9.

### 1.7 Add dropdown (from `bib_style.html`)

`bibtex-add-button` → menu items: **"Paste references"** (sub-label
"BibTeX, DOI") and **"Enter manually"** (exact label — resolves prior
OQ-3). "Enter manually" = our existing Add reference modal.

---

## 2. Delta vs our current module implementation

| Area | Current (committed) | Capture (target) | Change |
|---|---|---|---|
| Type vocabulary | 13 types (`bibtex-schema.json`) | 48 verified machine types | Schema +35 types (additive blocks); label map human→machine 48/48 |
| Form host | Full form view replacing list (modal for new) | Preview panel (contained/overlay) with Details form + Abstract tab; modal only for "Enter manually" | Redo `bib-editor-panel` layout: list + preview split; form component extracted with `footer: 'save' \| 'inplace'` variants |
| Form fields | required + defaultOptional per type | Main fields + Year + Date + collapsed **Optional** (Add-field combobox; optional rows = valued fields + added ones) | New form model from §1.2 table; `Optional` = dynamic |
| Year/Date | single `displayFieldsFor` list | Explicit Year row + Date row, all types | Write/read `year=` AND `date=` (non-empty) |
| List rows | card grid from REDESIGN | compact rows + **checkbox per row** + select-all bulk bar + dynamic "Search <file>" | List component rework; windowing (rows absolute-positioned, data-index) |
| Bulk delete | W5 core (event + planner) committed | same, wired to row checkboxes | Keep `planBibBulkDelete` + `entryIds` branch; UI on top |
| Preview header | (list had search + add) | prev/next chevron + Close + Actions (Download/Delete) + required-missing alert | New preview panel component; reuses existing single/bulk delete |
| Abstract | (field row in form) | Abstract **tab** (textarea `ref-abstract`) | Moves `abstract` out of main form into tab |
| Add menu | single Add button opens modal | add dropdown: Paste references (BibTeX, DOI) / Enter manually / Import from Library (stub, C9) | Dropdown + import modal + preview step (local BibTeX parse + DOI fetch, C5) |
| Add-field autocomplete | n/a (optionalFields shown) | grouped combobox §1.5, "Add optional field"/"Enter field name" | New field taxonomy data + combobox (a11y: combobox/option/separator/heading roles as captured) |
| Search | static placeholder | "Search <openDocName>" | dynamic from open doc |
| Card errors | validation via Check | persistent error icon per row ("Entry has errors") | rows carry per-entry error state (parse + schema required check) |
| Card id/ARIA | `bibtex-entry-card-*` partial | id `bibtex-entry-card-<key>#<index>`, role=button, row role=listitem, previewing class | match naming |

### Data-layer impact

- **`bibtex-schema.json`**: add 35 `publicationTypes` blocks (required
  per §1.2 table; optionalFields = biblatex fields not main;
  defaultOptionalFields = [] by default since Optional is dynamic now).
  Update `supportedPublicationTypes` to the 48. `allKnownFields` gains:
  `volumes, volumeaddon? (only as offered: volume, volumes, edition,
  pages, eid, titleaddon, subtitle, titleaddonaddon? no—) — exactly the
  §1.5 taxonomy ∪ current allKnownFields`.
- **`bib-types.ts`**: 48-entry label map (machine → human label),
  `ENTRY_TYPES` regenerated from schema (still the single source).
- **New pure utils (unit-tested, .mjs tests)**:
  - `overleaf-type-map.ts`: 48 `{label, machine}[]` + humanized heading
    builder ("Ernst et al. (2007)"), field-label→schema map, optional-field
    taxonomy (8 groups) with per-type exclusion (main fields of the
    current machine type are not offered).
  - `bib-import.ts`: paste text → entries (local BibTeX parse + `doi:`
    lines resolved through `fetchEntryFromDoi`), per-line status (ok/error),
    duplicate-key detection (existing keys in current source), preview
    card model (humanized heading util).
- **Context**: `BibAddManyRequest` (import) or reuse `BibAddRequest` in a
  loop? — one guarded write inserting N entries (all-or-nothing, like
  bulk delete) → `planBibImport(source, entries: {key, text}[])`.
- **Extension**: emit events for import; preview panel state (selected entry,
  prev/next index) is React state over the current parse list (no new
  document state).

### i18n (additive in `en.json` + `extracted-translations.json`, `{ count }`
style, **no re-sorting** of the shared files)

New keys (UI strings from captures, en values; `{ count }` for plural):
- `Select all entries`, `Select entry`, `Search {fileName}`
  (interpolated), `N references` plural (existing `entry_selected`?
  no — that's the old W4 bar; add `reference_count` `{count}`:
  "{{count}} reference(s)" — capture: "1 reference"/
  "N references" pattern), `Previous reference`, `Next reference`,
  `Close`, `Actions`, `Download`, `Delete`, `Details`, `Abstract`,
  `Optional` ("Optional" section), `Entry has errors`,
  `Required fields missing` + `Missing: {fields}` (interpolated list),
  `Paste references`, `BibTeX, DOI`, `Enter manually`,
  `Paste BibTeX or DOIs here.`, `Reference` (reuse?), `Preview`,
  `Select all`, `Import`, `Cancel` (existing?), `Save reference`/`Save`
  (existing `save`?), `Add reference` (existing), `Add field`,
  `Add optional field`, `Enter field name`, `Expand Optional` /
  `Collapse Optional`, `Entry type` (existing?), `Citation key`
  (existing?), per-field label keys for the new main fields (DOI, Eprint,
  URL, Book title, Chapter, Pages, Publisher, Institution, School,
  Number, Type, Note, Journal, Journal title) — most already exist (field
  labels from existing form); only add missing. Group headers for the
  autocomplete (Common, Contributors, Books and volumes, Periodicals and
  journals, Events and conferences, Publication details, Digital and
  online, Language and origin).
  → Estimate ~35-40 new keys; exact list finalized per-WI, all additive,
  both files.

---

## 3. Work items (commit order — each revertible alone)

**C1 — Type vocabulary (48 map + schema expansion).**
`overleaf-type-map.ts` (48 rows: label→machine, humanized heading, per-type
main-fields from §1.2, field-label→schema map, optional-field taxonomy +
per-type exclusion) + 35 new `bibtex-schema.json` blocks +
`supportedPublicationTypes`=48 + `bib-types.ts` label source +
tests: 48 round-trip cases (write entry per machine type → parse →
machine type preserved; per-type required/optional lists match §1.2
table; taxonomy exclusion (Article does NOT offer Journal/Journal title,
DOES offer
Journal subtitle)).
i18n: the 48 human labels (they're field-ish display strings — likely need
no key since they're in the map? labels are English-English: **skip i18n
for type labels? — NO: en.json is the UI string store; human labels are
display strings → add as `type_label_*` ONLY IF the project i18n policy
covers them; reviewer pattern: type names were previously hardcoded…
decision: map labels are data (like field names are), NOT i18n — document
decision, keep out of locales (precedent: machine field names are not
i18n'd)).

**C2 — Form parity (Year/Date rows, per-type main fields, Optional collapse,
Abstract split).**
Refactor `bib-entry-form.tsx` to the captured anatomy: Entry type selector
(48, from C1 map) → Citation key (+ helpers) → per-type main fields →
Year → Date → collap
sed `Optional` (dynamic: valued optional fields + "Add field" combobox
from taxonomy, per-type excluded) → host-provided footer. Split
`abstract` from main rows (form no longer lists `abstract` — it's the
Abstract tab, C4). Write path unchanged (guarded, expectedSource,
flush-on-leave — W1/W2/W3 code unaffected). Tests (pure): field ordering
per type, Year/Date always present, Optional contents per valued state.

**C3 — List panel + bulk bar + dynamic search.**
Compact `bibtex-entry-card-row` list (role=list/listitem/button per
capture), row checkbox (aria "Select entry"), select-all
(aria "Select all entries"), bulk bar count ("N reference(s)" plural),
search placeholder = `Search {fileName}` from open doc, row error icon
("Entry has errors") from per-entry required-field check, row id
`bibtex-entry-card-<key>#<index>`, `previewing` state, windowing note
(absolute rows + data-index — implement simple virtualization: visible
window + spacer heights; unit-test the window math). Bulk delete
wires `entryIds` to the W5 core event (existing). Delete of a previewed
row: close preview + keep selection consistent.

**C4 — Preview panel (split layout, header nav, Actions, tabs, in-preview
form).**
`bib-list-and-preview` split: list (C3) + preview panel
(`...-contained` default; `-overlay` fallback by width) with header
prev/next + Close, summary (key, Actions → Download/Delete; warning
`role=alert` "Required fields missing" + names), Details tab hosts the C2
form in **inplace mode** (no footer; commit model per OQ-7 — default:
flush-on-leave per field, same guard), Abstract tab (textarea
`id=ref-abstract`, writes `abstract` field through the normal write
path), prev/next = prev/next entry in the current parse list (not
file order? file order of entries — decide: file order). Download =
**whole-file** download (OQ-6 default) via existing export path; Delete
=single delete (existing) / from bulk bar = bulk (existing).

**C5 — Add dropdown + Paste flow (local BibTeX).**
Add button → dropdown ("Paste references" [desc "BibTeX, DOI"] /
"Enter manually"). Paste modal (textarea, "Paste BibTeX or DOIs here.",
Preview disabled on empty) → preview modal (back arrow, "Select all",
per-card checkbox = citation key, card: key / "et al. (year)" heading /
title line / type tag, footer count + Cancel/Import) → `BibAddManyEvent`
→ new `planBibImport` (guarded, all-or-nothing, insert after last entry,
per-entry trailing-newline ranges, existing-key entries are excluded from
the default-checked set / flagged. DOI lines resolve through
`fetchEntryFromDoi` (OQ-8 → implemented, reuse committed fetcher); a
failed resolution becomes an error card (the other imports still land).
Tests: parser over pasted multi-entry text, key collision, empty, import
guard (replaces missing id → reject), DOI-line splitting, preview card
model (humanized heading util).

**C6 — i18n additive keys** (both files, `{ count }`; no re-sort;
i18n sanity test extended).

**C7 — Style/CSS** for panels/rows/tabs/toggle states (BEM
`bibtex-*` names per capture, scoped `bib-editor` BEM classes, :focus-
visible kept).

**C9 — "Import from Library" stub (user-confirmed 2026-08-22).**
Add-dropdown menu item "Import from Library" (disabled, tooltip "Library
import is not available in this build yet"). No backend, no file — the
library module surface is out of scope; the stub reserves the menu slot per
the user's overleaf.com capture note. Toast/tooltip string is i18n'd
(C6). Trivial, isolated component addition on the C5 dropdown.

**C8 — Gates:** scoped ESLint (module) 0 errors (`--max-warnings 0`),
module vitest green, repo-runner (services/web vitest.config.js) green,
`make all` (build-only; label==HEAD sha; no webpack ERROR), push branch.
Live matrix (incl. new parity checklist rows) hands off — no live
container here.

Revert rule: C1..C7 each their own commit, independently revertable;
C1's schema change is additive (no existing block edited — `allKnownFields`
append at end only), so revert = file revert.

---

## 4. Open questions — RESOLVED 2026-08-22 (user decisions)

- **OQ-2 → both.** Year AND Date both filled → write `year=` **and `date=`**
  (independent fields; no precedence). Both rows always render for every
  type (confirmed: capture shows both rows for all 48).
- **OQ-4 → distinct.** `journal` and `journaltitle` are two distinct
  fields, both rendered as their own rows (OQ resolved by the captured
  `article` form, which shows both).
- **OQ-6 → whole file.** Preview Actions → **Download** = the **whole
  `.bib` file** as a single download (simplest, no per-entry range export).
- **OQ-7 → flush-on-leave, same as today (R2).** The in-preview form has no
  Save button; commits happen on leave (Code toggle, Back, Close, file
  switch, unmount) through the existing guarded write path with the
  W1/W2/W3 semantics preserved (parse-confirmed re-bind, fresh source).
- **OQ-8 → DOI backend lookup implemented.** Pasted DOIs resolve through
  the existing client-side `fetchEntryFromDoi` (CrossRef + doi.org
  content-negotiation, both CORS-safe; no module backend needed). Paste
  flow: split lines → `doi:` lines resolve via `fetchEntryFromDoi`, raw
  BibTeX lines parse locally; preview lists both; failed DOIs show an
  error card (user can still import the rest). This reuses committed code
  (`doi-fetcher.ts`), so C5 scope is bounded.
- **OQ-9 → pre-uncheck conflicts.** Preview pre-unchecks entries whose key
  collides with an existing entry; Import inserts only checked entries.
- **OQ-10 → spellings from the capture taxonomy.** `pagetotal`, `eid`,
  `titleaddon`, `maintitleaddon`, `journaltitleaddon`, `issuetitleaddon`,
  `subtitleaddon`, `eprintclass`/`eprinttype`, `urldate`, `origlanguage`,
  `howpublished` — all in the §1.5 autocomplete list; the taxonomy constant
  uses exactly these names.

Non-questions (resolved by captures): OQ-3 ("Enter manually" exact label),
OQ-1 (machine names, 48/48 ✓ — see §1.1).

---

## 5. Open risk register

| Risk | Mitigation |
|---|---|
| Schema 35-type expansion → parser/serializer regressions | additive only; 48 round-trip tests (C1); existing 13 untouched (blocks byte-identical, existing tests prove it) |
| Optional-dynamic (C2) removes our old defaultOptional display → reviewer-visible diff | that diff IS the spec (capture wins); document in PR comment |
| Virtual list windowing (C3) vs live matrix | window math unit-tested; matrix row L-list checks scroll + selection under scroll |
| Paste lines that need network (DOI resolution, OQ-8) | reuse committed `fetchEntryFromDoi`; per-line error card; import proceeds with the good entries |
| In-preview form commit (OQ-7) mismatch overleaf | OQ-7 resolved: flush-on-leave (R2/W3 semantics); live-matrix row verifies |
| i18n additive into 3k+2.7k key files without sort | exact same procedure as before (insert at anchors, no json.dump) — prior art in prior session works |
| Paste import one-write guard (C5) on large pastes | planner is pure + unit-tested; guard = `expectedSource` (existing) |
| Preview/split layout CSS scope bleed into IDE | BEM `bibtex-*` names, no global selectors (existing discipline) |
