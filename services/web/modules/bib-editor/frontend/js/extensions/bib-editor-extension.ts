/**
 * CodeMirror extension for the bib-editor module.
 * Detects when a .bib file is open:
 *   1. Parses BibTeX entries from the document
 *   2. Posts them to a global event bus so the React sidebar can read them
 *   3. Listens for dispatch requests from the sidebar
 *
 * Registered via overleafModuleImports.sourceEditorExtensions in settings.
 */
import { Extension, StateField, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { parseBibFile, ParsedBibEntry } from '../utils/bib-parser'

/**
 * Custom event types for communication between CodeMirror and React.
 */
const BIB_ENTRIES_EVENT = 'bib-editor:entries-updated'
const BIB_DISPATCH_EVENT = 'bib-editor:dispatch'
const BIB_DOC_CHANGE_EVENT = 'bib-editor:doc-changed'
const BIB_SCROLL_TO_EVENT = 'bib-editor:scroll-to'

/**
 * StateField to track whether the current document is a .bib file.
 * Updated by the ViewPlugin when the document name changes.
 */
const isBibFileField = StateField.define<boolean>({
  create() {
    return false
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBibFileEffect)) {
        return effect.value
      }
    }
    return value
  },
})

const setBibFileEffect = StateEffect.define<boolean>()

/**
 * ViewPlugin that watches for document changes and parses BibTeX entries.
 */
const bibEditorPlugin = ViewPlugin.fromClass(
  class {
    private isBibFile = false
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    private dispatchHandler: ((ev: Event) => void) | null = null
    private scrollHandler: ((ev: Event) => void) | null = null

    constructor(private view: EditorView) {
      this.checkAndParse()
      this.setupDispatchListener()
      this.setupScrollListener()
    }

    update(update: ViewUpdate) {
      // Re-check on document changes
      if (update.docChanged) {
        this.debouncedParse()
      }
    }

    destroy() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      if (this.dispatchHandler) {
        document.removeEventListener(BIB_DISPATCH_EVENT, this.dispatchHandler)
      }
      if (this.scrollHandler) {
        document.removeEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
      }
    }

    private checkAndParse() {
      this.isBibFile = this.detectBibFile()
      if (this.isBibFile) {
        this.parseAndEmit()
      }
      // Always emit doc change event so the sidebar knows the file type
      this.emitDocChange()
    }

    private debouncedParse() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.isBibFile = this.detectBibFile()
        if (this.isBibFile) {
          this.parseAndEmit()
        }
        this.emitDocChange()
      }, 300)
    }

    private detectBibFile(): boolean {
      // Scan the beginning of the document for a BibTeX entry marker.
      // Checking the full content (not just the first line) handles files that
      // start with a blank line or a comment, and empty .bib files that later
      // receive their first entry.
      const doc = this.view.state.doc
      const sample = doc.sliceString(0, Math.min(doc.length, 2000))
      return /@\s*[\w-]+\s*\{/i.test(sample)
    }

    private parseAndEmit() {
      const source = this.view.state.doc.toString()
      try {
        const entries = parseBibFile(source)
        document.dispatchEvent(
          new CustomEvent(BIB_ENTRIES_EVENT, {
            detail: { entries, source, isBibFile: true },
          })
        )
      } catch {
        // parsing failed, emit empty
        document.dispatchEvent(
          new CustomEvent(BIB_ENTRIES_EVENT, {
            detail: { entries: [], source, isBibFile: true },
          })
        )
      }
    }

    private emitDocChange() {
      const source = this.view.state.doc.toString()
      document.dispatchEvent(
        new CustomEvent(BIB_DOC_CHANGE_EVENT, {
          detail: { isBibFile: this.isBibFile, source },
        })
      )
    }

    /**
     * Listen for scroll-to requests from the React panel.
     * The panel sends {position: number} to focus an entry in code mode.
     */
    private setupScrollListener() {
      this.scrollHandler = (ev: Event) => {
        const detail = (ev as CustomEvent).detail
        if (!detail) return
        const { position } = detail as { position: number }
        if (typeof position !== 'number') return
        const pos = Math.min(Math.max(0, position), this.view.state.doc.length)
        this.view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        })
        this.view.focus()
      }
      document.addEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
    }

    /**
     * Listen for dispatch requests from the React sidebar.
     * The sidebar sends {from, to, insert} objects.
     */
    private setupDispatchListener() {
      this.dispatchHandler = (ev: Event) => {
        const detail = (ev as CustomEvent).detail
        if (!detail) return
        const { from, to, insert } = detail
        if (typeof from !== 'number' || typeof to !== 'number') return
        this.view.dispatch({
          changes: { from, to, insert: insert ?? '' },
        })
      }
      document.addEventListener(BIB_DISPATCH_EVENT, this.dispatchHandler)
    }
  }
)

/**
 * The extension to export for the sourceEditorExtensions module hook.
 */
export const extension = (): Extension => {
  return [bibEditorPlugin]
}

/**
 * Event constants exported for use by the React context.
 */
export { BIB_ENTRIES_EVENT, BIB_DISPATCH_EVENT, BIB_DOC_CHANGE_EVENT, BIB_SCROLL_TO_EVENT }
