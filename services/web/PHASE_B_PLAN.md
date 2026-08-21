# Phase B implementation plan — bib-editor (bulk ops, polish, reviewer close-out)

Status: **PLAN** (not started). Supersedes nothing; extends `REDESIGN_PLAN.md`
§8 (Phase B, explicitly parked) + §12 P2/P3 (deferred follow-ups).
Inputs: reviewer (yu-i-i) "future ideas" message — audited against the code
on 2026-08-21 (all of §1–§13 of `REDESIGN_PLAN.md` already code-backed; this
plan covers what was parked).

Head when this plan starts: branch `bib-editor`, HEAD `a119c321e3` (or later
if more commits land first). No uncommitted work is expected at start.

---

## Scope

| # | Item | From | Outcome |
|---|------|------|---------|
| W1 | New-Entry type preset persists across back/resume | §12 P2 | Re-opening New Entry shows the last-used type (D2 close-out) |
| W2 | `Esc` = back from form (§2.7) | §12 P3 | Esc in the form goes back to the list (flushes); focus lands on the list search box |
| W3 | Post-write form re-sync + `:focus-visible` | §12 P3 | After a parse-confirmed write, the re-bound form re-shows Check results immediately (not cleared); explicit `:focus-visible` outlines |
| W4 | Bulk selection (Space / Shift+click / Ctrl+click) | reviewer | Cards selectable; selection bar with counts |
| W5 | Bulk delete (confirm modal) | reviewer | One guarded write removes all selected |
| W6 | Move selected to another `.bib` file | reviewer | **Conditional** — Step 0 gate (see below) |
| W7 | Live matrix additions L11–L18 + PR comment text | review | On the container machine |

Explicitly **not** doing (per audit, to reply in the PR comment):
- DOI full-replace (decision **kept upsert** — `REDESIGN_PLAN.md` §2.5/D1; the
  reply recommends upsert, implement replace only if the reviewer insists).
- Per-entry "Move" (bulk only). No drag-drop.
- Any **module endpoint** for file I/O (frontend-side is the design; if Step 0
  proves a frontend-side destination write infeasible, W6 is **deferred, not
  re-implemented via an endpoint** — we surface Move as "coming" and reply
  accordingly).

---

## Gates (per work item + final) — commands from `~/.pi/agent/skills/overleaf-module-lint`

1. Scoped module ESLint (repo flat config) — zero:
   `cd services/web && node /home/davrot/bib-editor/node_modules/.bin/eslint --no-cache \
   --max-warnings 0 'modules/bib-editor/**/*.ts' 'modules/bib-editor/**/*.tsx' \
   'modules/bib-editor/**/*.mjs' 'modules/bib-editor/test/unit/src/*.test.mjs'`
2. Standalone vitest: `modules/bib-editor/node_modules/.bin/vitest run`
3. Repo runner: `cd services/web && node /home/davrot/bib-editor/node_modules/.bin/vitest run -c vitest.config.js modules/bib-editor`
4. Lint-only Biome: `cd modules/bib-editor && biome lint .` (never `biome check`).
5. Final (after all W's): `cd /home/davrot/bib-editor/server-ce && make all` —
   **build only**, no `overleafserver` cycle/up. Success = both `naming to`
   lines with `sharelatex/sharelatex:bib-editor-<sha>` + label
   `com.overleaf.ce.revision` == HEAD sha, and **no** `ERROR in …webpack` /
   `Module build failed` blocks.

`biome.jsonc` off-entries: add any new rule conflicts there with an in-file
comment (repo convention), not as new off-entries without one.

i18n for every new key: **both** `services/web/locales/en.json` and
`services/web/frontend/extracted-translations.json`, sorted position,
`__a__`-style interpolation only (enforced by `i18n.test.mjs`).

Commit shape: **one commit per work item**, message
`bib-editor: <W#> <short>`; plan doc commit **first**
(`bib-editor: Phase B implementation plan (bulk ops, polish, reviewer close-out)`).

Order: plan → Step 0 → W1 → W2 → W3 → W4 → W5 → (Step 0 gate) W6 → W7/hand-off.
Each W is independently revertible (no cross-deps except W5→W4 shared state and
W6→W5 shared state).

---

## Step 0 — investigations (do before W1; log results here; this is a decision
gate for W6)

