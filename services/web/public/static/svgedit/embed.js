/*
 * Overleaf diagram editor — host bridge for the embedded SVG-Edit app.
 *
 * Runs the full SVG-Edit 7.4.2 application (MIT/permissive OR-license, see
 * LICENSE) inside a same-origin iframe owned by the Overleaf diagram module
 * (`services/web/modules/diagram`). Overleaf's parent page is the source of
 * truth (the `.svg` document); this page provides the canvas, toolbars and
 * dialogs only.
 *
 * Bridge contract (same-origin, direct calls — no postMessage needed):
 *   window.__olSvgEmbed.ready        boolean, true once the app booted
 *   window.__olSvgEmbed.load(svg)    Promise<void> — replace canvas content
 *   window.__olSvgEmbed.getSvg()     string   — canvas content as SVG text
 *   window.__olSvgEmbed.onChanged(cb)  cb(svg) — debounced change notifier
 *
 * Data-safety rules the host enforces:
 *   - no auto-load of previously-cached content (storage excluded);
 *   - no storage prompt / cookie / beforeunload auto-save;
 *   - no third-party branding in the menu, title or serialized source.
 */
import Editor from './Editor.js'

const params = new URLSearchParams(location.search)
const fileName = params.get('name') || 'diagram.svg'

// Strip the canvas-library branding comment out of every serialised string
// so it can never leak into the Overleaf project source.
const BRAND_COMMENT = /<!--\s*Created with[^\n]*?-->/g
const stripBrand = (svg) => String(svg == null ? '' : svg).replace(BRAND_COMMENT, '')

const container = document.getElementById('container')
const svgEditor = new Editor(container)

/*
 * Neutral host configuration.
 *
 * - `noDefaultExtensions` + explicit extension list: the stock default set
 *   MINUS `ext-storage`. That extension is the source of the storage
 *   prompt, the `svgeditstore` cookie, the cached auto-load and the
 *   beforeunload auto-save (see `extensions/ext-storage/`) — none of which
 *   is wanted inside an embedded, parent-owned document.
 * - `noStorageOnLoad`: extra guard against any cached auto-load.
 * - `no_save_warning`: no browser "unsaved changes" leave prompt —
 *   Overleaf owns the project's save lifecycle.
 * - `imgPath` / `extPath` keep their defaults on purpose: they resolve
 *   against THIS document's base URL (/static/svgedit/), which is exactly
 *   where the vendored assets live.
 */
svgEditor.setConfig({
  noDefaultExtensions: true,
  extensions: [
    'ext-connector',
    'ext-eyedropper',
    'ext-grid',
    'ext-markers',
    'ext-panning',
    'ext-shapes',
    'ext-polystar',
    'ext-opensave',
    'ext-layer_view',
  ],
  noStorageOnLoad: true,
  no_save_warning: true,
})

svgEditor.init()

/*
 * Rebrand the app shell: drop the external home-page item, neutralise the
 * main-menu "SVG-Edit" label + logo, set a document title, and — just in
 * case — remove the storage dialog node.
 */
function rebrand () {
  try {
    const homepage = document.getElementById('tool_editor_homepage')
    if (homepage) homepage.remove()

    const main = document.getElementById('main_button')
    const labelRoot = main
      ? main.shadowRoot
        ? main.shadowRoot.querySelector('elix-menu-button')
          ? main.shadowRoot
            .querySelector('elix-menu-button')
            .shadowRoot
            .querySelector('#popupToggle')
            .shadowRoot
          : null
        : null
      : null
    if (labelRoot) {
      for (const node of Array.from(labelRoot.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && /svg-?edit/i.test(node.textContent)) {
          node.textContent = node.textContent.replace(/svg-?edit/gi, 'Diagram')
        }
      }
      labelRoot.querySelectorAll('img[alt="logo"]').forEach((img) => img.remove())
    }

    if (svgEditor.topPanel && typeof svgEditor.topPanel.updateTitle === 'function') {
      svgEditor.topPanel.updateTitle(fileName)
    }
    document.title = fileName

    const storage = document.getElementById('se-storage-dialog')
    if (storage) storage.remove()

    // Normalise the left-bar tail to the reference order
    // (… tools_polygon, tool_connect, tool_eyedropper): ext-eyedropper
    // inserts itself at a fixed index while ext-connector appends, so
    // whichever async init resolves first wins the slot. Cosmetic only.
    const connect = document.getElementById('tool_connect')
    const eyedropper = document.getElementById('tool_eyedropper')
    if (connect && eyedropper && connect.nextElementSibling !== eyedropper) {
      connect.after(eyedropper)
    }
  } catch (e) {
    // Rebranding is cosmetic; never break the editor over it.
  }
}

