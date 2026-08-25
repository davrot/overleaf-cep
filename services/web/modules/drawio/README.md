# Diagram editor for Overleaf (maxGraph)

A canvas-based diagram editor for Overleaf CE, implemented with
**maxGraph** (`@maxgraph/core`, Apache-2.0) — the successor of mxGraph,
the diagram engine that powers draw.io.

## What this is

- **`.drawio` documents** hold a plain-text diagram model (mxGraph
  `<mxGraphModel>` XML). They are ordinary text documents: editable in the
  source editor, diffable in Git, and — because the model uses the
  classic mxGraph element names — also openable in the free Draw.io
  desktop app for viewing or further editing.
- **The canvas editor** renders that model on a maxGraph canvas that is
  part of Overleaf's own JavaScript bundle (npm package, bundled at build
  time). **No iframe, no external host, no CDN — the editor runs
  fully offline** inside the browser, using only code shipped in the
  Overleaf image.
- **Save** writes the current model back into the Overleaf document
  (so it participates in real-time collaboration and version history)
  and (re)creates companion renderings next to the diagram file:
  - `diagram.pdf` — **vector** PDF for `\includegraphics{diagram.pdf}`
    (browser-side maxGraph SVG → `svg2pdf.js` + `jsPDF`).
  - `diagram.png` — raster preview.
  - `diagram.svg` — fallback if PDF conversion fails (nothing is lost).
- **Edit again, export again:** because the source is the editable model
  file, you can always re-open it, change it, and Save once more to get a
  fresh PNG/PDF — including after years, or in another app that speaks
  mxGraph XML.

## Editor features (v1)

Toolbar: Select · Rectangle · Ellipse · Text · Arrow (two-click) ·
**Freehand pencil** — plus Delete (or `Delete` key), Undo/Redo
(`Ctrl+Z` / `Ctrl+Shift+Z`), Zoom in/out, Fit, stroke/fill colour and
line-width controls (applied live to the selection). Drag from a shape's
border to connect shapes (maxGraph connection handler); double-click a
shape to edit its text.

## Why maxGraph (and not the draw.io embed)

- `embedded.diagrams.net` is an external dependency at *runtime*; the user
  requirement was a self-contained Overleaf image.
- maxGraph is the same engine lineage as draw.io (Apache-2.0, zero
  dependencies), and ships as an npm package — it bundles into Overleaf's
  own JS with the rest of the code.
- The editable model stays a plain text document with full round-trip
  support; PNG/PDF production is 100 % client-side via the existing
  `jsPDF` + `svg2pdf.js` stack (already in `package.json`).

## Files

| Path | Purpose |
|---|---|
| `index.mjs` | Module registration (the server needs no configuration — no iframe, no CSP additions). |
| `frontend/js/components/drawio-editor.tsx` | Canvas editor component (toolbar, model import, save, exports). |
| `frontend/js/components/create-drawio-file.tsx` | "New → Diagram" file-creation pane. |
| `frontend/js/util/drawio-model.ts` | Document → model-XML normalisation (pure, tested). |
| `frontend/js/util/drawio-utils.ts` | Companion file names + file-tree helpers (pure, tested). |
| `frontend/js/util/drawio-export.ts` | Graph → SVG → PNG/PDF (browser-only pipeline). |
| `test/unit/src/*.test.mjs` | Vitest (Node) unit tests for the pure helpers. |

## Upstream wiring (done in `service/web`)

- `config/settings.defaults.js` — `"drawio"` in `textExtensions`;
  `createFileModes` + `sourceEditorComponents` point at the module
  components; `drawio` appended to `moduleImportSequence`.
- `frontend/js/features/file-view/components/file-view-header.tsx` — new
  `fileViewButtons` hook rendering the "Edit" entry that opens the
  canvas editor pane (shared with the `toast-image` module).
- `locales/en.json` + `frontend/extracted-translations.json` — the
  `drawio_*` keys (keep both files in sync: extracted-translations.json
  is the alphabetically-sorted `{key: ""}` list).
- `package.json` (`service/web`) — `@maxgraph/core`, `jspdf`,
  `svg2pdf.js`.

## Notes / limitations

- `ModelXmlSerializer` is marked *experimental* by maxGraph (API may
  shift between versions) — the dependency is pinned accordingly
  (`^0.24.0`) and the module isolates all serialization calls in two
  small files.
- Freehand strokes are stored as point paths on an edge cell (the
  mxGraph technique); they don't support per-point editing in v1.
- PDF text fidelity depends on `svg2pdf.js`'s font handling; if a font
  is unavailable the raster PNG remains a safe fallback.
