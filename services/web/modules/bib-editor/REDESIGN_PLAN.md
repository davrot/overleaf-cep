# bib-editor — Redesign Plan (v1)

Addresses the reviewer requirements from yu-i-i (upstream, `yu-i-i/overleaf-cep:ext-ce`,
see PR #183 discussion) for the `.bib` visual editor. Working branch: `bib-editor`.

Status: **implementation (v1.1, post-damage-assessment)** — A-1 committed
(10a8caf781) together with this plan + sources (311f111e64). A-2..A-5 were
destroyed mid-implementation (session lost) and found uncommitted; assessed
2026-08-21 (§12): no committed work lost, working tree verified, three
P1 guard defects identified & fixed. Commits 2–5 per §4 follow. Live matrix
(§6 L1–L10) runs on the later machine. Sources extracted & integrated
(`docs/sources/bib-format-notes.md`; §2.4/§2.5/§2.6 final).

---

## 1. Requirements (as stated by the reviewer)

1. **File is the single source of truth.** Code and Visual must always represent
   the same `.bib` file, both directions:
   - Edit in Code → visible in Visual immediately after switching.
   - Edit in Visual → visible in Code when switching back.
2. **Auto-save on leaving Visual** — by whatever means (Code toggle, opening
   another file/tab). No "unsaved changes" ambiguity.
3. **Save button → "Check"** — validation only, no write.
4. **No Add/Edit distinction.** One entry form. A new entry is materialized into
   the file on leaving Visual as soon as anything beyond the type is filled;
   incomplete entries are fine (shown with a red frame); Check is always the button.
5. **Alternative mandatory fields**: a star only on *currently empty* mandatory
   fields; filling any member of an OR-group clears the star from the whole group.
6. **Check messages per field**: standalone → "Title is required";
   OR-group → "Either Author or Editor is required" *next to each empty member*.
7. **No pseudo-fields**: `authoreditor` / `chapterpages` must not appear
   (they are artifacts of flattening OR-groups — see §3.2, root-cause confirmed).
8. **Fewer fields visible by default** for new entries; all mandatory + all
   optional + already-valued ignored fields when opening an *existing* entry
   (current behavior, keep).
9. **Open question (reviewer)**: should "Import from DOI" replace the current
   entry completely instead of upserting? (Our recommendation: keep upsert, §2.6.)
10. **Future ideas (reviewer, discussion)**: keyboard focus on entering the
    editor (list → search box; edit → first editable field); ArrowUp/Down list
    navigation; bulk select (Space / Shift+click) with Delete + Move-to-file
    modals.

Constraints (project):
- Keep ALL code in `services/web/modules/bib-editor/`. The only unavoidable shared
  touchpoints are the existing `settings.defaults.js` registrations (unchanged)
  and the two i18n files (§5.3).
- No live Overleaf container on this machine — all validation is static + unit
  tests here; live verification matrix (§6, L1–L10) runs on the later machine.

---

## 2. Architecture: **"the file is truth"**

### 2.1 Current architecture (what exists today)

```
CodeMirror ViewPlugin (extensions/bib-editor-extension.ts)
  parse on docChanged (300 ms debounce) ──DOM CustomEvents──> BibEditorBridge (context)
  listens 'bib-editor:dispatch' {from,to,insert} ──> view.dispatch (blind range)
  listens 'bib-editor:scroll-to'

React:
  context/bib-editor-context.tsx   state: isBibFile, entries, selectedEntry, mode,
                                    source, pendingAddDraft, pendingEditDraft
  components/bib-editor-panel.tsx  list/edit/add modes, draft flush-on-leave,
                                    EditorSwitch click interception
  components/bib-entry-form.tsx    type/key/fields, Generate key, DOI fetch,
                                    validation (Save/Add buttons)
  components/bib-entry-list.tsx    search + cards (red frame when invalid)
```

Problems (evidence in §3): blind range dispatch (stale offsets), draft
persistence machinery (pendingAddDraft/pendingEditDraft, currentDraftRef,
double-restore effect), click-interception on EditorSwitch, Save/Add
semantics, pseudo-field rendering, missing i18n keys, no keyboard support.

### 2.2 Design principle

**The React side is always a view over the live document contents.**
Writes go to the *same* CodeMirror buffer Code mode sees — never to a parallel
state — and are serialized *back through* the buffer:

```
read path   (already works): CM docChanged ─> parse ─> context.entries ─> UI
write path  (redesigned):    form change ─> flush ─> fresh parse of CURRENT doc
                             ─> re-resolve range ─> view.dispatch {from,to,insert}
```

Rules:
- **R1 (parse live)**: context entries are always re-derived from the current
  document text (300 ms debounce, unchanged). Code-mode edits appear in the
  visual UI automatically — this half of "always in sync" already works.
- **R2 (flush-on-leave)**: whenever the visual panel is about to stop being
  relevant for this document (visual→code toggle, file switch, panel unmount),
  the current form's entry is written into the document. The write is a
  **re-serialized entry diff**, not a blind range:
  1. Take the *current* parsed source (never an offset cached from mount).
  2. Existing entry: dispatch `{from,to}` from that fresh parse; range
     clamped/guarded.
  3. New entry: dispatch an append at the end of the *current* source.
  4. If the document is no longer the `.bib` we are editing, or the entry can no
     longer be found → **do not write**; show a toast ("Entry X could not be
     saved — the file changed or was closed") instead of corrupting.
- **R3 (no second source)**: `pendingAddDraft` / `pendingEditDraft` /
  `currentDraftRef` are deleted. The *form* is the draft; R2 flushes it; there is
  nothing else to persist. File-tree navigation works because context state
  (selection + edit target) survives panel remounts; the flushed text lives in
  CodeMirror, and the *next* parse re-derives everything.
- **R4 (external change while open in visual)**: CodeMirror remains mounted
  (hidden) in visual mode, so other features (reference picker insert, etc.)
  can still change the document. On any external doc change while in edit mode:
  re-derive `entries`; re-resolve the *selected entry by id*; if the selected
  entry vanished from the document → back out to list + toast. The in-form edit
  takes precedence if the user flushes later (last write wins, per R2 fresh
  parse). This is acceptable because no other code path edits an *existing*
  entry's range while the panel is open.

### 2.3 Mode unification (no Add/Edit distinction)

```
mode: 'list' | 'edit'
selection:
  null                                   → list
  { kind: 'existing', entryId }          → form bound to parsed entry
  { kind: 'new', draft: BibEntry }       → empty form (type pre-selected)
```

- `New Entry` starts a `kind: 'new'` selection. The form has no visible
  difference from editing (§2.4 field visibility handles it:
  "existing" shows valued-ignored fields; "new" does not — that's the only
  difference).
- **Check** is the only primary button in both cases.
  - `existing`: Check validates only (no write — the write already happened).
  - `new`: Check = *materialize* (append the entry, per R2) + validate. After
    materialization the selection becomes `existing` and the form continues
    bound to it.
- **Back** (arrow) = return to list. It flushes (R2) — there is no "discard".
- **Delete** (existing entries only) + confirm modal (unchanged).
- Red frame: list cards keep the invalid-frame rule; form fields show per-field
  error style after Check.
- Key policy: a `new` entry with no citation key gets an auto-generated key
  (existing `generateCitationKey`) at materialization time, so the file never
  contains an unparseable key-less entry (and upstream 4156d6e1's "parasitic
  entry" cleanup does not target what we write). Red frame remains until the
  required groups are filled.
- Materialization while *nothing but type* is filled: does NOT create an entry
  (per the reviewer: "as soon as anything other than the entry type is filled").
  Back in that state drops the entry (nothing to persist yet) — but the draft
  *selection* state (type choice) is kept in context so returning to
  `New Entry` restores it. (See open decision D2.)

### 2.4 Field visibility, stars, validation

Input: `bibtex-schema.json` (reduced — §9) + the entry's valued fields.

- **Existing entry view**: all required + all optional + every known/unknown
  field that has a value. (Current behavior — unchanged.)
- **New entry view**: required (flattened) + common optional only.
- **Star (required) rule** — computed from requiredFields `string | string[]`:
  - standalone `f` → star shown iff `f` empty.
  - group `[a,b]` → star shown on *each* member iff *all* members empty.
- **Check messages**:
  - standalone missing → `"<Label> is required"` under that field.
  - group missing → `"Either Author or Editor is required"` under *each empty
    member* (reviewer: "next to both fields").
  - invalid citation key chars, non-4-digit year, DOI format, URL format
    (existing rules, kept).
- **No pseudo-fields**: OR-groups are *never* rendered as a field label.
  Root cause (confirmed, §3.2): `uniqueVisible` maps over `requiredFields`
  which contains `string[]` or-groups, so React renders `['author','editor']`
  as a row labelled `authoreditor` (stringified array) and `chapterpages`;
  `requiredFields.includes(fieldName)` is then `false` for every real member so
  stars are lost. Fix: flatten groups into the display list, keep group
  membership in a side map used for stars/messages. Guarded by a permanent unit
  test (schema may not contain concatenated names + form never renders an
  array-valued field name).

### 2.5 "Import from DOI" (open question D1)

**Recommendation: keep upsert** (merge fetched metadata over the current form;
user fields not returned by CrossRef stay). Rationale: DOI databases return a
subset of fields; full replace would silently destroy hand-entered `note`,
`keywords`, `file`, `language`, custom fields — destructive and surprising.
We will surface the behavior with a hint ("Fields populated from DOI", already
present) and answer the reviewer in the PR comment. If he prefers replace, that
is a small later change (replace = `fields = fetched + {keep: []}` with an
optional "keep extra fields" checkbox).

### 2.6 Reducing visible optional fields (v1.1 — FINAL)

Key finding from source extraction: the reviewer's reference `bibtex-schema.json`
is **byte-identical** to our module schema (it is the `@citation-js/plugin-bibtex
0.8.2` file) — so the 145-optional-fields bloat is upstream-internal, and
"fewer fields" can only come from us adding a **new** per-type
`defaultOptionalFields` key to `bibtex-schema.json` (leaving `optionalFields`
and `allKnownFields` untouched → upstream-merge-safe). `@misc` and `@manual`
(standard btxdoc entry types we don't offer) are added to
`supportedPublicationTypes` with their rules. Final lists:
default-per-type optional per `docs/sources/bib-format-notes.md` §3
(existing types + new `misc`; plus `doi`/`url`/`eprint`/`isbn` as core
features). Required fields per the Patashnik canonical table — identical to
our `requiredFields` for all shared types (our schema is correct there,
including the `["author","editor"]` and `["chapter","pages"]` OR-groups).
`allKnownFields` stays complete: valued-but-non-optional fields are always
shown for existing entries; `Show all fields` reveals the remainder.
Rare fields remain editable in Code mode (the reviewer's explicit fallback).

### 2.7 Keyboard & focus

- On visual mount, `mode 'list'`: focus the search box (if entries exist).
- On opening an entry: focus the citation-key field (or first empty required
  field, D3); `Enter` on the list = open focused card; `ArrowUp/ArrowDown`
  move focus through cards; `Esc` = back to list (flushes per R2).
- Bulk selection (Space / Shift+click, Delete-all + Move modals) →
  **§8 phase B.**

### 2.8 What is deleted

- `pendingAddDraft`, `pendingEditDraft`, `setPendingAddDraft/Edit`,
  `currentDraftRef`, mount/unmount flush effects, restore-effect,
  `handleEditorSwitchCapture` click interception (replaced by R2 + a normal
  `onSubmit`/click handler), `bib-editor-panel`'s scroll-to-Code intercept
  (scroll stays: it's benign and useful).
- `search-form.tsx` local copy → reuse the upstream `SearchForm` (reduces
  duplicated surface; the local debouncing can be folded into the list or
  removed — debouncing a client-side filter is unnecessary).
- `index.mjs` stays `export default {}` (no backend).
- `settings.defaults.js` registrations are unchanged.

### 2.9 What stays

- DOM-event bridge between extension and context (still the sanctioned module
  pattern; no new shared code).
- CodeMirror extension as-is *plus* R2 guard (fresh parse, range validation,
  doc-gate) — all inside the module.
- CrossRef/doi.org DOI fetcher (unchanged).
- CSS structure (extended: focus-visible outlines, field error rows).

---

## 3. Bug hunt results (pre-redesign audit)

### 3.1 Confirmed root causes of the reviewer's failed manual fix

Symptom → cause (all in module code):
1. **`Invalid change range 0 to 1675 (in doc of length 1)`** on switching to
   another `.bib` (empty, length 1) with an edit open:
   `context.addEntry()` computes `insertPos = source.length` from the *last
   parsed* `source` state and dispatches `{from:0,to:1675}`; after the file
   swap the same-size parse event updates `source` but the *pending edit*
   re-dispatch (or the restore path) targets a range the new document cannot
   accept → CodeMirror throws. R2's fresh-range re-resolution + range guard
   makes this impossible.
2. **Out-of-sync + `full refresh`** after switching to a `.tex` with an edit
   open: the panel's `openDocName` effect flushes a draft on the *old* doc
   after the new connection state is established, racing the server sync.
   R2's doc-gate (extension ignores dispatches that don't resolve against the
   current `.bib` document) makes stray writes a no-op + toast. (The exact
   server-side error path cannot be reproduced here — verified live on the
   later machine via §11.)
3. **Stale `source` in `addEntry`/`saveEntry`**: uses context `source` captured
   by the closure; if parse is pending, offset math is off. R2 replaces all
   cached-offset usage.

### 3.2 Confirmed rendering bug (pseudo-fields)

`bib-entry-form.tsx`: `uniqueVisible` iterates `requiredFields` which may be
`string[]` OR-groups (`["author","editor"]`). Mapping over the group renders a
row whose label is `authoreditor` / `chapterpages` and whose
`requiredFields.includes(fieldName)` is false → no star, no meaningful field.
Also `getFieldsForType` flattens correctly, so the group rows are *in addition*
to the flattened names? No — in `editFormEntry` view `requiredFields` is used
directly; `getFieldsForType` is only used for `showAllFields`. Net effect:
duplicated/mismatched rows, broken stars. §2.4 removes both issues.
`git -S authoreditor/chapterpages` → never existed in any schema version:
these are purely runtime artifacts. Guarded by permanent tests.

### 3.3 Other findings

- **Draft double-restore**: the mount `useEffect` re-enters edit/add mode from
  drafts on every `entries` update, so "Cancel" is undone by the next parse
  tick. (Becomes moot after R3; kept as a regression-test case until removed.)
- **`detectBibFile` heuristic** (`@\w{` in first 2k chars): misclassifies a
  `.tex` containing a literal `@article` snippet and a `.bib` starting with a
  long `% comment`. Acceptable (module-internal heuristic, low risk) — noted,
  kept, improved only if trivially (filename check: we *have* the filename in
  the extension? No — the CodeMirror extension has no filename context today;
  leave as-is).
- **`parseFields` regex** truncates values containing `}` inside nested
  braces deeper than 2 levels; entries with no comma after the key
  (`@misc{key}` without fields) drop out of `entries` entirely → red frame
  shows for an entry that exists. Parser test suite pins this.
- **i18n**: ~14 of the module's user-facing strings are missing from
  `locales/en.json` **and** `frontend/extracted-translations.json` (e.g.
  `Add new entry`, `Citation Key`, `Import from DOI`…), so the UI shows raw
  *keys* (the known translations-loader behavior). §5.3.
- **`handleEditorSwitchCapture`** infers the toggle's target from `radio.value`
  after `closest('label')`; brittle to upstream markup changes. Replaced by R2.
- **No module README, no tests.** §5, §6.
- **`SearchForm` copy** duplicates upstream; §2.8.
- **`showVisual` per-file storage** (`showVisualForFile` + localStorage):
  switching bib-a→bib-b can *auto-re-enter* visual mode if the stored setting
  for bib-b is 'visual'. The flush watcher must therefore use the
  **previous** value of `showVisual` (ref) — "leave" == `wasVisual && !nowVisual`,
  not "panel unmounted". Documented; tested.

### 3.4 Non-issues (explicitly checked)

- `settings.defaults.js` merge surface is 4 registration lines + 1 import-
  sequence entry — no overlap with upstream commits merged so far (4156d6e1
  touched zotero only).
- `index.mjs` / `moduleImportSequence` fine as-is.
- CSS: no upstream collision risk (module-scoped class names `bib-*`).

---

## 4. File-by-file plan

Everything in `services/web/modules/bib-editor/` unless marked **[SHARED]**.

| File | Action |
|---|---|
| `frontend/js/utils/bib-parser.ts` | Fix key-without-comma parsing; nested-brace depth (iterate brace matching, not regex groups); keep `ParsedBibEntry` offsets; add `entriesToText` helper? No — keep `replace/remove` fns for tests |
| `frontend/js/utils/bib-types.ts` | Expose `requiredGroupsOf(type)`, `flattenRequired(type)`, `displayFieldsFor(entryKind, type, valuedFields)` (the §2.4 rules) as pure functions |
| `frontend/js/utils/bib-validate.ts` | **New** — pure validation: `(type, id, fields, kind) → { fieldErrors, groupMessages, valid }` (§2.4 messages) |
| `frontend/js/utils/bibtex-schema.json` | Add per-type `defaultOptionalFields` (final lists, §2.6); add `misc` + `manual` types (btxdoc rules: `misc` has no required fields); keep `optionalFields`/`allKnownFields` (full citation-js) intact |
| `frontend/js/utils/doi-fetcher.ts` | Unchanged |
| `frontend/js/extensions/bib-editor-extension.ts` | Dispatch handler: fresh parse + id resolve + range guard + doc-gate + toast event; keep parse emit + scroll |
| `frontend/js/context/bib-editor-context.tsx` | Modes `list|edit`; selection `{kind, entryId|draft}`; drop all pendingDraft machinery; add `flushCurrentEdit()` using fresh source; per-file selection reset |
| `frontend/js/context/bib-editor-provider.tsx` | Bridge simplification (keep 2 listeners, drop doc-changed-clear logic where redundant) |
| `frontend/js/components/bib-editor-panel.tsx` | Unified form binding; R2 leave-watchers (showVisual prev-ref + openDoc change + unmount); focus effects; Escape/scrolly |
| `frontend/js/components/bib-entry-form.tsx` | Check-only button; star rules via `bib-types`; group messages from `bib-validate`; key auto-generate on materialize; focus anchor; no Save/Add |
| `frontend/js/components/bib-entry-list.tsx` | Arrow/Enter keyboard nav; search focus; bulk hooks stub (phase B) |
| `frontend/js/components/search-form.tsx` | **Deleted** (reuse upstream) |
| `frontend/stylesheets/bib-editor-panel.css` | Focus-visible + error-row styles |
| `frontend/js/bib-editor-visual-provider.ts` | Unchanged |
| **SHARED** `services/web/config/settings.defaults.js` | **Unchanged** (registrations already in place) |
| **SHARED** `services/web/locales/en.json` + `services/web/frontend/extracted-translations.json` | Add every key in §5.3 (en.json: English text; extracted: `""`) |
| `README.md` | New — module doc, architecture, decisions, dev/test how-to |
| `package.json`, `vitest.config.mjs`, `eslint.config.mjs` (optional) | New — standalone test harness (§6) |
| `test/unit/**` | New — §6 suite |

Commit shape (one per item, all on `bib-editor` branch; shared-file commit last):

| Commit | Content | State (2026-08-21) |
|---|---|---|
| 1 | `parser/utils`: fixes + pure modules (bib-types/bib-validate/bib-write) + schema (misc/manual/defaultOptionalFields) + tests | committed (10a8caf781) |
| 2 | `context/extension`: R2 write path (context/provider/extension) + draft machinery removed + tests | committed from the surviving working tree, **including the §12 P1 fixes** |
| 3 | `panel/form/list`: unified mode, Check, stars, keyboard + focus | committed (as above) |
| 4 | `schema/i18n`: shared i18n key files + i18n sanity test + package.json (the schema itself landed in commit 1) | committed (as above) |
| 5 | `README/tests infra`: README | committed (as above) |
| 6 | (later, live machine) verification notes | pending |

The 2026-08-20 session died after committing 1 and before committing 2–5;
commits 2–5 are reconstructed from the verified working tree (§12).

---

## 5. i18n (per project convention)

### 5.1 Convention (re-confirmed)

- Every `t('...')` literal is its own key. Key must exist in **both**:
  `services/web/locales/en.json` (English value) **and**
  `services/web/frontend/extracted-translations.json` (`""` placeholder).
  The webpack `translations-loader` only ships keys listed in the extracted
  file → missing keys show as raw text in the UI.
- Upstream `extract-translations` (i18next-scanner) regenerates the extracted
  file; the CI check `bin/check_extracted_translations` diff-compares it.
  We add keys manually + keep the scanner happy (keys must be literal
  strings so the scanner picks them up too).

### 5.2/§5.3 — Keys to add (final list produced during implementation;
draft): `Check`, `Citation Key`, `Citation key is required`,
`Citation key contains invalid characters`, `Title is required`,
`is required`, `Either Author or Editor is required` (and general form
`Either __a__ or __b__ is required`), `Year should be a 4-digit number`,
`DOI format looks invalid`, `URL looks invalid`, `Import from DOI`,
`Fields populated from DOI`, `Failed to fetch DOI`, `Generate`,
`Auto-generate from author/year`, `Add new entry`, `New Entry`,
`Edit Entry`, `Untitled`, `No bibliography entries yet. Click "Add new entry"
to create one.`, `No entries match your search.`, `Show all fields`,
`Show fewer fields`, `delete`, `cancel`, `back` (existing),
`Could not save entry: the file changed or is no longer a bibliography.`
(existing keys reused where present — `back`, `delete`, `cancel`, `search`,
`clear_search` already exist).

Note: `Either Author or Editor is required` must be **dynamic per group**, so
the implementation must use `t('Either __a__ or __b__ is required', {a:.., b:..})`
with the `__var__` interpolation style (never `{{}}`) — i18n sanitizer test §6.

---

## 6. Testing (module-local, standalone-runnable)

Harness (mirrors the webdav module convention):
- `package.json` (`@overleaf/bib-editor`, `type: module`, devDeps: `vitest`,
  `jsdom`), `vitest.config.mjs` (jsdom, `test/**`, `passWithNoTests`).
- `yarn install` inside the module dir → `yarn test` / `yarn test:watch`
  run **without touching the monorepo node_modules**. (npm probe confirmed
  the module-dir install is self-contained.)
- No root `node_modules` required on this machine.

Suites (`test/unit/src/*.test.{mjs,ts}` — vitest transpiles TS of the module
sources directly):
1. **parser** — offsets, round-trip serialize, `@comment/@preamble/@string`
   skip, key-without-comma, nested-brace values, repeated keys, empty file.
2. **validate** — star/group rules incl. mixed groups, messages (standalone +
   `"Either A or B is required"` on **both** members), key/year/doi/url
   formats, `new` vs `existing` (key auto-gen vs required).
3. **types** — `displayFieldsFor`: existing shows valued-unknown-fields,
   new shows required+common only; group flattening never emits joined
   pseudo-names (`authoreditor`/`chapterpages` guard).
4. **schema** — no unknown type keys referenced; OR-groups well-formed;
   `allKnownFields` ⊇ union of required/optional after trim.
5. **write-path (R2)** — fake `dispatch` capture: fresh-range resolution,
   out-of-range guard → no-op + event, append for new, doc-gate (non-bib →
   ignore).
6. **i18n sanity** (webdav-style) — every literal `t('...')` in module
   sources (regex over `t('`/`t(` calls) exists in **both** shared JSONs;
   no key value contains `{{`; `__a__`-style placeholders only.
7. **draft regression** (until removed) — old-behavior cases that *should*
   now pass trivially: cancel stays cancelled after a parse tick.

Live test matrix (run on the later machine, manual + Cypress-CT if
time-permitting; the existing cypress component-test infra is upstream):

| # | Scenario (reviewer's exact cases) | Expect |
|---|---|---|
| L1 | Code-mode edit → switch to Visual | Changes visible in list/form |
| L2 | Visual edit (existing) → switch to Code | Change visible at source |
| L3 | Edit open → open a `.tex` | No out-of-sync, old file intact |
| L4 | Edit open → open an *empty* `.bib` | No `Invalid change range`, old file intact (or entry saved to old file — R2 writes before swap where possible) |
| L5 | New entry, fill title only → leave → return | Entry persisted, form resumes, red frame |
| L6 | OR-group star behaviour (fill author in an a/e group) | Stars clear on both |
| L7 | Check on incomplete existing entry | Group message under both fields, no write |
| L8 | Keyboard: arrows/Enter/Esc + focus targets | Per §2.7 |
| L9 | DOI upsert keeps user fields | Per D1 |
| L10 | Switch among 3 bib files, edits in each | Each file independent |

---

## 7. Upstream-merge hygiene

- Zero edits in `settings.defaults.js` this cycle → merge surface stays at
  the existing 4 lines.
- All behavior changes in-module; upstream commits touching zotero/
  reference-picker/clsi (last merge included) have no code overlap.
- Shared-file edits (i18n) are additive-only → trivially mergeable.
- Before pushing: `git fetch upstream ext-ce … rebase` (as done in
  4156d6e1 merge) per davrot's workflow; CI: existing repo checks unchanged.

---

## 8. Phase split

- **Phase A (this plan, full implementation now):** §2.2–§2.8, bugs §3,
  i18n, README, tests + live matrix from §6 (L1–L10) on the next machine.
- **Phase B (explicitly parked, from reviewer "future ideas"):**
  bulk selection (Space/Shift+Click), Delete-all confirm modal, Move-to-
  other-file modal (needs a cross-file write path — investigate `file`
  context update API; likely a frontend-side append + save, or a small
  module endpoint if the API doesn't permit it). Parked because cross-file
  moves add a second write path that must be designed against the sync
  layer (out-of-scope risk for phase A). Keyboard focus/arrow nav from
  §2.7 IS in phase A (module-only, low risk).
- **Phase B (explicitly parked, from reviewer "future ideas"):**
  bulk selection (Space/Shift+Click), Delete-all confirm modal, Move-to-
  other-file modal (needs a cross-file write path — investigate `file`
  context update API; likely a frontend-side append + save, or a small
  module endpoint if the API doesn't permit it), focus improvements.
  Parked because cross-file moves add a second write path that must be
  designed against the sync layer (out-of-scope risk for phase A).

---

## 9. BibTeX field data extraction (DONE v1.1 — integrated)

Sources processed sequentially (file-backed; results in
`docs/sources/bib-format-notes.md`):
1. reference `bibtex-schema.json` attachment → **byte-identical to our
   module schema** (`@citation-js/plugin-bibtex 0.8.2`): no external merge
   possible; the default-trim must be our own new key (§2.6).
2. citation.js.org → project site; the substantive BibTeX data is the same
   `@citation-js/plugin-bibtex` package (item 1). No new fields.
3. Patashnik `btxdoc.pdf` → canonical per-type required/optional table
   (matches our `requiredFields` exactly incl. OR-groups), reveals `misc`/
   `manual` entry types missing from our dropdown, `month` = 3-letter
   abbreviation, `volume or number` is soft-optional (no star).

Plan v1.1 deltas applied: §2.6 final, §4 schema row, D6/D7 in §10.

---

## 10. Open decisions (to answer in the PR comment)

- **D1 DOI replace vs upsert** → recommend **upsert** (reviewer asked).
- **D2 Keyless new entries** → recommend auto-generated key at
  materialization; "back" with nothing-but-type drops the draft.
- **D3 Focus target on entry open** → recommend first *empty* required
  field, fallback citation key.
- **D4 Group message placement** → reviewer said next to *both* fields; we
  follow (test pins it).
- **D5 Phase B move-target file** → cross-file write feasibility (API
  investigation) before committing to a modal.
- **D6 `misc`/`manual` entry types** (v1.1) → add both to the type dropdown
  (btxdoc standard set; `@misc` especially — upstream commit 4156d6e1 is
  literally about `@misc` cleanup, and `misc` needs no required fields,
  which is what makes the reviewer's "incomplete entry, red frame is fine"
  flow meaningful).
- **D7 Default optional list** (v1.1) → new `defaultOptionalFields` key per
  type (docs/sources/bib-format-notes.md §3), not a rewrite of
  `optionalFields` → zero upstream-merge impact.

---

## 12. Damage assessment & recovery (2026-08-21, post-compaction)

The 2026-08-20 implementation session died mid-A-2/A-5 (todo
`8aa5fbe2` “continuation plan v1.1 (post-compaction)”). On 2026-08-21 the tree
was assessed: **no committed work lost** — commit §4.1 (10a8caf781) and the
plan/sources commit (311f111e64) are intact, and the *full* uncommitted
A-2..A-5 working tree survived (46/46 vitest green; LSP clean; i18n spot
check: every module `t()` literal present in **both** shared JSONs, `__a__`
style only, no `{{`).

Uncommitted work found (maps to §4 commits 2–5):
- `context/*` + `provider` + `extension` rewritten for R2; draft machinery
  gone entirely (zero surviving references, per §2.8).
- `panel`/`form`/`list` unified (Check-only, stars, OR-group messages, keys,
  inline search); `search-form.tsx` deleted (kept inline, module-specific —
  upstream `SearchForm` is project-list-specific, note in §2.8).
- CSS: write-failure banner, key hints, focus styles (+1 block, purely
  additive).
- i18n keys in both shared JSONs (additive), plus one **legit de-dup**:
  `continue_github_merge` existed **twice** at HEAD — removal of the second
  occurrence is the only non-additive change and is safe.
- Untracked: `README.md`, `test/unit/src/i18n.test.mjs` (both fold into
  commit 4/5).
- Scratch: repo-root `research.md` = dead-session notes, superseded by the
  committed `docs/sources/bib-format-notes.md` → deleted. `.pi/` (session
  todos) = tool state → never commit.

Defects found & fixed in the working tree before commit (all in the guarded-
write path):
- **P1 (critical, 3 interlinked defects) — fixed:**
  - (a) The panel called `selectExisting` **unconditionally** right after
    `writeEntry` (Check + flush). The event chain is synchronous, so a
    *rejected* guarded write (doc-changed / key-taken) still flipped the
    selection to `existing` for an id that exists nowhere → `existingEntry`
    undefined → panel rendered **empty**, and a typed-new draft became
    unreachable — violating “on rejection the banner shows and the form stays
    in new mode”. Fix: re-binding is now **parse-confirmed** — the extension
    emits `written: { id, mode, originalId }` with the fresh `BIB_ENTRIES_EVENT`
    only after a *successful* guarded write; the context re-binds
    (`new`→`existing`, rename `existing`→new id) only when the id resolves in
    that fresh parse. The panel no longer calls `selectExisting` anywhere.
  - (b) The flush `existing`-branch “unchanged” comparison had a clause that
    classified a **pure key rename** as a no-change (values equal, ids
    normalized to `form.originalId`) and skipped the write → the rename was
    silently lost. Fix: unchanged iff `original.id === entry.id` + value
    equal; anchor for the lookup is `form.originalId ?? sel.entryId`
    (covers a materialized-new draft whose form key is still empty).
  - (c) The extension write-gate rejected any write the `isBibDocument`
    heuristic didn’t classify — including an **empty** `.bib` — so adding the
    *first* entry to a fresh empty file was rejected with “no longer a
    bibliography”. Fix: writes are gated by `expectedSource` equality alone
    (the panel only mounts in visual for `.bib` files, so the write can only
    come from a bib context — this is exactly the “no longer the doc we are
    editing” signal and makes empty-file appends work); `isBibDocument` is
    kept as the delete-gate + as the pure-planner gate (no behavior change to
    `bib-write.ts` itself).
- **P2 (deferred, follow-up)** — D2 “back on a new form keeps the type
  selection” is not implemented (next New Entry resets to `article`). Small
  one-state addition to the context; not on the critical path.
- **P3 (deferred, follow-up)** — cosmetics: after a successful Check the
  re-bind re-syncs the form and clears `checked` (re-Check re-shows messages);
  no `Esc` = back-from-form (§2.7);
  no explicit `:focus-visible` outlines (cards/inputs have `:focus`).

## 13. Housekeeping: scoped lint infra (2026-08-21, compaction cycle 2)

The repo lint gate for this module is **ESLint** under
`services/web/eslint.config.mjs` (the flat config covers `modules/**`). To
make local iteration cheap and the Pi LSP useful without weakening the gate:

- `biome.jsonc` (module dir, committed): Biome 2.x linter preset
  `recommended` with five documented overrides (each = repo convention ESLint
  does not enforce: classic React import, named type imports, div+role
  keyboard rows, `(m = re.exec)` idiom, `!important` error border). Drives
  Pi `lsp_diagnostics` via `biome lsp-proxy`. **`biome lint` only** — the
  formatter is intentionally not wired.
- Module `package.json`: `react`, `react-i18next`, `@codemirror/state`,
  `@codemirror/view` as **peerDependencies** (provided by the web app).
  Needed because `import/no-extraneous-dependencies` resolves against the
  nearest manifest and modules have no other local manifest.
- Module `.gitignore` (committed): `node_modules`, `package-lock.json`.
- Test files: explicit `.ts` import extensions (repo `import/no-unresolved`
  + `import/extensions`), `node:` protocols (repo `unicorn` rule). Run green
  in BOTH the standalone runner (module `vitest.config.mjs`) and the repo
  runner (`services/web/vitest.config.js` includes `modules/*/test/unit/**`).
- Real a11y fixes this cycle (not suppressions): banner is an `alert`
  container with a dismiss `<button>` (locale key `Dismiss`, both shared
  JSONs); list Arrow/Home/End handling moved onto the focused search input
  (wrapper-div keydown was dead for the card row).
- Code findings fixed instead of turned off: `useConst` / `useTemplate` /
  `useOptionalChain` / `useLiteralKeys` on `byField.id` / hook-deps for the
  author field.
- Skill: `~/.pi/agent/skills/overleaf-module-lint/SKILL.md` — the exact
  scoped ESLint/vitest/biome commands.

Status: module ESLint green (zero), 46/46 tests both runners, `biome lint`
green.
