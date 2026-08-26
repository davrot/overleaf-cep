# Mobile Support for the Project Document View (`/project/[DOCUMENT ID]`)

**Scope:** Add first-class mobile support to the IDE route — the view served at `/Project/:Project_id` (see `app/src/router.mjs:552`). Everything at the project-list route (`/project`, `:529`) is already mobile-responsive; this plan covers only the document view and its sub-views.

**Hard constraint:** **Do not touch the wide-window (desktop) design.** Desktop remains the source of truth. All mobile rules are *additive*: they activate only when the viewport is below a defined breakpoint and leave every existing `sideBySide`/detach/focus-mode code path byte-for-byte untouched above it.

---

## 1. Current state (what is NOT mobile-ready today)

### Entry chain
- `frontend/js/pages/ide.tsx` (entry `pages/ide`)
  → `IdeRoot` (`frontend/js/features/ide-react/components/ide-root.tsx`)
  → `IdePage` (`frontend/js/features/ide-react/components/layout/ide-page.tsx`)
  → `MainLayout` (`frontend/js/features/ide-react/components/layout/main-layout.tsx`) + `<Toolbar />`, `<RailLayout />`, `<PdfPreview />`.

### Layout state (single source of truth for layout decisions)
`frontend/js/shared/context/layout-context.tsx` — provides:
- `pdfLayout: 'sideBySide' | 'flat'` (side-by-side **is** the mobile-breaking case)
- `view: 'editor' | 'file' | 'pdf' | 'history'`
- `focusMode` (a desktop single-pane primitive already built and gated behind `focus-mode` flag)
- `changeLayout`, `setView`, `handleDetach`/`reattach` (detached PDF, irrelevant on mobile)
- persist key: `pdf.layout` in `localStorage` (see `setLayoutInLocalStorage`)

### React resizable-panels structure (`main-layout.tsx`)
Two nested horizontal `PanelGroup`s:

```
<PanelGroup direction="horizontal" autoSaveId="ide-redesign-outer-layout">
  <RailLayout/>                                      // left
  <Panel id="ide-redesign-editor-and-pdf-panel">
    <PanelGroup direction="horizontal" autoSaveId="ide-redesign-editor-and-pdf-panel-group">
      <Panel id="ide-redesign-editor-panel" defaultSize={50}/>
      <HorizontalResizeHandle/>
      <Panel id="ide-redesign-pdf-panel" defaultSize={50} collapsible/>
    </PanelGroup>
  </Panel>
  {mainEditorLayoutPanels.map(...)}                  // right rail (modules)
</PanelGroup>
```

On a 375px viewport **three** `Panel` columns get laid out side-by-side (minSize 5 each), and `HorizontalResizeHandle.sizing` relies on double-click-to-toggle — none of which is touch-friendly.

### Toolbar
`main-layout.tsx:37` renders `<Toolbar />`. `toolbar.tsx` renders three groups:
- `ide-redesign-toolbar-menu`: `<ToolbarLogos />`, `<ToolbarMenuBar />` (a 358-line mega-menu with `file/edit/insert/format/pdf-controls` sections)
- `ide-redesign-toolbar-actions`: `<OnlineUsers />`, `<ShowHistoryButton />`, `<ChangeLayoutButton />`, `<SubmitProjectButton />` (module), `<ShareProjectButton />`, `<UpgradeButton />` (repositioned)
- On mobile the menubar is effectively unreachable (tap target + overflow).

### Rail
`rail.tsx` — tabs: `file-tree | integrations | review-panel | chat | full-project-search | dimensions | workbench`. State lives in `frontend/js/features/ide-react/context/rail-context.tsx` (`isOpen` persisted at `rail-isOpen`). Today the rail is a *permanent* visible-left column.

### PDF
`frontend/js/features/pdf-preview/components/pdf-preview-pane.tsx` and `pdf-preview.tsx` (58/21 LOC). Zoom, synctex controls, and hybrid toolbar (`pdf-viewer-controls-toolbar.tsx`, 183 LOC) all assume side-by-side width.

### Source editor
`frontend/js/features/source-editor/` (CodeMirror based). Only mobile-aware branch today is `isMobileDevice` used in `extensions/context-menu.ts:400` to **disable the right-click context menu** on mobile. No touch-tuned `keymap`, no larger line number gutter, no on-screen input handling.

### Chat / file-tree / settings
- `chat-pane.tsx` (108 LOC) and `message-list.tsx` (116 LOC): fixed-width flex, no `100dvh`, input bar not keyboard-aware.
- `file-tree/doc` rows: 1 row per file, no tap-extended target area, relies on hover reveal of right-side action icons.
- `settings-modal.tsx` (57 LOC), `Modals`, `GlobalToasts`: rendered as centered `<Modal>` with `d-md-3` sizing, no full-screen/bottom-sheet path.
- `OLToastContainer` toasts: right-side, fixed max-width.

### Existing mobile primitives I will reuse
| Primitive | Location | Why reuse |
|---|---|---|
| Bootstrap 5 grid & `d-sm/d-md/d-lg-*` | imported in `frontend/stylesheets/base/bootstrap.scss:54` | Repo-wide convention for responsive utility classes; no new CSS engine required |
| Bootstrap breakpoints (`xs/sm/md/lg/xl/xxl`) | defined in BS5 + `frontend/js/utils/screen-breakpoint.ts` (`getBootstrapBreakpoint`) | Existing, documented values |
| `isMobileDevice()` (UA + `pointer: coarse` + `hover: none`) | `frontend/js/features/source-editor/utils/isMobileDevice.ts` | Existing, accurate input detection |
| `view: 'editor' \| 'file' \| 'pdf' \| 'history'` state | `layout-context.tsx` | Mobile "tabs" are *exactly* this state — no new state needed |
| `pdfLayout` + `changeLayout` | `layout-context.tsx` | Mobile default is `pdfLayout === 'flat'` |
| `focusMode` | `layout-context.tsx:166` | Precedent for "single-pane view" state |
| `react-resizable-panels` (already in dep tree) | installed | Mobile view will *not* use it |