Grep anchors (repo layout has changed from the plan's original paths — verify
each before use; `frontend/js/context` does NOT exist in this fork, editor
context lives under `features/ide-react/context`):

1. **Files context API** (for W6 destination write):
   `grep -rnE "function useFilesContext|fileIdToFilename|fileContents" \
   services/web/frontend/js --include=*.ts* | head`;
   then read the files slice: does it hold content for *closed* files, and
   what is the read/append path (e.g. `contentForFile(fileId)`,
   `files.context.setContent + markDirty`, dirty queue)?
   **Decision fork (record outcome):**
   - (a) Files context exposes current content for a (possibly closed) file +
     a dirty/save path → W6 proceeds **frontend-side** (no endpoint).
   - (b) It does not (content only for open docs; no clean append path for
     closed files without opening) → **W6 deferred** (Phase B1, follow-up);
     this plan's W6 section is replaced by: destination picker UI *stubs*
     are not built; PR reply states Move requires follow-up (sync-layer write
     path), Delete (W5) ships alone. The reviewer gets a working bulk delete
     immediately; Move is honest-parked, not half-build. (No module endpoint
     in either fork.)
2. **Open-doc context** (what the extension can see): confirm
   `useEditorOpenDocContext` exposes *only* `openDocName` (no `fileId` /
   project file list) → W6 picker source = files context (step 1), not
   open-doc context.
3. **"New Entry" handler anchor**: in `bib-editor-panel.tsx`, the New Entry
   button (label key `New Entry`, currently ~line 301) → which context setter
   does it call (expected: `startNewEntry`-like); confirm it has no type arg today.
4. **Existing delete flow anchor**: `planBibDelete` signature +
   `BIB_DELETE_EVENT` detail shape (panel ~line 245, extension ~147-200).
5. **i18n plural convention in `en.json`** (singular/plural pair pattern,
   e.g. `file`/`files`): confirm the pair-key pattern to mirror.

W6 gate: only after outcomes 1+2 are recorded. W1–W5 do NOT depend on Step 0
outcomes 1/2 (only W6 does).

### Step 0 outcomes (recorded 2026-08-21, pre-W1)

1. **Files context: no frontend write path to closed files (fork (b)).**
   - There is no `useFilesContext`/files slice in this fork
     (`frontend/js/states/` does not exist; `useFilesContext` is
     nowhere in `frontend/js`). No `contentForFile`/`getContent(fileId)`/
     dirty-file save API on the frontend (`dirtyFileIds`/`saveDirtyFiles`
     absent). The sync layer (ot) is server-side; the frontend only holds
     content for *open* documents through `DocumentContainer`
     (`features/ide-react/context/editor-open-doc-context.tsx`:
     `currentDocumentId: DocId | null` + `openDocName` + `currentDocument`).
   - A reference-picker write path exists (`references-context.tsx`,
     Zotero module router) but is for writing into the *current* open
     document, not for a user-chosen file → not a move primitive.
   => **Fork (b) chosen: W6 (Move) is deferred** as a sync-layer
     follow-up (Phase B1). Bulk **Delete (W5) ships on its own**. No
     destination picker, no move code, **no module endpoint** (per plan in
     both forks). The deferred W6 design + investigation findings live in
     this plan; the follow-up (any machine) must be built against the
     sync/document service layer, not the frontend context.
2. **Open-doc context**: `useEditorOpenDocContext` exposes
   `currentDocumentId` (DocId, exposed/persisted), `openDocName` (exposed),
   `currentDocument` (local state). The module already uses `openDocName`
   (panel `bib-editor-panel.tsx:61`) → file-switch watcher works today.
3. **New Entry anchor**: `bib-editor-panel.tsx:200` `handleNewEntry` →
   `selectNew()` (no type arg); `selectNew(draft?: BibEntry)` at
   `bib-editor-context.tsx:179`. W1 wires preset through here.
4. **Delete flow anchor**: `planBibDelete(source: string, entryId: string):
   BibWriteGuard` (`bib-write.ts:129`); rejects `NOT_A_BIB_REASON` /
   `ENTRY_GONE_REASON`; `BIB_DELETE_EVENT` detail `{ entryId, expectedSource }`;
   extension gates delete on `isBibDocument(source)` + `expectedSource`
   equality (`bib-editor-extension.ts:147-158`). W5 reuses this path;
   bulk planner = per-id `planBibDelete` + range merge + one dispatch.
