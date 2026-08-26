# SVG Diagram Editor (`modules/diagram`)

A built-in, offline drawing editor for **SVG documents** in Overleaf CE,
based on the full **SVG-Edit 7.4.2** application.

Create a figure for `\includegraphics`:

1. **New file → Diagram (SVG)** (or open any `*.svg`).
2. Open the file — the editor boots in **Visual** mode (the full SVG-Edit
   UI: toolbars, rulers, layer panel, zoom, text, groups, gradients,
   context menus, …). Switch to **Code** at the top of the editor to edit
   the raw SVG source.
3. **Save** — the editor keeps the **SVG source** in the document
   (editable, diffable, versioned) and re-creates the companions:
   - **`name.png`** (bitmap raster),
   - **`name.pdf`** (VECTOR PDF, browser-side `svg2pdf.js` + `jsPDF`) —
     so `\includegraphics{diagram}` picks the PDF, with the PNG as
     fallback.

Everything ships inside our own image and works fully offline — no CDN,
no telemetry, no external origin.

## Implementation

The full `svgedit` 7.4.2 app (npm `dist/editor/` build) is **vendored as a
static subtree** at `services/web/public/static/svgedit/` and served by
Overleaf at `/static/svgedit/`:

- `Editor.js` — the app bundle (self-contained ESM, no imports at runtime
  except the extensions below),
- `svgedit.css` — app layout/theme,
- `images/`, `components/` — icons and picker assets,
- `extensions/` — the built-in extensions (shapes, polystar, panning,
  markers, grid, eyedropper, connector, opensave, layer view),
- `LICENSE` — see **License** below.

It runs in a **same-origin iframe** (`embed.html` + `embed.js`) and
talks to the React component through a tiny bridge
(`window.__olSvgEmbed`):

```
parent (Overleaf)                    frame (SVG-Edit app)
    │  iframe src=/static/svgedit/embed.html
    │  waits for window.__olSvgEmbed (poll)
    │─── .load(document SVG text) ────────────────────────▶
    │◀── .onChanged(svg)  (debounced canvas content) ───────
    │  → writes SVG into the CodeMirror-backed document
    │    (Overleaf's sync/version history picks it up)
    │── Save button: companion .png + vector .pdf export ──▶ (parent-side,
    │    from the current SVG text via svg2pdf.js + jsPDF)
```

Why an iframe (rather than mounting the app inline):

- the app resolves `imgPath`/`extPath` **relative to the document base
  URL** and loads extensions with runtime dynamic `import()` — a static
  subtree under `/static/svgedit/` makes both resolve correctly;
- its document-level `keydown` handlers, cookie usage, focus handling and
  CSS stay in the frame; Overleaf's focus-trap, shortcuts and global
  styles are untouched;
- same-origin means the bridge is a direct property call (no postMessage
  ceremony) and the parent can read/verify the frame any time it wants.

Host hardening in `embed.js`:

- **`ext-storage` is excluded** from the extension list (it is the source
  of the storage prompt, the `svgeditstore` cookie, cached auto-load and
  the `beforeunload` auto-save); `noStorageOnLoad` is set as a second
  layer, and `?storagePrompt=false` is in the URL as a third,
- **branding is neutralised** post-boot: the external home-page menu item
  is removed, the main-menu label/logo are replaced with “Diagram”, and
  the canvas library's `<!-- Created with … -->` comment is stripped from
  every serialised string before it can reach the document
  (see `stripBrandingComments` in `diagram-model.ts`),
- `no_save_warning` disables the browser "unsaved changes" prompt —
  Overleaf owns the save lifecycle,
- the parent **always** owns the project content: the frame can only
  receive SVG text and report its canvas state, it never talks to our
  API and never uploads anything.

The `visualEditorProviders` registration makes the canvas the default view
for `.svg` documents (the Code/Visual toggle remembers the user's choice
per family); a one-line default in `editor-properties-context.tsx`
(`showVisualForFile`) makes provider-claimed files open in Visual mode
when no explicit preference is stored yet.

## Files

- `services/web/public/static/svgedit/` — vendored SVG-Edit 7.4.2 app
  (Editor.js, CSS, icons, extensions, `LICENSE`) plus the host entry
  (`embed.html`, `embed.css`, `embed.js` bridge + config + rebrand).
- `frontend/js/components/diagram-editor.tsx` — the editor shell: iframe,
  bridge wiring, document syncing, companion save/export status.
- `frontend/js/components/diagram-editor.css` — shell styles.
- `frontend/js/components/create-diagram-file.tsx` — “New file →
  Diagram (SVG)” entry (`createFileModes` hook).
- `frontend/js/visual-editor-provider.js` — `visualEditorProviders` hook
  (claims `.svg`, provides this component, default-family storage seeding).
- `frontend/js/util/diagram-model.ts` — SVG document helpers
  (blank document, import normalisation, branding-comment stripping,
  dimension probing; Node-testable).
- `frontend/js/util/diagram-utils.ts` — companion naming + file-tree
  helpers (Node-testable).
- `frontend/js/util/diagram-export.ts` — browser-side SVG → PNG (canvas)
  and SVG → vector PDF (`svg2pdf.js` + `jsPDF`) pipeline.
- `test/unit/` — Node-testable helpers via vitest.
- `index.mjs` — module marker (no server configuration needed).
- `services/web/config/settings.defaults.js` — wiring:
  `overleafModuleImports.visualEditorProviders` → this provider,
  `createFileModes` → the create-file pane, `moduleImportSequence`
  includes `diagram`, `.svg` is a text extension.

## License

SVG-Edit 7.4.2 ships under a permissive OR-licensing choice
(`(MIT AND Apache-2.0 AND ISC AND LGPL-3.0-or-later AND X11)`,
`svgedit@7.4.2` on npm). We take the **MIT** grant: the full text is
vendored at `services/web/public/static/svgedit/LICENSE`
(`LICENSE-MIT.txt` from the package) and the version/provenance is this
README. The vendored tree is unmodified except for the added `embed.*`
host files and the removal of source maps/tests.

## Notes & limitations

- The document is plain SVG text; the app is a superset of that format —
  round-trips are stable (the app loads and serialises SVG), but advanced
  features (filters, complex gradients) may be normalised by it.
- Companion renders are computed in the browser on Save; the first Save
  after switching back and forth takes a moment for large figures.
- If the browser cannot start the app (e.g. no ES modules), the editor
  degrades to the raw SVG source view plus a hint in the footer.
