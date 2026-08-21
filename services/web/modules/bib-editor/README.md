# bib-editor

Visual BibTeX editor for `.bib` files. This module adds a **Visual** mode to
the Overleaf source editor: on a bibliography file the user can toggle
Code ↔ Visual, browse entries as cards, and add / edit / delete BibTeX entries
in a form. The Code and Visual modes always represent the **same underlying
`.bib` file** — the file is the single source of truth.

Registered in `services/web/config/settings.defaults.js` (unchanged
registrations: `sourceEditorExtensions`, `rootContextProviders`,
`visualEditorProviders`, `moduleImportSequence`). No backend
(`index.mjs` exports `{}`).

## Architecture: the file is truth

The React side is a **view over the live CodeMirror document**, never a
parallel state:

```
read path:  CM docChanged ─(300 ms debounce, parse)─► context.entries ─► UI
write path: form ─► flush ─► fresh parse of CURRENT doc ─► re-resolve range
            ─► view.dispatch {from, to, insert}
```

Rules (design: `REDESIGN_PLAN.md` §2):

- **R1 (parse live)** — entries are re-derived from the current document text
  on every change; Code-mode edits appear in Visual automatically.
- **R2 (flush-on-leave)** — whenever the panel stops being relevant
  (Code toggle, Back, file switch, unmount), the open form is written back to
  the document. The write is a re-serialized diff re-resolved against a
  *fresh* parse (no cached offsets); it is rejected with a toast when the
  document is no longer the bibliography being edited. This replaces the old
  draft-persistence machinery, which is deleted (no `pendingAddDraft`, no
  `currentDraftRef`, no click interception on the Code/Visual toggle).
- **R3 (no second source)** — the form is the draft; nothing else is persisted.
- **R4 (external change while open)** — CodeMirror stays mounted (hidden) in
  Visual mode, so external edits re-derive `entries`; the selected entry is
  re-resolved by id, and if it vanished the panel backs out to the list.

### Write path (guard)

`extensions/bib-editor-extension.ts` listens to DOM events
(`BIB_WRITE_EVENT` / `BIB_DELETE_EVENT`) dispatched by the context. On each,
it re-parses the **live** document, verifies `expectedSource` still matches,
re-resolves the entry range by citation key (clamped/guarded), and dispatches
to CodeMirror. A rejected write emits `BIB_WRITE_FAILED_EVENT`; the provider
surface a banner instead of corrupting the buffer. After a successful write it
re-emits the parsed state, so the list/form rebinds without the debounce
delay.

### Components

| File | Role |
|---|---|
| `frontend/js/extensions/bib-editor-extension.ts` | CodeMirror ViewPlugin: parse-and-emit, guarded write/delete, scroll-to |
| `frontend/js/context/bib-editor-context.tsx` | Modes `list \| edit`; `selection: null \| {kind:'existing'} \| {kind:'new'}`; `writeEntry` / `deleteEntry` dispatch guarded events |
| `frontend/js/context/bib-editor-provider.tsx` | Bridges the extension's DOM events ↔ React context; write-failure banner |
| `frontend/js/components/bib-editor-panel.tsx` | Panel shell; R2 leave-watchers (showVisual prev-ref, openDoc, unmount); focus effects; delete confirm |
| `frontend/js/components/bib-entry-form.tsx` | One form for new + existing; Check (validate only / materialize for new); stars & OR-group messages; DOI upsert; key generation |
| `frontend/js/components/bib-entry-list.tsx` | Entry cards; inline search; ArrowUp/Down + Enter keyboard nav |
| `frontend/js/utils/bib-parser.ts` | BibTeX parser with byte offsets (+ `generateCitationKey`) |
| `frontend/js/utils/bib-types.ts` | Schema-driven pure field-visibility / star rules |
| `frontend/js/utils/bib-validate.ts` | Pure Check validation (required groups, key/year/DOI/URL formats) |
| `frontend/js/utils/bib-write.ts` | Pure write planner (fresh-source range + guards) |
| `frontend/js/utils/bibtex-schema.json` | Per-type field rules (incl. new `defaultOptionalFields` for the trimmed *new*-entry view) |
| `frontend/js/utils/doi-fetcher.ts` | CrossRef/doi.org metadata fetch (upsert into the form) |
| `frontend/stylesheets/bib-editor-panel.css` | Module-scoped `bib-*` styles |