// `svgedit:ready` fires at the end of init() (after the ready queue ran).
document.addEventListener('svgedit:ready', rebrand)
// Extensions attach asynchronously; run again shortly after in case any
// UI node lands while we are mid-boot.
setTimeout(rebrand, 400)
setTimeout(rebrand, 1500)

/*
 * Right-click context menu fit-up (canvas menu + layer menus).
 *
 * Upstream svg-edit positions its context menus at raw cursor page
 * coordinates, clamped only by `screen.width - 250` / `screen.height -
 * 426` — i.e. the HOST OS SCREEN (standalone svg-edit runs full-window).
 * Embedded inside the Overleaf editor pane that clamp is meaningless: on a
 * small screen it drags the menu far AWAY from the cursor, on a large one
 * it lets the menu run past the right/bottom edge of the IFRAME viewport
 * where it is clipped — items (or the whole menu) become unreachable. The
 * layer menus have no clamping at all.
 *
 * Host-side fix (no vendored-bundle edits): svg-edit binds its openers to
 * `contextmenu`/`click` listeners on the inner workarea elements, so a
 * DOCUMENT-level listener (bubble phase) runs right after the bundle has
 * written its inline `top`/`left`. We then re-place each currently visible
 * menu: follow the cursor when it fits, pin flush to the viewport edge
 * when it does not (never beyond it).
 */
function clampContextMenusToViewport (event) {
  try {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const px = event && Number.isFinite(event.pageX) ? event.pageX : null
    const py = event && Number.isFinite(event.pageY) ? event.pageY : null
    const hosts = document.querySelectorAll('se-cmenu_canvas-dialog, se-cmenu-layers')
    for (const host of Array.from(hosts)) {
      if (!host.shadowRoot) continue
      for (const menu of Array.from(host.shadowRoot.querySelectorAll('.contextMenu'))) {
        if (menu.style.display === 'none') continue // closed: leave as-is
        const rect = menu.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        // Anchor at the cursor (upstream intent: menu top-left at the
        // cursor). Upstream's own clamp (screen.width/height) is wrong in
        // an embedded pane, so it is *replaced*, not extended. Pin flush to
        // the viewport edge (top-left if it doesn't even fit) when the
        // menu would overflow the viewport below/right of the cursor.
        const ax = px != null ? px : parseFloat(menu.style.left)
        const ay = py != null ? py : parseFloat(menu.style.top)
        if (Number.isNaN(ax) || Number.isNaN(ay)) continue
        const x = Math.max(0, Math.min(ax, vw - rect.width))
        const y = ay + rect.height <= vh
          ? Math.max(0, ay)
          : Math.max(0, vh - rect.height)
        menu.style.left = x + 'px'
        menu.style.top = y + 'px'
      }
    }
  } catch (e) {
    // Pure positioning assistance; never break the editor over it.
  }
}
document.addEventListener('contextmenu', clampContextMenusToViewport)
document.addEventListener('click', clampContextMenusToViewport)

const api = {
  ready: false,
  load (svg) {
    return Promise.resolve()
      .then(() => svgEditor.loadFromString(stripBrand(svg), { noAlert: true }))
      .catch((err) => {
        // Surface to the console; the parent sees the rejection.
        // eslint-disable-next-line no-console
        console.warn('diagram embed: failed to load SVG content', err)
        throw err
      })
      .then(() => rebrand())
  },
  getSvg () {
    const canvas = svgEditor.svgCanvas
    if (!canvas) return ''
    try {
      return stripBrand(canvas.svgCanvasToString())
    } catch (err) {
      try {
        return stripBrand(canvas.getSvgString())
      } catch (err2) {
        return ''
      }
    }
  },
  onChanged (cb) {
    // Debounce: a drag fires 'changed' continuously; the parent only ever
    // needs the latest serialised state.
    let scheduled = false
    let timer = null
    const notify = () => {
      if (scheduled) return
      scheduled = true
      timer = setTimeout(() => {
        scheduled = false
        try {
          cb(api.getSvg())
        } catch (e) {
          // Parent window gone (tab closed) — nothing to do.
        }
      }, 150)
    }
    // Attach on the next microtask so a synchronous init() has finished
    // wiring the canvas event system.
    setTimeout(() => {
      const canvas = svgEditor.svgCanvas
      if (!canvas) return
      try {
        canvas.bind('changed', notify)
        canvas.bind('canvasUpdated', notify)
        canvas.bind('selectedChanged', notify)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('diagram embed: change listeners failed', e)
      }
    }, 0)
    return () => {
      if (timer) clearTimeout(timer)
    }
  },
}
window.__olSvgEmbed = api

// Flip the flag as soon as the init chain's ready queue completes. `ready`
// resolves immediately if it has already run.
Promise.resolve()
  .then(() => svgEditor.ready(() => undefined))
  .then(() => {
    api.ready = true
    rebrand()
  })
  .catch(() => {
    // eslint-disable-next-line no-console
    console.warn('diagram embed: readiness queue failed')
  })
