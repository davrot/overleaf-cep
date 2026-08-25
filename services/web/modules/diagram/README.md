# SVG Diagram Editor (`modules/diagram`)

A built-in, offline drawing editor for **SVG documents** in Overleaf CE.

Create a figure for `\includegraphics`:

1. **New file → Diagram (SVG)** (or create any `*.svg`).
2. Draw on the canvas — select, rectangle, ellipse, line, circle, pencil
   (freehand), add text; recolour; reorder; undo/redo; zoom.
3. **Save** — the editor writes back:
   - the **SVG source** into the document (editable, diffable, versioned),
   - a companion **`name.png`** (bitmap raster),
   - a companion **`name.pdf`** (VECTOR PDF, browser-side
     `svg2pdf.js` + `jsPDF`) — so `\includegraphics{diagram}` picks the
     PDF, with the PNG as fallback.

Everything is bundled into Overleaf's own server + JavaScript and works
fully offline — no iframe, no external origin, no CDN, no telemetry.

## Implementation

The canvas is driven by **`@svgedit/svgcanvas` v7.4.x** (MIT, zero
dependencies) — the SVG-Edit canvas core library (successor of
`svgcanvas.js`), bundled into Overleaf's webpack build and used as a
library on its own (not the full `svgedit` app package, which is
LGPL-with-Qualified-Exception and app-coupled).

- No server-side changes: the library is browser JS only, so there are no
  new endpoints, CSP rules, or configuration.
- The document format is plain SVG text (editable/round-trippable), which
  is also the input for the companion PNG and vector PDF exports.

## Files

- `frontend/js/components/diagram-editor.tsx` — the canvas editor,
  rendered for `.svg` documents via the `sourceEditorComponents` hook
  (replaces the plain text editor for that extension).
- `frontend/js/components/diagram-editor.css` — editor chrome styles.
- `frontend/js/components/create-diagram-file.tsx` — “New file →
  Diagram (SVG)” entry (`createFileModes` hook).
- `frontend/js/util/diagram-model.ts` — SVG document helpers
  (blank document, import normalisation, branding-comment stripping).
- `frontend/js/util/diagram-utils.ts` — companion naming + file-tree
  helpers (Node-testable).
- `frontend/js/util/diagram-export.ts` — browser-side SVG → PNG (canvas)
  and SVG → vector PDF (`svg2pdf.js` + `jsPDF`) pipeline.
- `test/unit/` — Node-testable helpers via vitest.
- `index.mjs` — module marker (no server configuration needed).

## Configuration

None on the server side. The only wiring (both in
`services/web/config/settings.defaults.js`) is:

- `overleafModuleImports.createFileModes` →
  `modules/diagram/.../create-diagram-file`
- `overleafModuleImports.sourceEditorComponents` →
  `modules/diagram/.../diagram-editor`
- `moduleImportSequence` includes `diagram`
- `textExtensions` includes `svg`

`index.mjs` may remain a no-op while the module runs in the browser.

## Dependencies

- `package.json` (`service/web`) — added `@svgedit/svgcanvas` (MIT,
  zero-dep canvas library) and kept `svg2pdf.js` + `jspdf` for the vector
  PDF export. `@maxgraph/core` was removed when this module switched from
  maxGraph to `@svgedit/svgcanvas`.

## Build

- `cd server-ce && make all` — builds the Overleaf docker image (the
  frontend bundle now contains the svgcanvas-based diagram editor).
- The frontend bundle is served by `server-ce` — no separate deploy step,
  no environment variables.

## i18n

New keys are registered in `services/web/locales/en.json` (the `diagram_*`
set). `services/web/frontend/extracted-translations.json` (translation
export) stays in sync — keep alphabetical order in both files.

## Tests / checks

- `test/unit/` (vitest): pure helpers (model + utils) run in `yarn
  test:unit:all`.
- Lint/type checks: as per the repo ESLint + TypeScript setup
  (`services/web/eslint.config.mjs`, flat config with the `node:` prefix
  rule for Node builtins).
- Manual/browser E2E (psintern dev server): open a `.svg`, draw, recolour,
  Save → SVG source updated + `name.png` + `name.pdf` present; reopen the
  file and the drawing is back; `\includegraphics{Name}` compiles.

## Security / privacy

- Fully offline at runtime: the canvas library is bundled; there are no
  external fetches, iframes, or origins introduced by the module.
- The module does not add CSP sources (it never loads external resources).
- No telemetry; no analytics.
