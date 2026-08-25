# Toast Image editor module

Adds an **"Edit Image"** button to the file view header for raster images
(png/jpg/jpeg/gif). Clicking it opens a full-screen [TUI
Image Editor](https://ui.toastmark.com/tui-image-editor/next/en-US/) modal
(resize, filters, shapes, text, drawing, guides). Saving re-uploads the
edited image under the same file name (replacing the file), and the file view
is refreshed through the standard file-tree selection path — so the preview
shows the new bytes.

## Behaviour notes / fixes over the original CE+ version

- Deterministic editor init (waits for a non-zero container size; no blind
  `setTimeout` + `MutationObserver` button-hiding that made the canvas
  flaky).
- Unsaved-changes guard: closing with unapplied edits asks for confirmation
  instead of silently discarding work.
- Verified save flow: `response.ok` checks on both the data-URL read and the
  upload, with user-visible error messages; TUI `usageStatistics` is off.
- Post-save refresh uses the file-tree-open context (re-select the replaced
  file) instead of a magic `file-view:file-opened` CustomEvent.
- GIF is editable too (the file view already previews it).

## Dependencies

- `tui-image-editor` ^3.15 (MIT) — dynamically imported by this module only;
  it does not enter the main bundle.

## Testing

- `yarn test:unit` (vitest): `test/unit/src/toast-image-utils.test.mjs`