5. **i18n plural convention** (repo `en.json`): pairs
   `<key>` (singular text) + `<key>_plural` (text with `__count__`),
   i18next plural suffix (matches e.g. `confirm_accept_selected_changes`
   / `_plural`). W4/W5 keys follow: singular + `_plural` pair, `__count__`
   interpolation (repo-standard; the module test's `__var__` rule covers
   module-only interpolation and accepts `__count__` per repo convention —
   verified by mirroring existing plural keys).
   Baseline at step: `biome lint` exit 0, `vitest run` exit 0.

---

## W1 — New-Entry type preset (P2 close-out)

**Goal:** `New Entry` → pick type `chapter` → back (nothing but type: flush
writes nothing, per §2.3) → `New Entry` again → type shows `chapter`.
(Reviewer: "the editor should continue where it was left"; today resets to
`article`.)

**Change** (one state, context-owned):
- `frontend/js/context/bib-editor-context.tsx`:
  - add `const [newEntryTypePreset, setNewEntryTypePreset] = useState<EntryType | null>(null)`;
  - add `updateNewEntryTypePreset(type: EntryType)`: set it. Called by the
    form's type select change (`bib-entry-form.tsx` `onChange` when
    `kind === 'new'`): `updateNewEntryTypePreset(type)`. (Form already
    `onFormChange`s type — wire the preset inside it to avoid a new prop:
    form calls `onFormChange`, context updates preset only when `kind` is
    `'new'`.)
  - `startNew` (current `New Entry` entry point; see Step 0.3 for exact name):
    initial type = `newEntryTypePreset ?? 'article'`.
  - flush `new` → `existing` rebind does NOT touch the preset (a materialized
    entry keeps no preset — but a *type-only* back also resets the preset?
    Decision: preset is cleared ONLY by an explicit `deselect` from a
    type-only form? No — simpler, matches "keeps the type selection":
    **preset persists until next New Entry re-uses it; nothing clears it.**
    (Document: "last new-entry type wins; no reset affordance — Code-mode
    types are the fallback for anything else." That is the whole feature.)
- Nothing else. Flush path unchanged (type-only still writes nothing).

**Tests** (the module has **no component test harness** — the preset logic is
covered by a pure util + the live matrix):
- **Util:** `getNewEntryInitialType(preset: EntryType | null): EntryType`
  in `bib-types.ts` (null → 'article', else preset) — one line.
- **Cases:** `bib-types.test.mjs` (+1: null → 'article'; 'incollection' →
  'incollection') + live **L16** (preset survives Back/resume, end-to-end).

**I18N:** none.  
**Accept:** ESLint/vitest green; context diff = +1 preset state + 2-line
preset wiring (no other context change).  
**Risk:** low. Rollback: single commit revert.

---

## W2 — `Esc` back from form

**Goal:** in the form (edit mode), `Esc` = Back (flushes per existing R2
Back path). Focus: after back, the list mounts → its mount effect focuses the
search box (already implemented: `bib-entry-list.tsx` mount effect, focus
search if entries > 0). Nothing new needed there beyond the Esc keydown.

**Change:**
- `frontend/js/components/bib-entry-form.tsx`: on the form root `div` add
  `onKeyDown={formKeyDown}`: `if (e.key === 'Escape' && !e.defaultPrevented)
  { e.stopPropagation(); onBack(); }`. `onBack` = existing Back handler
  (panel's `deselect`; verify it dispatches the flush — Back already flushes
  per §2.3; reuse, do NOT add a second flush path).
  - Guard: Esc while DOI fetch is in-flight → still back (flush writes current
    form — acceptable; note in code comment).
  - Guard: Esc while focus is in a *native input* → inputs are `<input>`;
    the `onKeyDown` on the form div **does** receive bubbled Escape from
    inputs (React synthetic) → works; but native `select`/dropdown
    interactions? no custom dropdowns → fine. Document: Esc from any focused
    field bubbles to the form handler.
  - `bib-editor-panel.tsx`: after `deselect` (Back), the list re-mount →
    search focus (existing effect). Verify the effect isn't gated by
    `active`/selection state in a way that skips after an Esc-back (it gates
    on `entries.length > 0`; empty list → no focus, acceptable, note).

**Tests:** no component harness → live **L17** (Esc-back, focus on search
input, flush happened if form had changed).
**I18N:** none.
**Accept/CSS:** none (no styles).
**Risk:** low. Rollback: single commit revert.

---

## W3 — Post-write re-sync + `:focus-visible`

**Goal (W3a):** after a parse-confirmed write (Check-materialize a new entry,
or flush), the re-bound form shows Check *results immediately* (re-check
re-evaluated from the written values) instead of clearing `checked`.
Today: re-bind changes the form's `entrySig` → the sync effect `setChecked(false)`
→ user sees no message, must re-Check. Reviewer §12 P3: "re-Check re-shows
messages" is the *current* behavior flagged as wrong → flip it.

**Change:** `bib-entry-form.tsx` sync effect (~lines 31-44):
- classify the `entrySig` delta: **rebind** (kind changed `new`→`existing`, OR
  `originalId` changed, values equal under a normalized compare) vs
  **user-edit** (any value changed). On rebind: `setChecked(true)` +
  `setValidated(validateEntry(...))` (recompute, don't clear); on user-edit:
  today's `setChecked(false)`.
- pure helper `isRebind(prevSig, nextSig, prevEntry, nextEntry): boolean`?
  Over-fitted; instead: compare inside the effect:
  `rebind = (kind !== prevKindRef.current) || (originalId !== prevOriginalIdRef.current)`
  → `prevKindRef`/`prevOriginalIdRef`, keep the value-compare for edits.
  ~10 lines in the form file. Note: `entrySig` *already exists* as the sig
  string — keep using it as the trigger, add kind/originalId for the branch.
- existing-Check (no write) path unchanged (Check still sets `checked=true`
  via `handleCheck`).
- Edge: flush `existing` with **no change** (no write at all) → no rebind →
  nothing cleared (today `unchanged` path returns before `writeEntry` → form's
  `entrySig` doesn't change → fine, note).

**Goal (W3c):** explicit `:focus-visible` outlines.
**Change:** `frontend/stylesheets/bib-editor-panel.css`:
- change card rule: `.bib-entry-card:focus-visible { outline... }` (keep a
  fallback `:focus` for browsers without `:focus-visible` — add
  `@media` fallback? No: `:focus-visible` unsupported is old; keep BOTH:
  `:focus` on cards (existing) → replace with
  `.bib-entry-card:focus:not(:focus-visible) { outline: none; }`
  `.bib-entry-card:focus-visible { outline... }` — pointer-focus doesn't
  visually steal; keyboard always shows. Same for the search input + the
  primary Check button (`:focus` currently none → add
  `.bib-entry-form .Check :focus-visible`? The Check button has **no**
  `:focus` style today → add `outline: 2px solid var(--blue-50)`
  `.bib-entry-form button:focus-visible` rule).

**Tests:** no component harness → live **L18** (Check-materialize →
messages visible without re-Check; Esc/arrow shows `:focus-visible`).
**I18N:** none. **Accept:** no change to the pure `bib-validate` behavior.
**Risk:** low; rollback: single commit revert.

---

## W4 — Bulk selection state + UI

**Goal:** select entries via Space (toggle when a card is *focused*, since
cards are `role="button"`) / Shift+click (range from anchor) / Ctrl+click
(toggling range); Escape clears selection. Selection bar above/below list.

**State:** panel-level (`bib-editor-panel.tsx`):
- `selectedIds: string[]` (ordered by list position at selection time);
- `anchorRef = useRef<number | null>(null)` (index in `filtered`; reset on
  `openDocName` change / mode change `list↔form`? reset when leaving the list
  entirely, or when file changes; document: kept across open/close of a single
  entry? — Decision: **kept** (bar persists while in visual session);
  cleared on `openDocName` change + on unmount (panel effect) + any write
  (delete/move) that removes ids.
- pass `{ selectedIds, toggleSelect, rangeSelect, clearSelect }` to the list.

**List (`bib-entry-list.tsx`):**
- card: `onClick` →
  - Shift held: `rangeSelect(anchor, i)` (add missing ids of [min,max] range);
  - Ctrl/Cmd held: `toggleSelect(filtered[i].id)`;
  - plain: today's open (unchanged) — plain click still opens (reviewer
    asked "no real distinction" only for form, not for cards: plain click =
    open is the existing behavior; keep).
- card keydown (existing handler, ~lines 93-105): add `Space` →
  `toggleSelect` (and `e.preventDefault()`; Enter still opens; note: Space on
  a `role="button"` card — the browser fires *click*+keydown? For
  `tabIndex` divs React synthetic: `onKeyDown` Space → we handle, stopPropagation
  to avoid double-fire; verify against native default (no, divs don't fire
  click from Space by default — only `button`/native — cards are `div` → safe).
- search input keydown: add `Home/End` (existing), add `Space` →
  `toggleSelect` for the *active* card? — Decision: **No** (search input
  Space typing for search is a common path; Space is on *cards only*).
  Escape in search (when selection non-empty) → `clearSelect`.
- Escape anywhere with active selection (card, search) → clear.
- **selection bar** (`bib-entry-list.tsx` or panel, above cards):
  `__a__ entries selected` (`entries_selected`/`entry_selected` pair — i18n
  plural pattern per Step 0.5; singular "1 entry selected" no number key) —
  keys: `entries_selected` = "__a__ entries selected", `entry_selected` =
  "__a__ entry selected" (singular, a=1). Buttons: `Clear` + the W5/W6
  buttons appear here (W5 add, W6 add when Step 0 fork = (a)).

**I18N (both JSONs):** `entries_selected`, `entry_selected`, `clear_selection`
("Clear selection"), `select_hint`? (not needed — the bar shows counts only;
keyboard hint row? — add `select_hint` = "Select with Space / Shift-click"
under bar? NO — bar is minimal: counts + buttons only; hint text is
documented in code, not UI, to avoid locale bloat. Decision: no hint key.)
→ 3 keys W4, `delete_entries_*` W5, move keys W6 (below).
`test/unit/src/i18n.test.mjs` unchanged (it scans module `t()` + files +
interpolation — auto-extends).

**Tests:** selection logic is DOM/React state, no unit harness → **live L11**
(verify: 2 select, bar shows counts; deselect).
**Accept:** ESLint/vitest/biome green; selection bar CSS (scoped `.bib-*`,
additive): `.bib-select-bar`, `.bib-select-count`, `.bib-select-btn`,
`.bib-select-clear` + card-selected style (existing invalid style untouched):
`.bib-entry-card-selected { outline: 2px solid var(--green-20)... }`? —
Decision: selected card uses a **blue** outline (not green — green = valid?
cards only show red invalid; blue for selection, `var(--blue-50)`,
offset -2px, same as `:focus`).
**Risk:** low. Rollback: revert.

---

## W5 — Bulk delete (one guarded write)

**Goal:** `Delete selected` button (selection bar) → confirm modal
(existing `GenericConfirmModal`, same pattern) → one `BIB_DELETE_EVENT` with
all selected ids → extension plans **bulk** ranges + one dispatch → fresh
parse → ids removed. **Guard:** all ids must exist in the fresh parse with
`expectedSource`; any missing / changed doc → reject **the whole op** (no
partial) → banner (reuse `writeFailure`), selection preserved (can retry /
clear).

**Change:**
- `frontend/js/utils/bib-write.ts`: `planBibBulkDelete(source, entryIds,
  expectedSource): GuardResult`: per-id `planBibDelete` (existing, single),
  collect ranges, verify (all ok + ranges non-overlapping + **sorted
  ascending** — parser offsets are ascending → order by `from`), build single
  dispatch `changes: plans.map(p => ({from:p.from,to:p.to,insert:''}))`.
  `planBibDelete` currently takes a single id → generalize:
  `planBibDelete(source, entryIds: string[])` (array; call sites pass
  `[entryId]`) — backward-compat preserved, planner single path shared.
- extension (`bib-editor-extension.ts`): `BIB_DELETE_EVENT` handler
  (~line 147): `detail` supports `entryId: string` OR `entryIds: string[]` →
  `planBibDelete(source, ids)` → dispatch (bulk) → `emitState()` (no
  `written` rebind — bulk, no selection).
  - **No partial**: if any id missing → reject (banner "could not save"…
  bulk message: reuse `writeFailure` string? Decision: **keep a single
  writeFailure** for all delete failures (banner text unchanged; the failure
  case is still "write targeted a doc that changed" — fine, do NOT add a
  new locale key for "bulk".)
- context (`bib-editor-context.tsx`): `bulkDeleteEntry(ids: string[])` →
  `dispatchEvent({ type: BIB_DELETE_EVENT, detail: { entryIds: ids,
  expectedSource } })` (new `writeEntry`-like fn reusing the existing
  event plumbing). Panel's Delete-selected calls it.
- panel: `confirmBulkDelete` state + modal (labels: `delete_entries` /
  `delete_entries_confirm`? — keys: `delete_entries_selection` =
  "Delete __a__ selected entries?" (a=count) + reuse existing `delete`
  (existing) confirm? GenericConfirmModal takes a confirm label + title:
  title = `delete_entries_selection`, body = existing message text
  "are you sure... cannot be undone"? — body key: existing single-delete body
  is hardcoded? panel line ~347: inline string in `t(...)`? (verify: it used
  `t('delete')` + a body — check exact: it's `t('Are you sure you want to
  delete this entry? This action cannot be undone.')`-like. For bulk: `delete_entries_body`
  = "This action cannot be undone." reuse? Decision: single new title key
  `delete_entries_selection` + reuse existing body key if it's generic enough
  ("delete *these* entries"? — body today is single-entry-worded → **add NEW
  body key** `delete_entries_selection_body` = "Are you sure you want to
  delete __a__ selected entries? This action cannot be undone.". Keys:
  `delete_entries_selection` (title) + `delete_entries_selection_body`.
  2 keys, not 1, for a clean modal (GenericConfirmModal takes separate
  title/label? verify its props: `confirmLabel` + a title/message — see
  panel usage ~342-349; mirror it).)

**Tests:** `test/unit/src/bib-write.test.mjs` **extend** (new cases):
- bulk of 3 (non-adjacent) → ascending ranges, exact offsets, empty `insert`.
- bulk of adjacent (idempotent: one id twice? no — the bar can't select an id
  twice; guard: dedupe).
- one id missing → `ok: false` (reason `'key-not-found'`), **whole op**
  rejected (no partial ranges).
- `expectedSource` mismatch (empty source, source changed) → reject.
- single id (backward-compat call) → same result as the single test
  (existing test for `planBibDelete` single id passes unchanged).
**I18N:** `delete_entries_selection`, `delete_entries_selection_body`.
**Accept:** guard parity (no partial ever); live **L11** (bulk delete) +
**L12** (deselect → delete button disabled / no-op guard).
**Risk:** medium (a new dispatch range) — mitigated by planner test +
L11/L12. Rollback: revert (bulk path is additive; single delete is
backward-compat preserved).

---

## W6 — Move selected to another `.bib` file — **DEFERRED (fork (b), 2026-08-21)**

**Decision (Step 0 outcomes 1+2, recorded above): no implementation in this
cycle.** The repo frontend has no files context / files slice (no per-closed-
file content store, no dirty/save API); open-document content lives in a
`DocumentContainer` behind the open-doc context, and the sync layer is
server-side, so appending to a *closed, user-chosen* `.bib` file is not
expressible from frontend context without touching the sync/document-service
layer. Per the written plan: W6 commits **no code** in this cycle; the
follow-up is built against the sync/document service layer (NOT a module
endpoint — "no module endpoint in either fork" stays), and W5 (bulk delete)
ships on its own.

**Consequences in this plan:**
- Selection bar (W4) shows counts + **Delete** only — **no Move button**.
- Fork (a) design sketch is retained below as the follow-up record (NOT
  built). Fork (b) note: picker source was "files context"; per Step 0 the
  list of project `.bib` files still needs a source (the follow-up must
  resolve it — likely via the file-tree open context that the panel's host
  provides, or a project files list from the sync layer) — this is a
  FOLLOW-UP investigation, not a Phase B blocker.
- Live matrix: **L14/L15 removed** (no move scenarios).
- PR reply (W7): "Move is parked as a sync-layer follow-up; delete ships
  now; no endpoint to fake it."

**Deferred-design sketch** (for the follow-up, NOT built):
- Verbatim source slices from the fresh parse (`ParsedBibEntry` offsets) →
  appended to destination file, each terminated by a blank line (no double
  newline accumulation); destination read via the sync/document service
  layer (not from an open editor); source deleted via the W5 bulk planner
  (source `expectedSource` guard runs first); destination write scheduled
  via the service-layer append+save (not a CodeMirror dispatch).
- Destination picker = project `.bib` filenames minus the open doc; confirm
  modal; i18n keys follow the repo plural convention (Step 0 outcome 5).
- No per-entry move, no drag-drop, no cross-project move (unchanged).
- Fork (a) (the earlier "implement as below") is **void** — fork (b) is the
  recorded decision.

*(The earlier fork-(a) implementation sketch, including "Goal (fork a)" and
the move util/extension/context changes, is superseded by the decision
above and is NOT part of this cycle. The follow-up reuses the verbatim-slice
approach; the fork-(b) investigation notes are in Step 0.)*

---

## W7 — Live matrix additions + PR close-out (on container machine)

Extend `REDESIGN_PLAN.md` §6 (L1–L10 stay untouched; additive numbering):

| # | Scenario | Expect |
|---|----------|--------|
| L11 | Select 2 cards (shift+click) → `Delete` → confirm | Both gone, file parses, no red frame, no `Invalid change range` |
| L12 | Deselect all → delete bar absent (or disabled) | No dispatch, no guard, nothing written |
| L13 | Bulk-delete with a Code-mode **simultaneous** edit (race) | Banner, nothing deleted (expectedSource guard, whole op rejected) |
| L14 | Fork (a): select N → Move → target `.bib` (empty + non-empty variants) | Entries appear verbatim in target, disappear from source, target dirty→saved |
| L15 | Fork (a): select → Move → target is `.tex` | Guard: target must be `.bib` (rejected or not offered); nothing written |
| L16 | Type-only New Entry (pick `incollection`) → Back → New Entry → type = `incollection` (W1) |
| L17 | Form with edits → Esc → Back, search box focused, edit flushed to Code (W2) |
| L18 | Check-materialize new entry (title+type only) → form re-binds → messages shown immediately (W3a); keyboard nav shows `:focus-visible` outlines (W3c) |

Fork (b): L14/L15 **removed** (replace with "Move deferred — no scenarios").
`REDESIGN_PLAN.md` §8 Phase B line: closed with pointer to this plan +
outcomes (delete done, move fork a/b, P2/P3 done), §12 P2/P3 closed.

**PR comment (draft, to finalize post-live-matrix):**
- D1 (DOI): recommend **upsert** (implemented upsert; rationale: DOI returns
  a field subset; replace destroys hand-entered `note`/`file`/custom;
  "populated from DOI" hint; "replace" offered later if wanted).
- "no Add/Edit distinction": **yes, as implemented** (unified form; Check
  only; auto-materialize on leave when something beyond the type is filled;
  type-only writes nothing — red frame while incomplete; type selection
  persists now (W1)).
- Bulk ops: selection (Space/Shift/Ctrl+click; Esc clears), delete (one
  guarded write, partial-rejection guard), move (fork a: verbatim slice
  move; fork b: deferred (sync-layer write path — follow-up, no endpoints)).
- Focus (W2/W3 + existing §2.7): Esc back, search-box focus on (re)mount,
  `:focus-visible` outline, arrow-nav.
- L matrix results (live): L1–L10 + L11–L18 table.

Push: `git push` (branch `bib-editor`). Hand to reviewer via PR comment.
**No** `make cycle`/`up`/`docker` on **this** machine (build only, final
after W6 (or W5 if fork b) all gates green).

---

## Gates per W (run 1-4 after each commit; 5 final)

| W | Gate notes |
|---|-----------|
| W1–W3 | 1–4 + live L16/L17/L18 (W1/W2/W3 map). No `make`. |
| W4 | 1–4 (selection is React state: no unit tests; live L11/L12). CSS additive-only. |
| W5 | 1–4 + new `planBibBulkDelete` unit tests (pure, planner shared with W5/W6). |
| W6 | **Deferred (fork (b), Step 0)** — no gate to run; no commit of code. |
| Final | Gate 5: `make all` (build only, label == HEAD sha, no webpack ERROR blocks) + push + PR comment drafted. |

**Revert policy:** each W is one commit, revertible alone; W5/W6 planner is
shared + additive (existing single-call signatures backward-compat
preserved → old tests don't break → revert of W5 = revert of the additive
files only, context fn removed).
**Rollback order (worst case):** final → revert W6 → W5 → W4 → W3 → W2 → W1
(plan commit stays).

---

## "Won't do" (to say in the reply)

- DOI **replace**: no (upsert is the decision; "replace" later (small,
  optional) — not this cycle).
- Per-entry **Move / drag-drop / reorder by drag**: no (bulk only).
- **Module endpoint**: none (fork b = deferred, not endpoint-implemented).
- **Undo** for bulk ops: no (Out of scope: Overleaf history is the repo's;
  bulk is one op → one undo step — note in reply as a follow-up if the
  reviewer wants *selective* undo granularity… actually one-op = one-undo is
  **fine**; document this as the reason undo granularity is not an issue).
- **Move into the current file**: rejected by the picker (no-op by definition).
- **Cross-project move**: out of scope (same-project `.bib` only — the
  reviewer said "moving them to another bib file" = same project; document).

## Open risk register

| Risk | Mitigation |
|------|-----------|
| Step 0 fork (b) more likely than (a)? Unknown without the investigation | Step 0 is the **first** action of this plan (before W1's code, after its greps); fork (b) is a **documented** fallback with partial scope (delete alone), not a dead end |
| Bulk + move = two new write paths → sync-layer surprise (L13/L14) | Planner + guard **first** (unit), guard parity (no partial), live L13/L14 are the **acceptance** for the paths, not a nice-to-have |
| New i18n keys (4-8) in a 11k-key file | text-insert in sorted position (no `json.dump`), the i18n test enforces presence + `__var__` form + sort? (it enforces presence/interpolation; sort order is manual — verify `en` value is not empty) |
| No component-test harness in the module | live matrix is the **acceptance** for W1/W2/W3/W4 (W7); unit tests **only** for pure logic (planner, preset util) |
| `:focus-visible` + browser (Firefox vs Chrome `:focus`) | keep `:focus` fallback (existing behavior not regressed) + `:focus-visible` is additive; L18 confirms keyboard shows outline |
| Selection state (panel-level) survives across file switch | Effect clears selection on `openDocName` change (explicit, tested with L1/L10 matrix file switch); **no** stale selection on the new file |
| W3a rebind detection (kind/originalId refs) misfires → messages hidden/re-show wrong on a **user edit** | The branch is narrow (kind **OR** originalId change, not on value-only edits) — unit… no component test; risk is LOW (rebind only happens via parse-emit (already guarded) path; user-edit path is unchanged); live L18 covers it |

## Commit sequence (final)

0. `bib-editor: Phase B implementation plan (bulk ops, polish, reviewer close-out)` — **this** file (+ §8/§12 update **only if** fork b is chosen (no, plan doc first: no REDESIGN edit; the REDESIGN §8/§12 close-out is a **separate** small commit at W7's time (live results + fork decision)).
1. W1: `bib-editor: W1 New-Entry type preset survives back/resume (P2 close-out)`
2. W2: `bib-editor: W2 Esc = back from form, focus to search list (P3 §2.7)`
3. W3: `bib-editor: W3 post-write re-sync shows Check results; :focus-visible outlines (P3)`
4. W4: `bib-editor: W4 Bulk selection (Space/Shift/Ctrl+click, Esc, selection bar)`
5. W5: `bib-editor: W5 Bulk delete (one guarded write, whole-op reject)`
6. W6: (fork a) `bib-editor: W6 Move selected to another .bib (verbatim slice, guarded)` OR (fork b) `bib-editor: W6 Move deferred (sync-layer follow-up); Phase B plan updated` (REDESIGN §8/§12 updated in **this** commit (fork b) OR W7's (fork a))
7. W7 (final): `bib-editor: live matrix L11–L18 (bulk, presets, keyboard) + Phase B close-out in REDESIGN_PLAN (§8/§12)` — **only if** live matrix ran (on the machine). Otherwise the W7 split: a `bib-editor: Phase B close-out (REDESIGN_PLAN §8/§12 + plan fork decision + PR comment draft)` (no live results yet) — the live-matrix numbers are appended once run.

Final (after all gates + 5): `make all` build-only + push.