### Entry form behavior (per reviewer requirements)

- **No Add/Edit distinction.** One form. `existing`: Check validates (no
  write — the write already happened on leave / on Check-for-new). `new`:
  Check materializes the entry into the file (append) *and* validates.
- **Stars / required groups:** a standalone required field shows a star while
  empty; every member of an OR-group (`author`/`editor`, `chapter`/`pages`)
  shows a star while *all* members are empty. Check messages: standalone →
  "X is required"; OR-group → "Either A or B is required" under each empty
  member.
- **No pseudo-fields:** OR-groups are flattened for display (never rendered as
  `authoreditor` rows), guarded by a permanent unit test.
- **Field visibility:** existing → required + optional + valued fields, plus
  `Show all fields`; new → required + a small `defaultOptionalFields` set.
- **Citation key:** hand-entered or auto-generated (author/year + collision
  suffix). A `new` form with nothing but the type materializes nothing.
- **DOI import:** fetches metadata from CrossRef/doi.org and *upserts* into
  the form (user-entered fields not returned by CrossRef are kept).

### i18n

Every `t('...')` literal is a bare string (the app interpolates `__var__`,
never `{{var}}`) and must exist in **both** `services/web/locales/en.json`
(English value) and `services/web/frontend/extracted-translations.json`
(`""` placeholder) — the webpack translations-loader only ships keys listed
in the extracted file, so a missing key renders as raw text in the UI. New
module keys are inserted at sort position in both files (additive-only).

## Testing

Module-local, standalone (mirrors the webdav/notification module convention):

```
cd services/web/modules/bib-editor
yarn install     # standalone node_modules (gitignored); does not touch the monorepo
yarn test        # vitest run
```

Suites (`test/unit/src/`): parser (offsets, round-trip, keyless/no-comma
keys, nested braces), write planner (fresh-range resolution, guards),
types/display rules (no joined pseudo-names), validation (star/group rules,
formats), and i18n sanity (every module literal exists in both shared JSONs;
`__var__` interpolation only).

Live-test matrix (needs a running Overleaf instance — run on the machine
with the container) is in `REDESIGN_PLAN.md` §6 (L1–L10).

### Lint

The repo lint gate is ESLint (`services/web/eslint.config.mjs`, `yarn lint`
= whole `services/web` with `--max-warnings 0`). Scoped runs over this
module only (same engine/config):

```bash
cd services/web
../../node_modules/.bin/eslint --no-cache --max-warnings 0 \
  'modules/bib-editor/**/*.ts' 'modules/bib-editor/**/*.tsx' \
  'modules/bib-editor/**/*.mjs' 'modules/bib-editor/test/unit/src/*.test.mjs'
```

Notes:

- `.mjs` tests import `.ts` utils **with the extension** (repo `import/*`
rules); `bibtex-schema.json` is imported without one. Works in both vitest
runners (esbuild).
- The module `package.json` declares `react` / `react-i18next` /
  `@codemirror/*` as **peerDependencies** (provided by the web app) so
  `import/no-extraneous-dependencies` stays green — ESLint resolves that
  rule against the nearest `package.json`.
- `biome.jsonc` (module-local) is the config behind the fast Biome/LSP
  check for single-file diagnostics (Pi `lsp_diagnostics`). It runs
  **`biome lint` only** — never `biome check` (the formatter is not
  wired to repo style). Every rule off there is a documented repo
  convention, not a hole: ESLint remains the gate.

## Upstream-merge hygiene

All behavior lives in this module. The only shared-file touches are the
additive i18n keys and the existing `settings.defaults.js` registrations
(unchanged this cycle). `bibtex-schema.json` keeps the upstream
`optionalFields` / `allKnownFields` lists intact; the new
`defaultOptionalFields` key is additive, so upstream schema merges stay
clean.

Open PR: #183. Redesign & decisions: `REDESIGN_PLAN.md`.