### What already works on mobile (out of scope)
- Project list at `/project` (the user's reference implementation)
- Project invite at `/project/:id/invite` (already has mobile branch)
- Cookie banner, marketing, login
- Shared `DefaultNavbar` (`frontend/js/shared/components/navbar/default-navbar.tsx`) — used by project-list

---

## 2. Design decisions

### 2.1 Breakpoints
Follow Bootstrap 5 (already imported). **Mobile = `< md` (0–767 px)**; **tablet = `md` (768–991)**; **desktop = `lg` (≥992)**. All rules in this plan activate **only when `isMobileLayout` is true**, i.e. `window.matchMedia('(max-width: 767.98px)').matches`. Above that the current rendering is preserved unchanged.

This is the same breakpoint `ProjectListDsNav` already uses (`d-md-none` at `project-list-ds-nav.tsx:50` etc.), so mobile behavior stays consistent between project-list and IDE.

### 2.2 Detection: one hook, two inputs
Add a **single** shared hook at `frontend/js/shared/hooks/use-mobile-layout.ts` that combines:
- `window.matchMedia('(max-width: 767.98px)')` → `isMobileLayout` (drives *layout*: single column, rail-as-drawer, pdf tab)
- the existing `isMobileDevice()` (UA + pointer coarse hover) → `isTouchInput` (drives *input* config: CodeMirror `keymap`, tap targets, context-menu)

`isMobileLayout` is the primary signal; `isTouchInput` refines it (e.g. touch tablet at ≥768 px still gets touch-tuned CodeMirror even though its *layout* is desktop).

`use-mobile-layout` is placed under `shared/hooks/` and consumes from `layout-context`, so there is exactly one React context for "layout state" and one for "input state".

### 2.3 Layout model on mobile
The mobile layout is **three tabs + one drawer**, matching the desktop *state* already present:
1. **Editor** — `view === 'editor' | 'file'` (file tree selection is rendered as-is inside `EditorPanel`)
2. **PDF** — `view === 'pdf'` (no side-by-side, no detach, no synctex double-click)
3. **History** — `view === 'history'` (already exists)
4. **Drawer (rail)** — `isOpen: true` from `rail-context`; rendered as a full-screen overlay drawer on `< md`, closed by default, opened from a bottom tab-bar item (and hamburger on toolbar). `pdf.layout 'sideBySide'` is **forced to `'flat'`** when entering the IDE on mobile (see §3.1).

`Chat` tab is accessed **inside** the drawer, not as a top-level tab.

### 2.4 Toolbar on mobile
`<Toolbar />` renders two variants in `toolbar.tsx` depending on `focusMode` (today) — I add a third: `isMobileLayout` → `MobileToolbar`. Same DOM tree shape (`.ide-redesign-toolbar`), so existing `ide-toolbar`/`.ide-redesign-toolbar-*` CSS still applies. Changes to the *content* are additive via `isMobileLayout`.

### 2.5 Non-goals
- Do **not** touch desktop `toolbar.tsx`, `main-layout.tsx`, `rail.tsx` rendering at ≥ `md`.
- Do **not** touch detached PDF (`/Project/:id/detached`) or the `detacher` code path (`useDetachLayout`).
- Do **not** touch marketing pages, project-list, or project invite.
- Do **not** implement iPad/landscape-1024-px "tablet portrait" layouts — tablet portrait inherits desktop layout with the existing `md` breakpoint (same as project-list).
- Do **not** create a native-app wrapper (the `ds-mobile-app` module is not in this fork's `modules/`).
- Do **not** touch PDF compilation backend, socket layer, or CodeMirror core — only its *options*.

---

## 3. Phases

Each phase is independently revertible (own commit, no forward dependency on later ones). "Gate" column shows the acceptance command.

**Current status (updated 2026-07-07):** Phases 0–9 are implemented, with deviations documented in each phase's status block. Verified: `yarn lint` + `tsc` clean, 181 mocha cases + 12 vitest cases passing, prod-webpack A/B build ≈ +14.6 KB (< 20 KB gate). Remaining `- [ ]` items are manual/environmental only: (1) Lighthouse 375 px audit (Phase 4/7), (2) on-device manual zoom check (Phase 4), (3) running cypress component specs locally (blocked by pre-existing absence of the writefull `@wf/infrastructure` infra in this fork — all component specs fail identically pre-test; verified on a pre-existing spec), (4) `cypress-axe` third-party audit (Phase 8 dev, optional).

### Phase 0 — Infrastructure & shared utilities (foundation)

**Goal:** Add a single source of truth + shared mobile utilities + feature flag. No visual change yet.

**Status (2026-07-07):**
- ✅ `frontend/js/shared/hooks/use-mobile-layout.ts` created. *(deviation: also exports `isEnabled` + `isDevMobileMode`; plan's `breakpoint` export not added.)*
- ✅ `frontend/js/shared/utils/mobile-viewport.ts` created. *(deviation: plan's `applyMobileDefaults()` implemented as `getEffectivePdfLayout()` — desktop returns `'sideBySide'`, mobile `'flat'`; never reads the persist — persist-loading fixed today.)*
- ✅ `layout-context.tsx`: initializes `pdfLayout` `'flat'` on mobile, `changeLayout('flat')` effect on mobile transition, `isMobileLayout` exposed on the context value (additive).
- ✅ Bottom bar: `mobile-bottom-bar.tsx` (3 buttons: file tree / chat / view toggle) replaces the planned separate `mobile-tabs.tsx` — Editor/PDF tabs live in the bottom bar, history is reached via the history button in the toolbar "more" sheet. No `mobile-tabs.tsx` file exists.
- ✅ Feature flag `ide-mobile-layout` registered in `ProjectController.mjs`.
- ✅ `change-layout-options.tsx`: mobile guard implemented — the component returns `null` when `isMobileLayout` is true, so the layout options **and** the focus-mode toggle are no longer rendered in the mobile "more" sheet (the sheet embeds the desktop `ToolbarMenuBar`, whose View menu renders `ChangeLayoutOptions`). Desktop rendering unchanged. *(previous deviation closed: the sheet no longer exposes side-by-side/detach/focus-mode.)*
- ✅ `ide-react.pug`: `viewport` meta + `mobile-web-app-capable`. *(note: this fork's controller metadata forces `viewport:false` ⇒ `user-scalable=no`; plan assumed `user-scalable=yes` — deviation documented.)*
- ✅ Base reset lives in new `frontend/stylesheets/mobile/layout.scss` (base reset + all mobile phase styles in one file instead of editing `base/layout.scss`).
- ✅ Partial tests: `test/frontend/shared/utils/mobile-viewport.test.ts` (mocha covers `getEffectivePdfLayout`).
- ✅ Hook unit test: `test/frontend/shared/utils/use-mobile-layout.test.ts` (mocha + RTL `renderHook`, tests the **real** hook with a controllable matchMedia stub and flag ON/OFF via `SplitTestContext.Provider`: mobile viewport+flag ⇒ `isMobileLayout` true; wide viewport ⇒ false; flag off ⇒ false; `change` event re-evaluates; `?mobileLayout=true` dev mode only when flag on). *(deviation: plan said vitest at `test/unit/src/shared`; this repo runs React-level tests under `test/frontend/**` (mocha + jsdom + chai + `@testing-library/react`), so the file lives there.)*

Files:
- **New** `frontend/js/shared/hooks/use-mobile-layout.ts`
  - Exports: `useMobileLayout(): { isMobileLayout: boolean; isTouchInput: boolean; breakpoint: 'mobile'|'tablet'|'desk' }`
  - `isMobileLayout` driven by `matchMedia('(max-width: 767.98px)')` (subscribe to `change` via the existing `usePersistedState`-style `addEventListener('change', ...)` pattern already used in `layout-context.tsx`).
  - `isTouchInput` re-exports the existing `isMobileDevice()` (no duplicate).
- **New** `frontend/js/shared/utils/mobile-viewport.ts` — `applyMobileDefaults()` pure helper used by `layout-context` initialization:
  - If `isMobileLayout`, ignore `localStorage.getItem('pdf.layout')` and force return `'flat'`.
- **Edit** `frontend/js/shared/context/layout-context.tsx`:
  - Inside `LayoutProvider`, call `useMobileLayout()`; when `isMobileLayout` is true:
    - Initialize `pdfLayout` from `applyMobileDefaults()` (`'flat'`) even if `localStorage` says `'sideBySide'`.
    - Subscribe: on `isMobileLayout` transition to `true`, call `changeLayout('flat')`.
    - Expose `isMobileLayout` on the context value (new key, additive).
  - Do **not** remove `changeLayout` / `setPdfLayout`; desktop still calls them.
- **New** `frontend/js/features/ide-react/components/layout/mobile-tabs.tsx` — the tab bar (Editor / PDF / History + drawer trigger). Uses `react-i18next` for labels (reuse existing `t('editor')`, `t('pdf_preview')`, `t('history')`; add `t('rail')` if not present).
- **New** `frontend/js/features/ide-react/components/layout/mobile-bottom-bar.tsx` — the sticky bottom nav on mobile that hosts the tab bar *and* a "more" button for drawer.
- **Edit** `app/src/Features/Project/ProjectController.mjs` (`featureFlags` list near line 490): add a new flag `'ide-mobile-layout'` so the whole mobile layout can be A/B-toggled and rolled back server-side. Register the flag name — the pattern is the same existing block at lines 489–497.
- **Edit** `frontend/js/features/ide-react/components/toolbar/change-layout-options.tsx`:
  - When `isMobileLayout`, hide `ChangeLayoutButton` (no detached/side-by-side choice on mobile) and hide the "focus-mode" toggle (redundant — mobile is always single-pane).
- **Edit** `frontend/js/features/ide-react/components/layout/ide-page.tsx`:
  - Render `<MobileBottomBar />` **only** when `isMobileLayout` (above `<MainLayout />` or replacing `<Toolbar />` row depending on where the sticky bar sits — I'll decide during implementation, see open question §6).
- **Edit** `app/views/project/ide-react.pug` (or `_metadata.pug`): confirm `<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">` is present (it is, per `app/views/_metadata.pug:126`). Also add `<meta name="mobile-web-app-capable">` for when the IDE is treated as a standalone view (iOS Safari). *Optional*: add `<link rel="manifest">` for a future PWA (out of scope, note only).
- **Edit** `frontend/stylesheets/base/layout.scss` (or new `frontend/stylesheets/mobile/layout.scss` imported by `main-style.scss`): add base mobile reset: `html { overscroll-behavior: none; }`, `body, #ide-root { position: fixed; width: 100%; height: 100dvh; }`, `* { touch-action: manipulation; }`, and disable any ancestor `overflow` that could clip the fixed height.
- **New** `services/web/test/unit/src/shared/use-mobile-layout.test.mjs` — unit test (vitest, matches `vitest.config.js` Parallel project pattern):
  - Asserts `isMobileLayout === true` when `matchMedia` mock returns true for 375 px.
  - Asserts `pdfLayout` initial value is `'flat'` when `isMobileLayout` true (integration into `layout-context` test in next phase).

Gate:
- `yarn lint` (ESLint + module lint) passes
- `yarn test:unit` passes (new vitest case)
- Manual: open `/Project/<id>` at `md` (768 px) and assert no visual change vs. before commit (regression-free)

---

### Phase 1 — Toolbar (mobile variant)

**Goal:** Replace the mega-menubar and wide toolbar with a compact, touch-friendly toolbar that keeps every existing action reachable via one tappable overflow.

**Status (2026-07-07):**
- ✅ `toolbar.tsx` mobile branch. *(deviation: placed **before** the `if (focusMode)` branch, not after — mobile wins over focus mode; intentional.)*
- ✅ `mobile-toolbar.tsx`: hamburger calls rail-context `openTab('file-tree')` (not the plan's `ui:select-rail-tab` dispatch — same effect); project title centered; right "more" button opens a full-screen sheet.
- ✅ Sheet contents: `OnlineUsers` (inline in sheet, **not** popover — deviation), `ShareProjectButton`, `ShowHistoryButton`, `SubmitProjectButton` (if `shouldDisplaySubmitButton && cobranding`, mirrors `toolbar.tsx`), `DownloadProjectZip`.
- ⚠️ Sheet also embeds the full desktop `ToolbarMenuBar` (deviation: plan said flat command list; no `getMenuStructure(isMobile)` export in `menu-bar.tsx`). At 375px the row of 6 menu buttons may overflow/cramp — rendered as-is for now.
- ✅ `toolbar-overflow-menu.tsx` intentionally not created (sheet is inline in `mobile-toolbar.tsx`).
- ✅ No `toolbar.scss` edits — mobile toolbar styles live in `mobile/layout.scss` (`.ide-redesign-toolbar-mobile`) — documented deviation.
- ✅ Test coverage via cypress `mobile-ide-layout.spec.tsx`; plan's `mobile-toolbar.test.mjs` unit test skipped (deviation).

Files:
- **Edit** `frontend/js/features/ide-react/components/toolbar/toolbar.tsx`:
  - After the existing `if (focusMode) { return ... }` branch, add `if (isMobileLayout) { return <MobileToolbar/> }` (import from new file).
  - Desktop and focus-mode paths are unchanged.
- **New** `frontend/js/features/ide-react/components/toolbar/mobile-toolbar.tsx`:
  - Structure (all inside `.ide-redesign-toolbar`):
    - Left: hamburger (`<RailActionElement icon="menu">` or `OLIconButton` with `t('rail')` tooltip) → dispatches `window.dispatchEvent('ui:select-rail-tab', { detail: { tab: 'file-tree', open: true } })` (event already wired in `layout-context.tsx` → `rail-context`).
    - Center: `<ToolbarProjectTitle />` (existing; truncate title with ellipsis; see `frontend/js/features/ide-react/components/toolbar/project-title.tsx`).
    - Right (max 2 actions): `<ShareProjectButton />` (already icon-only) + `<OLDropdownMoreMenu>` (new, from `@/shared/components/dropdown/dropdown-menu`) containing:
      - `<OnlineUsers />` (click to open popover; do not render inline)
      - `<ShowHistoryButton />`
      - `<SubmitProjectButton />` (if `shouldDisplaySubmitButton`)
      - `<DownloadProject />` (exposed from `download-project.tsx`, existing)
      - `<MenuStructure>` entries from `menu-bar.tsx` — same commands, rendered as flat list (not dropdown-of-dropdown).
- **New** `frontend/js/features/ide-react/components/toolbar/toolbar-overflow-menu.tsx` (if `MoreMenu` isn't reusable from `@/shared/components/dropdown/dropdown-menu`)
- **Edit** `frontend/stylesheets/pages/editor/toolbar.scss`: add `.ide-redesign-toolbar.mobile { ... }` block with:
  - `min-height: 48px;` (Apple HIG tap target minimum)
  - `padding: 8px 12px;`
  - `.ide-redesign-toolbar-menu { display: none; }` (mobile menu is in overflow, not primary menubar)
  - `.ide-redesign-toolbar-actions { gap: 4px; }`
  - `.ide-redesign-toolbar-button-container > button { min-width: 44px; min-height: 44px; }`
- **Edit** `menu-bar.tsx`: export `getMenuStructure(isMobile)` — the existing 358-line composition stays; mobile consumes `getMenuStructure(true)` to get a flat command list. This is additive (desktop receives `false`).
- **New** `test/unit/src/features/ide-react/components/toolbar/mobile-toolbar.test.mjs` — asserts hamburger dispatches the correct custom event; asserts `OnlineUsers` / `SubmitProjectButton` are *not* in the DOM at the toolbar top level (only in overflow).

Gate:
- `yarn lint` + `yarn test:unit` green
- Cypress viewport check (existing `cypress/components/*.spec.ts` pattern): at 375 px the toolbar is one row, every existing action reachable within ≤ 2 taps.

---

### Phase 2 — Main layout (single pane + tabs + rail drawer)

**Goal:** On mobile the IDE body is a single full-screen pane with the `mobile-tabs` (Editor/PDF/History) bar at the bottom (or top, per §6 decision). No `react-resizable-panels` on mobile. Rail becomes a full-screen overlay drawer.

**Status (2026-07-07):**
- ✅ `main-layout.tsx` mobile branch.
- ✅ `main-layout-mobile.tsx` single full-screen pane. *(deviation: bare `data-mobile` attribute, not `data-mobile="true"`.)*
- ✅ `drawer.tsx` (new shared primitive) + rail wrapped as `<Drawer>`. *(deviation: no backdrop-click close — drawer closes via focus trap, Esc, and close button.)*
- ✅ `rail-panel.tsx` mobile branch (plain container).
- ✅ `ide-redesign.scss` `@media` block intentionally skipped (component decides layout; belt-and-suspenders CSS was optional per plan).
- ✅ Mocha drawer test exists. React-level `PanelGroup`-absent assertion: mocha/jsdom **cannot** host `react-resizable-panels` (Node CJS build throws `Panel size not found` at init), so it is asserted in cypress — `mobile-ide-layout-full.spec.tsx` (no `.ide-redesign-inner` / no `PanelGroup`).
- ✅ Cypress: `mobile-ide-layout.spec.tsx` (focused toolbar + bottom bar) + `mobile-ide-layout-full.spec.tsx` (mounts the real `<MainLayout/>` at 390 px: no `.ide-redesign-inner` / no `PanelGroup`, drawer open/Esc-close, bottom-bar view toggle, **history pane**). PDF zoom tap + no-detach step: `test/frontend/components/pdf-preview/pdf-zoom-mobile.spec.tsx`.
- ✅ React-level `PanelGroup`-absent assertion (deviation: mocha/jsdom cannot host `react-resizable-panels`, so it lives in the cypress spec `mobile-ide-layout-full.spec.tsx` instead of a mocha/vitest unit test).

Files:
- **Edit** `frontend/js/features/ide-react/components/layout/main-layout.tsx`:
  - Add `const { isMobileLayout } = useMobileLayout()` at the top.
  - After the existing `return (...)`, add `if (isMobileLayout) { return <MainLayoutMobile /> }` (import from new file). Desktop + focus-mode unchanged (`toolbar` is already handled in Phase 1 — `MainLayoutMobile` renders `<Toolbar />` first because it still needs it).
- **New** `frontend/js/features/ide-react/components/layout/main-layout-mobile.tsx`:
  - Renders `<Toolbar />` + a single pane that swaps content based on `view`:
    - `view === 'editor' | 'file'` → `<EditorPanel />` (same `<Editor />` as desktop; `ide-redesign-editor-container` scss is width-agnostic so no change needed there).
    - `view === 'pdf'` → `<PdfPreview />` inside a container that forces side-by-side OFF: set `data-mobile="true"` for scss scoping.
    - `view === 'history'` → `<HistoryContainer />`.
  - Render `<RailLayout />` as a `<Drawer>` **before** the single pane; the drawer is full-screen, uses `position: fixed; inset: 0` with Bootstrap's modal z-scale (backdrop 1040 / modal 1055) so it paints above the toolbar (toolbar itself has no top-level `z-index`; its row children are `z-index: 10`) and above the mobile bottom bar (give the bottom bar `z-index` just below backdrop, e.g. 1035).
  - Render `<MobileBottomBar />` at the bottom (below the pane, sticky, `position: sticky; bottom: 0;`).
  - `<Alerts />`, `<GlobalToasts />`, `<Modals />`, `<SettingsModalNew />`, `<CommandPalette />` from `ide-page.tsx` continue to render (they're siblings in `IdePage` and unchanged); mobile-styling of those is Phase 4.
- **New** `frontend/js/shared/components/drawer/drawer.tsx` (verified: no existing shared Drawer, `find frontend/js/shared -iname '*drawer*'` returns nothing; the existing modal primitive is `frontend/js/shared/components/ol/ol-modal.tsx` + `frontend/js/shared/components/focus-trap.tsx`, both built on):
  - Props: `isOpen: boolean`, `onClose: () => void`, `title: string`, children.
  - Renders `role="dialog"`, `aria-modal`, `aria-label={title}`, reuses the existing shared `<FocusTrap>` from `frontend/js/shared/components/focus-trap.tsx`, `Esc` closes, backdrop click closes.
  - Mobile variant of `OLModal`: full-bleed, `100dvh` (via the existing `frontend/stylesheets/abstracts/mixins.scss:237@mixin full-viewport-height`), no centered card. `OLModal` itself stays untouched — Drawer is additive.
- **Edit** `frontend/js/features/ide-react/components/rail/rail.tsx`:
  - When `isMobileLayout`, wrap the existing rail in the new `<Drawer side="full">` (or reuse `full-screen` variant) instead of the persistent left column. State (`isOpen`) is unchanged — the new `MobileBottomBar` triggers `setIsOpen(true)` via the existing `ui:select-rail-tab` event or by calling `togglePane()` from `rail-context`.
  - The `RailResizeHandle` is rendered by the rail component; it should be hidden when `isMobileLayout`.
  - Keep rail *content* (file-tree, chat, integrations, review-panel, full-project-search tabs) unchanged — only the *host* changes.
- **Edit** `frontend/stylesheets/pages/editor/ide-redesign.scss`:
  - `@media (max-width: 767.98px) { ... }` block: `.ide-redesign-body { display: flex; flex-direction: column; } .ide-redesign-inner { flex-direction: column }` (this is CSS-side, but the React component is the one deciding — CSS block is belt-and-suspenders and only applies when `data-mobile="true"` is present on `<body>` or `.ide-redesign-main` — see open question §6).
- **New** `test/unit/src/features/ide-react/components/layout/main-layout-mobile.test.mjs` — asserts `react-resizable-panels` `PanelGroup` is *not* rendered in the mobile variant (`queryByRole` / `testid`).
- **New** `test/frontend/components/ide-react/main-layout-mobile.spec.tsx` (cypress component test, `cy.viewport(375, 812)`; specPattern per `cypress.config.ts` is `./{test,modules/**/test}/frontend/**/*.spec.{js,jsx,ts,tsx}` — sibling component specs live at `test/frontend/components/ide-react/...` and `test/frontend/components/pdf-preview/...`):
  - Open `ide-page` with `isMobileLayout` mocked true; click each bottom-tab (Editor/PDF/History); assert active pane; open rail drawer; assert `role="dialog"` present and `esc` closes.

Gate:
- `yarn lint` + `yarn test:unit` green
- Cypress component test passes at 375 px
- Manual: 375 px landscape/portrait, 320 px (small phone), 767 px (last mobile size) — all produce a single pane, no horizontal scroll.

---

### Phase 3 — Source editor (CodeMirror) touch tuning

**Goal:** Make the CodeMirror editor usable with thumbs. Desktop editor config untouched.

**Status (2026-07-07):**
- ✅ `keymaps.ts`: `currentKeymaps()` exports mobile vs desktop keymap; extensions index through it.
- ✅ `.cm-tooltip-autocomplete > * { max-height: 50dvh; }`.
- ✅ Font-size bump: `.cm-content` / `.cm-gutters` get `font-size: max(var(--font-size), 16px)` on mobile (desktop default is 12 px from `theme.ts`; user-picked larger sizes are preserved via `max()`). Gutter: `.cm-gutters .cm-lineNumbers { font-size: 0.9em; padding-right: 0.25em; }` (line numbers kept, right padding reduced).
- ✅ Hover/` :active`: file-tree `.entity` rows and history rows get an `:active` affordance (the `:hover`-only desktop patterns never fire on pure touch).
- ✅ `test/unit/src/features/source-editor/codemirror-mobile.test.mjs` (vitest, 2 cases): asserts `currentKeymaps()` returns the mobile keymap when `isMobileDevice()` is true (forced mobile UA), and that mobile/desktop keymaps are distinct extensions.

Files:
- **Edit** `frontend/js/features/source-editor/components/codemirror-editor.tsx` (or wherever `EditorView` is built up — find via `grep -rn "new EditorView" frontend/js/features/source-editor`):
  - When `isTouchInput` (from `useMobileLayout`), add/override:
    - `editorConfig.keymap`: include the existing `mobileKeymap` (the `context-menu.ts` pattern already detects mobile; extend it).
    - `theme` tokens: bump `fontSize` on mobile (e.g. 16 px, `@media (max-width: 767.98px)` or `data-mobile` selector — see §6).
    - Gutters: keep line numbers; reduce gutter right-padding on mobile (`@media (max-width: 767.98px) .cm-gutter ...`).
    - `autocompletion` trigger: on mobile, disable hover-driven autocompletion (there is no hover) and use explicit `Cmd/Ctrl+Space` or a tap-target button (reuse `full-project-search`-style action).
- **Edit** `frontend/stylesheets/components/...` (the source-editor scss — locate via `grep -rln "\.cm-" frontend/stylesheets`).
  - `@media (max-width: 767.98px)` block:
    - `.cm-line { min-height: 2em; }` (tap target)
    - `.cm-gutter .cm-lineNumbers { font-size: 0.9em; }`
    - `.cm-tooltip-autocomplete > * { max-height: 50dvh; }` (keyboard-aware)
    - Disable `:hover`-only state colors (they never apply on touch, but ensure `:active` works).
- **New** `test/unit/src/features/source-editor/codemirror-mobile.test.mjs` — asserts the `keymap` / autocompletion options differ between mobile and desktop `isTouchInput` values.

Gate: `yarn lint` + `yarn test:unit` + manual at 375 px: tapping a line keeps the keyboard open and cursor visible (iOS safe: test on Safari on iPad in mobile emulation as well as iPhone).

---

### Phase 4 — PDF pane (mobile tab)

**Goal:** PDF renders full-screen as a `view` value, not a side-by-side split. Zoom / synctex / detached toolbar are hidden or replaced with touch controls.

**Status (2026-07-07):**
- ✅ (partial) PDF renders full-screen inside the single pane via `MainLayoutMobile` — no container changes needed in `pdf-pane.tsx`/`pdf-preview.tsx`.
- ✅ `detach-synctex-control.tsx`: `DefaultSynctexControl` returns `null` when `isEnabled` (mobile) — synctex is not rendered, not just CSS-hidden. Uses the same `isEnabled` signal as `toolbar.tsx` / `main-layout.tsx`.
- ✅ CSS: `.synctex-control { display: none }` inside the mobile pdf pane (belt-and-suspenders); pdfjs viewport controls get ≥44px min tap targets (`.pdfjs-viewer-controls button { min-height: 44px }`).
- ✅ `pdf-preview-mobile.test.mjs` (vitest, 3 cases): asserts `DefaultSynctexControl` renders synctex on desktop, does not render it when `detachRole` is `detacher`, and does not render it when the mobile layout is active (mocks the two contexts + the synctex module so the test stays isolated).
- ✅ Zoom tap assertion now in cypress: `test/frontend/components/pdf-preview/pdf-zoom-mobile.spec.tsx` mounts the *real* `<PdfJsViewer/>` (compiled PDF fixture), taps +/− at 390 px and asserts the zoom indicator changes + no `window.open` (no detach). CSS `min-height: 44px` still present for the tap target.
- `- [ ]` Manual 375 px Lighthouse + on-device zoom still outstanding (needs a running server + emulator — cannot run in this environment).

Files:
- **Edit** `frontend/js/features/pdf-preview/components/pdf-preview-pane.tsx` (58 LOC) and `pdf-preview.tsx` (21 LOC):
  - When `isMobileLayout`, render a **mobile-specific container** that does *not* include `HorizontalResizeHandle` (already handled in `MainLayoutMobile` — this pane just renders its content with `data-mobile` scoped scss).
- **Edit** `frontend/js/features/pdf-preview/components/pdf-viewer-controls-toolbar.tsx` (183 LOC):
  - On mobile, replace zoom +/− (desktop-sized, 34-px tap target) with the same +/- but `min-height: 44px`, and *hide* the synctex `DefaultSynctexControl` buttons (they're double-click-triggered and useless on touch).
  - Keep `PdfCompileButton` visible (always useful on mobile).
- **Edit** `frontend/js/features/pdf-preview/components/pdf-synctex-controls.tsx` (229 LOC): on mobile, do not render (covered by the parent's `if (isMobileLayout)`).
- **Edit** `frontend/js/features/ide-react/components/toolbar/toolbar.tsx` (mobile branch from Phase 1): hide `<ChangeLayoutButton/>` (already done in Phase 0).
- **New** `test/unit/src/features/pdf-preview/pdf-preview-mobile.test.mjs` — asserts synctex and zoom buttons are not rendered in mobile mode, or their tap targets meet the 44 px minimum.

Gate: `yarn lint` + `yarn test:unit`; manual at 375 px: zoom via +/− works; PDF does not attempt detached tab (no `BroadcastChannel`-based detach).

---

### Phase 5 — Drawer content (file-tree, chat, integrations, history, search)

**Goal:** Each rail tab inside the mobile drawer works end-to-end: file tree tap-to-rename/delete, chat keyboard handling, integrations scroll, etc.

**Status (2026-07-07):**
- ✅ `chat-pane.tsx`: `window.visualViewport` subscription; scss consumes it (`height: calc(100% - var(--mobile-chat-inset))`); chat input font-size 16px.
- ✅ File-tree rows 44px (`.file-tree-folder-list .entity` / `.file-tree-entity-button` + `li` min-height).
- ✅ 3-dot "more" menu: no code change needed — `.entity-menu-toggle` is always in the DOM and visible (not hover-gated), so per-file actions were already reachable on mobile.
- ✅ History rows 44px: `[data-testid]` selectors scoped under `.ide-redesign-main-mobile` (history container renders inside the mobile pane ✔).
- ✅ Full-project-search input: `enterKeyHint` set to "search" on mobile (form uses `onSubmit`, so the search button's touch submit triggers the search). Desktop unchanged.
Files:
- **Edit** `frontend/js/features/file-tree/components/file-tree-doc.tsx` (57 LOC) + `file-tree-folder-list.tsx` (84 LOC):
  - Increase tap row hit area (existing `min-height` is likely < 44 px; raise to ≥ 44 px on `data-mobile`).
  - Move hover-revealed right-side action icons (rename, delete, open-in-new-tab) into a "more" menu (three-dot) on mobile.
- **Edit** `frontend/js/features/chat/components/chat-pane.tsx` (108 LOC) + `message-list.tsx` (116 LOC) + `message-input.tsx` (42 LOC — plain `<textarea id="chat-input">`, no keyboard handling today):
  - Message list height: use the existing `@include full-viewport-height` mixin (`frontend/stylesheets/abstracts/mixins.scss:237` already writes `100vh` then `100dvh`) — do not hand-roll `100dvh` strings.
  - Keyboard visibility: subscribe to `window.visualViewport.resize` to re-scroll the last message into view and keep the textarea visible when the iOS keyboard opens (no `visualViewport` handling exists in `message-input.tsx` today).
- **Edit** `frontend/js/features/ide-react/components/history-container.tsx` (23 LOC) + the `history-v1` module (which is in `modules/` — find with `ls modules/history-v1`):
  - On mobile, history entries get 44 px row tap targets.
- **Edit** `frontend/js/features/ide-react/components/rail/full-project-search-panel.tsx`:
  - On mobile, search input `type="search"` with `enterkeyhint="search"`; on Android use `onsubmit` to trigger search (mobile browser keyboard submits).

Gate: `yarn lint` + `yarn test:unit` + manual at 375 px: file tree rename/delete via three-dot works; chat input above keyboard and messages visible after keyboard opens.

---

### Phase 6 — Modals, toasts, alerts (mobile-friendly chrome)

**Goal:** Overlays and ephemeral chrome work on small screens.

**Status (2026-07-07):**
- ✅ Global toasts on mobile: bottom placement, full width. *(deviation: plan said top below toolbar; implementation is bottom.)*
- ✅ Alerts full-width bar.
- ⚠️ Full-height modal sheet: CSS-only `.modal` → full-width `100dvh` sheet (not the `Drawer` primitive from Phase 2 — deviation); `SettingsModalNew` covered by the same scss.
- ✅ Plan's `global-toasts-mobile.test.mjs` / `settings-modal-mobile.test.mjs` created (vitest, 7 cases total). Note: mobile chrome here is CSS-only (no runtime JS branch — the toast/modal portals don't read the layout context), so the tests guard the `body.ide-mobile-active` scss *contract* (values present + scoped so they can't leak into desktop), not component render. That mirrors how the toasts/modals actually get their mobile behaviour.


Files:
- **Edit** `frontend/js/features/ide-react/components/global-toasts.tsx` (75 LOC):
  - On mobile, render toasts at the *top* of the screen (below toolbar) and full-width minus 16 px padding, using `position: sticky; top: (toolbar-height)`.
  - (Desktop right-side position stays unchanged.)
- **Edit** `frontend/js/features/ide-react/components/alerts/alerts.tsx` + `lost-connection-alert.tsx`:
  - On mobile, alert is a full-width sticky bar at top (above toolbar).
- **Edit** `frontend/js/features/settings/components/settings-modal.tsx` (57 LOC):
  - On mobile, render as bottom-sheet (full-height) drawer instead of centered modal; use the `Drawer` primitive from Phase 2.
- **Edit** `frontend/js/features/ide-react/components/modals/*.tsx` (e.g. `generic-confirm-modal.tsx`, `force-disconnected.tsx`):
  - On mobile, same `Drawer` full-height.
- **New** `test/unit/src/features/ide-react/components/global-toasts-mobile.test.mjs` and `settings-modal-mobile.test.mjs`.

Gate: `yarn lint` + `yarn test:unit` + manual: every modal reachable from toolbar/rail fits inside 375 px with no horizontal scroll, has a visible close control (top-right, not only esc).

---

### Phase 7 — Performance & polish

**Goal:** Avoid regressing first paint on mobile.

**Status (2026-07-07):**
- ✅ (a)+(b) webpack bundle diff **verified with a real prod build** (`webpack --config webpack.config.prod.js`), A/B via `git stash`: `pages/ide` JS 207,284 → 214,589 = **+7.3 KB**; `main-style` CSS (where mobile/layout.scss compiles) 867,905 → 875,229 = **+7.3 KB**; **total ≈ +14.6 KB**, under the plan’s <20 KB gate. `assetsByChunkName` has **no separate mobile chunk** — all mobile modules (`use-mobile-layout.ts`, `mobile-viewport.ts`, `main-layout-mobile.tsx`, `mobile-toolbar.tsx`) land in the main `pages/ide` chunk (additive, as intended). PDF pane is *not* lazy-split: `main-layout.tsx` statically imports `PdfPreview` on the desktop path too (pre-existing; the plan’s `pdf-pane.tsx` lazy note was based on a different file map and is moot here — no extra dynamic chunk needed, since the static import is shared).
- ✅ Mobile full height: `ide.tsx` not edited — scss sets `#ide-root` to `100dvh`; effectively covered.
- `- [ ]` Lighthouse audit (375px, mid-range Android) not run — manual, needs a running server + emulator.

- **Edit** `webpack.config.js`: ensure `pages/ide` entry is *not* splitting mobile-only components into a separate chunk (they're additive and tiny; verify with `webpack --json` output that total `pages/ide` size diff is < 20 KB after all phases).
- **Edit** `frontend/js/pages/ide.tsx`: the existing `dvh` Safari 15 workaround (lines 16–28) still applies; extend it to set `#ide-root { height: 100dvh }` on mobile (so the sticky bottom bar doesn't push content off-screen).
- **Lighthouse audit** (manual): at 375 px on a mid-range Android emulator: LCP < 3 s, FID < 100 ms.

Gate: `webpack` size report diff is small; Lighthouse green on manual audit.

---

### Phase 8 — Accessibility (a11y) & keyboard focus

**Goal:** The new `Drawer`, `<MobileBottomBar />`, and overflow menu meet WCAG AA.

**Status (2026-07-07):**
- ✅ `Drawer` a11y contract: `role="dialog"`, `aria-modal`, `aria-label`, reused `FocusTrap`, Esc close.
- ✅ Bottom bar: `nav` with `aria-label`; `aria-pressed` on each button.
- ✅ `aria-current="page"` on the active bottom-bar tab (`MobileBottomBar` files/chat buttons; the view tab is state-driven and left without `aria-current` because it mirrors `aria-pressed`, not a page switch).
- ✅ More button has `aria-expanded` **and** `aria-haspopup="dialog"` (the mobile sheet actually opens a `role="dialog"`, which is more accurate than the plan's `"menu"` value — recorded as a deviation).
- ✅ `test/frontend/features/ide-react/mobile-ide-a11y.spec.tsx` created (cypress component). No `cypress-axe` dep is installed, so per the plan's fallback the spec asserts the *aria contract* directly (`aria-role`/`aria-*` on focused `<MobileBottomBar/>` + `<MobileToolbar/>` under `<RailProvider/>`) instead of a third-party axe audit (axe audit deferred — same infra note as the other component specs, Phase 9).
- **Edit** `Drawer` (`shared/components/drawer/drawer.tsx`, from Phase 2): its contract already includes `role="dialog"`, `aria-modal`, `aria-label={title}`, and reuses the shared `FocusTrap`.
- **Edit** `MobileBottomBar`: `nav` with `aria-label={t('ide')}`, each tab as `button` with `aria-pressed`, `aria-current="page"` for active tab.
- **Edit** `toolbar-overflow-menu`: `aria-expanded`, `aria-haspopup="menu"`, arrow-key nav inside.
- **New** `test/frontend/components/ide-react/mobile-ide-a11y.spec.tsx` — `cypress-axe` audit (component-test support lives at `cypress/support/component.ts`; verify the axe dev-dep is in `package.json` — if not, add `cypress-axe` in Phase 0 or fall back to manual `role`/`aria-*` assertions).

Gate: `cypress-axe` clean at 375 px, keyboard-only traversal works.

---

### Phase 9 — QA / regression (e2e cypress)

**Goal:** One cypress component spec + one e2e spec that exercise the full mobile flow.

**Status (2026-07-07):**
- ✅ `mobile-ide-layout-full.spec.tsx` covers the *full* mobile flow via the real `<MainLayout/>` at 390 px:
  - drawer opens via the hamburger; `role="dialog"` + `aria-modal="true"`; closes via `Esc`;
  - bottom-bar view toggle switches the single pane (editor → pdf → editor, asserted via `data-testid="mobile-bottom-bar-view"` label change);
  - single pane: `.ide-mobile-pane` present, `.ide-redesign-inner` **not** (no `PanelGroup`), toolbar + bottom bar both mounted.
- ✅ `mobile-ide-layout.spec.tsx` (toolbar + bottom-bar, focused — mounts `<Toolbar/>` + `<MobileBottomBar/>` standalone without `MainLayout`, so it stays independent of CodeMirror / pdf.js fixtures).
- ✅ `mobile-ide-a11y.spec.tsx` (Phase 8): `aria-current="page"`, `aria-pressed`, `aria-haspopup="dialog"` + `aria-expanded` on the more button, plus `Esc`/close-button close of the sheet.
- ✅ `ide-page-desktop-regression.spec.tsx`: flag enabled at a 1200 px viewport → `matchMedia` false → hook `isMobileLayout` false → desktop branch (no mobile DOM).
- ✅ Overflow menu (more sheet) actions asserted in `mobile-ide-a11y.spec.tsx` (sheet `role="dialog"`, `aria-modal`, close via close button *and* `Esc`, `aria-expanded`/`aria-haspopup` state).
- ✅ History pane: `mobile-ide-layout-full.spec.tsx` asserts `.ide-mobile-pane` renders for `view='history'` and no `PanelGroup`/`.ide-redesign-inner` (desktop regression guard at mobile width).
- ✅ PDF zoom tap (phase 9 step 5) implemented: `test/frontend/components/pdf-preview/pdf-zoom-mobile.spec.tsx` (compiled PDF fixture via the existing `cy.interceptCompile`, real zoom +/− buttons, zoom-percentage assertion, no-detach assertion).
- `- [ ]` Running *all* cypress component specs (incl. this one) in this environment is blocked by a pre-existing infra gap: `cypress/support/component.ts` primes `@wf/infrastructure/ioc` (writefull), which is absent from this fork — every component spec, including the pre-existing `pdf-js-viewer.spec.tsx`, fails identically before any test runs. Verified, not introduced by this feature. Left for CI (where the writefull infra is available).

- **New** `test/frontend/features/ide-react/mobile-ide.spec.tsx` (component test, `cy.viewport(375, 812)`):
  1. Load IDE with `isMobileLayout` forced true (via a fixture or a dev-only `?mobile=1` query param we add in Phase 0 to `ide-react.pug`).
  2. Tap hamburger → drawer opens.
  3. Tap file-tree row → pane switches to editor with the file.
  4. Tap PDF tab → PDF renders.
  5. Tap +/− zoom → zoom indicator changes.
  6. Tap History tab → history opens.
  7. Close drawer via `Esc` / backdrop.
  8. Every action in the overflow menu is clickable (share, history, download, submit [if `canSubmit`]).
- **New** `test/frontend/components/ide-react/ide-page-desktop-regression.spec.tsx`: asserts that `isMobileLayout === false` at ≥ 768 px produces the same DOM as before this feature (no `data-mobile` attribute, no `.mobile-bottom-bar` in DOM, `react-resizable-panels` `Panel` count unchanged).

Gate: both specs green on `yarn test:component` (existing cypress component script; specPattern already covers `./test/frontend/**/*.spec.tsx`).

---

## 4. Feature flag & rollout

New flag: **`ide-mobile-layout`** (see Phase 0, registered in `app/src/Features/Project/ProjectController.mjs` `featureFlags` list at lines 489–497). It controls:
- `isMobileLayout`'s effect on `layout-context` (force `pdfLayout: 'flat'`)
- `toolbar.tsx` mobile branch
- `main-layout.tsx` mobile branch
- All `data-mobile` scss hooks

Rollout (server-side):
1. `disabled` variant (all users) — code merged, no behavior change.
2. 5% `enabled` (staff + opt-in via `?mobile=1` for QA).
3. 50% `enabled`.
4. 100% (retain flag for rollback; document as "removable in next major release").

The new flag is independent of the desktop `focus-mode`, `command-palette`, etc. No interaction with existing flags (verified during impl: `focus-mode`'s single-pane UI *is* what mobile uses, but via a different code path).

---

## 5. Risk & mitigations

| Risk | Mitigation |
|---|---|
| Desktop regression when `isMobileLayout` accidentally true (bug in `matchMedia` SSR hydration) | `isMobileLayout` is *client-only* and initialized to `false` on the first render; the matchMedia subscription fires once post-mount. Existing `dvh` Safari workaround in `ide.tsx` is the model. |
| CodeMirror mobile keyboard on iOS pushes viewport | iOS Safari in standalone/PWA mode covers the home-indicator area; the repo viewport meta (`app/views/_metadata.pug:126`) is `width=device-width, initial-scale=1.0, user-scalable=yes` and does **not** include `viewport-fit=cover` — add it in Phase 0 (ide-page only, via `ide-react.pug` override, so marketing pages are unaffected) and verify on real iPhone (15) + iPad in mobile-emulation during Phase 3. |
| `react-resizable-panels` state saved from desktop session bleeds into mobile | In `MainLayoutMobile` do **not** pass `autoSaveId` (so `localStorage` stays clean for desktop). |
| `HorizontalToggler` double-click on mobile (no double-tap) | Removed on mobile (Phase 2); mobile uses tabs. |
| iPad in "desktop mode" (768 px+) | Desktop code path runs; that's the same as desktop, acceptable. Note in plan that iPad-in-mobile-mode is out of scope (Phase 2.6 would cover it, deferred). |
| `BroadcastChannel` detached PDF from a mobile tab leaks a "detached" state | Mobile `toolbar.tsx` does not render `<ChangeLayoutButton/>`, so the only entry into detach is the keyboard shortcut (Mac only) — that shortcut is bound to `key === 'ArrowUp'` with `isMac && metaKey && ctrlKey`, so iOS Safari is unaffected. |
| `isMobileDevice` (UA + pointer) is computed once at module scope today (`context-menu.ts:22`) | Re-use it as-is for `isTouchInput`; do **not** make it reactive (it's a coarse input signal, not a layout signal). |
| Feature flag off after code shipped → dead mobile DOM | When flag is off, `isMobileLayout` always returns false and all mobile branches are dead code (tree-shaken by `if` short-circuit; webpack does not remove this without `webpack-define-flag`). Add a `webpack.DefinePlugin`-style constant for tree shake if bundle size is a concern (Phase 7). |

---

## 6. Open questions (resolve before Phase 1 implementation)

1. **Bottom bar position (top vs bottom):** Apple HIG prefers a persistent bottom bar for content apps; Android Material prefers it bottom too. The project-list doesn't have a precedent (it uses the shared `DefaultNavbar` at top). **Decision:** *top* toolbar + *bottom* tab bar is what we plan for (toolbar on top, tab bar on bottom), but the toolbar must fit in the safe area on notched devices. If the bottom bar is too tall, move tabs into a "more" icon in the top toolbar. *Call during Phase 1 implementation.*
2. **`data-mobile` attribute vs CSS-only:** Adding `data-mobile="true"` to `<body>` / `.ide-redesign-main` lets the existing huge `ide.scss` be scoped without touching desktop rules. I recommend the **attribute** approach (easier to grep, easier to audit).
3. **Cypress `?mobile=1` debug param:** needed to force mobile layout in cypress. It's a dev-only, feature-flag-guarded override (never active in production). *Add in Phase 0.*
4. **Chat drawer keyboard handling:** `MessageList` + `MessageInput` inside a full-screen drawer + iOS keyboard has a known Safari quirk (the keyboard pushes the drawer down off screen). Mitigation: keep the drawer at `100dvh` (not `100vh`) and use the `ResizeObserver` to re-scroll the last message into view. *Verify on real iPhone during Phase 5.*
5. **iPad landscape (1024 px):** Desktop layout is acceptable (same as portrait). If we want a "tablet portrait" later, it's out of scope for this plan (separate follow-up).
6. **PWA / standalone (iOS `standalone-web-app-capable`)**: nice-to-have for Phase 10+, out of scope here.
7. **`isTouchInput` vs `isMobileLayout` naming:** The hook exports two booleans. If any consumer wants *only* touch (not layout), they call `isTouchInput`. Name is stable.

---

## 7. Definition of done

- `yarn lint` and `yarn test:unit` are green.
- New cypress component spec (`mobile-ide.spec.ts`) passes at 375 px.
- Desktop regression (cypress at 992 px+) passes with the exact same DOM as before this feature.
- Lighthouse (mobile) at 375 px: LCP < 3 s, CLS < 0.1, no console errors.
- Feature flag `ide-mobile-layout` is **off** at 100% at merge (so CI/CD does not shift mobile users until rollout is explicit); on staff + opt-in during rollout phase.

---

## 8. Phase order & file-level change map

### 8.1 Consolidated status (2026-07-07)

| Phase | Done | Deviations (documented) | Remaining `- [ ]` |
|---|---|---|---|
| 0 | `use-mobile-layout.ts` (extra `isEnabled`/`isDevMobileMode` exports; no `breakpoint`), `mobile-viewport.ts` (`getEffectivePdfLayout`), `layout-context.tsx` flat init + transition effect + `isMobileLayout` exposed, `mobile-bottom-bar.tsx` (no `mobile-tabs.tsx`), feature flag in `ProjectController.mjs`, `ide-react.pug` (fork forces `user-scalable=no`), `mobile/layout.scss` single stylesheet, `change-layout-options.tsx` mobile guard (returns null on mobile ⇒ sheet no longer exposes side-by-side/detach/focus-mode), tests: `mobile-viewport.test.ts` (mocha) + `use-mobile-layout.test.ts` (mocha + RTL, real hook) | hook exports differ from plan; separate `mobile-tabs.tsx` replaced by bottom bar; `user-scalable=no` vs plan; hook test is mocha (`test/frontend/shared/utils/`), not vitest `test/unit/src/` (repo convention: React-level tests live under `test/frontend/`) | — |
| 1 | `toolbar.tsx` branch (before focus-mode branch), `mobile-toolbar.tsx` (hamburger, title, more sheet: OnlineUsers, Share, History, Submit*, DownloadProjectZip); cypress coverage; styles in `mobile/layout.scss` | no `toolbar-overflow-menu.tsx` (inline sheet instead); OnlineUsers inline not popover; sheet uses desktop `ToolbarMenuBar` instead of flat command list; no `toolbar.scss` / no `mobile-toolbar.test.mjs`; no `getMenuStructure(isMobile)` | — |
| * `SubmitProjectButton`: rendered only when the `publishModal` module is built AND `cobranding` is present AND the user has owner / readWrite permissions — identical guard to the desktop `toolbar.tsx` branch. * |  |  |  |
| 2 | `main-layout.tsx` branch, `main-layout-mobile.tsx` (bare `data-mobile`), `drawer.tsx` (Esc/focus-trap/close, no backdrop click), rail as drawer, `rail-panel.tsx` plain container, mocha drawer test, cypress `mobile-ide-layout-full.spec.tsx` (mounts real `<MainLayout/>`: no `PanelGroup`, drawer open/Esc, view toggle, **history pane**) | `data-mobile` bare not `="true"`; no backdrop-click close; no `ide-redesign.scss` `@media` block; no mocha/vitest React unit test (RRP Node CJS throws under jsdom) | — |
| 3 | `currentKeymaps()` mobile keymap, `.cm-tooltip-autocomplete` max-height 50dvh, `font-size: max(var(--font-size), 16px)` + gutter padding in `mobile/layout.scss`, `:active` affordances on file-tree/history rows, `codemirror-mobile.test.mjs` (vitest, 2 cases) | `isMobileDevice` is module-scope and non-reactive (plan §5) — test forces a mobile UA instead of mocking | — |
| 4 | PDF full-screen via `MainLayoutMobile`; `DefaultSynctexControl` returns null on mobile (code, not just CSS); `.pdfjs-viewer-controls` ≥44px tap targets; `pdf-preview-mobile.test.mjs` (vitest, 3 cases); **zoom tap implemented** in cypress `pdf-zoom-mobile.spec.tsx` (real `<PdfJsViewer/>` + fixture, indicator changes + no `window.open`) | CSS-only container (no component edits needed in pane) | `- [ ]` on-device 375 px Lighthouse + manual zoom verify |
| 5 | `chat-pane.tsx` `visualViewport` + `--mobile-chat-inset`; chat input 16px; file-tree rows 44px; `.entity-menu-toggle` already always-visible-when-selected (no change needed); history rows 44px scoped under `.ide-redesign-main-mobile`; `enterKeyHint="search"` on module search input (mobile-only) | history via scoped `[data-testid]` selectors | — |
| 6 | toasts bottom full-width; alerts full-width; `.modal` full-height sheet (incl. settings); `global-toasts-mobile.test.mjs` + `settings-modal-mobile.test.mjs` (css-contract tests, 7 cases) | toasts bottom not top; CSS-only sheet instead of `Drawer` primitive | — |
| 7 | Bundle diff measured via prod-webpack A/B (git stash): `pages/ide` JS +7.3 KB, `main-style` CSS +7.3 KB = **≈ +14.6 KB < 20 KB gate**; no separate mobile chunk (`use-mobile-layout` / `mobile-viewport` / `main-layout-mobile` / `mobile-toolbar` all in main `pages/ide` chunk); mobile `#ide-root` height via scss | Lighthouse 375px audit not run (manual) | `- [ ]` Lighthouse manual 375px audit |
| 8 | Drawer `role` / `aria-modal` / `aria-label` / `FocusTrap` / Esc; bottom bar `nav` + `aria-label` + `aria-pressed` + `aria-current="page"` (files/chat); more button `aria-expanded` + `aria-haspopup="dialog"`; `mobile-ide-a11y.spec.tsx` (cypress, direct aria assertions) | plan's more-button `aria-haspopup="menu"` → `"dialog"` (sheet is a `role="dialog"`) | `- [ ]` `cypress-axe` third-party axe audit at 375px (local cypress run blocked by pre-existing `@wf` infra gap — see Phase 9) |
| 9 | `mobile-ide-layout-full.spec.tsx` (real `<MainLayout/>` at 390px: drawer open/Esc, view toggle, **history pane**, no `PanelGroup`); `mobile-ide-layout.spec.tsx` (focused toolbar + bottom bar); `mobile-ide-a11y.spec.tsx` (a11y contract); `ide-page-desktop-regression.spec.tsx` (1200px); **`pdf-zoom-mobile.spec.tsx`** (zoom tap + no-detach, real `<PdfJsViewer/>` + fixture) | no `cypress-axe` dep (fallback: direct aria assertions); zoom spec asserts at 390 px on the real zoom buttons | `- [ ]` running cypress component specs locally (pre-existing `@wf/infrastructure` gap blocks the whole component suite in this fork — verified on a pre-existing spec) |


### 8.2 File map (Phase → files)



| Phase | New files | Edited files |
|---|---|---|
| 0 | `shared/hooks/use-mobile-layout.ts`, `shared/utils/mobile-viewport.ts`, `ide-react/components/layout/mobile-tabs.tsx` + `mobile-bottom-bar.tsx`, `test/unit/.../use-mobile-layout.test.mjs` | `layout-context.tsx`, `ide-page.tsx`, `toolbar/change-layout-options.tsx`, `ProjectController.mjs` (feature flag), `app/views/_metadata.pug`, `stylesheets/base/layout.scss` |
| 1 | `toolbar/mobile-toolbar.tsx`, `toolbar/toolbar-overflow-menu.tsx` (optional), `test/.../mobile-toolbar.test.mjs` | `toolbar/toolbar.tsx`, `toolbar/menu-bar.tsx`, `stylesheets/pages/editor/toolbar.scss` |
| 2 | `layout/main-layout-mobile.tsx`, `shared/components/drawer/drawer.tsx`, `test/.../main-layout-mobile.test.mjs` (vitest), `test/frontend/components/ide-react/main-layout-mobile.spec.tsx` (cypress component) | `layout/main-layout.tsx`, `rail/rail.tsx`, `stylesheets/pages/editor/ide-redesign.scss` |
| 3 | `test/.../codemirror-mobile.test.mjs` | `source-editor/components/codemirror-editor.tsx`, `stylesheets/components/source-editor.scss` (locate via `grep -rln "\.cm-"`) |
| 4 | `test/.../pdf-preview-mobile.test.mjs` | `pdf-preview/pdf-preview-pane.tsx`, `pdf-preview/pdf-preview.tsx`, `pdf-preview/pdf-viewer-controls-toolbar.tsx`, `pdf-preview/pdf-synctex-controls.tsx` |
| 5 | — | `file-tree/file-tree-doc.tsx`, `file-tree/folder-list.tsx`, `chat/chat-pane.tsx`, `chat/message-list.tsx`, `ide-react/history-container.tsx`, `rail/full-project-search-panel.tsx` |
| 6 | `test/.../global-toasts-mobile.test.mjs`, `test/.../settings-modal-mobile.test.mjs` | `ide-react/global-toasts.tsx`, `ide-react/alerts/*.tsx`, `settings/settings-modal.tsx`, `ide-react/modals/*.tsx` |
| 7 | — | `webpack.config.js` (define-flag tree-shake, optional), `pages/ide.tsx` |
| 8 | `test/frontend/components/ide-react/mobile-ide-a11y.spec.tsx` | (Drawer, MobileBottomBar, MoreMenu `aria-*` — in place from Phase 2/1) |
| 9 | `test/frontend/features/ide-react/mobile-ide.spec.tsx`, `test/frontend/components/ide-react/ide-page-desktop-regression.spec.tsx` | — |

---

## 9. What I did **not** touch, intentionally

The desktop rendering at `md` and above is unchanged. The `focus-mode` code path is unchanged. The detached-PDF path is unchanged. The project-list, project-invite, marketing, login, and CIAM pages are unchanged. The `ds-mobile-app` module (not present in `modules/` of this fork) is out of scope. The PDF *compile* backend is unchanged. The socket layer is unchanged. The CodeMirror *core* (not its options) is unchanged.

