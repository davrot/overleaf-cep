/**
 * CodeMirror extension for the bib-editor module.
 *
 * Registered via overleafModuleImports.sourceEditorExtensions (settings).
 *
 * Responsibilities:
 *  1. Detect when the current document is a .bib file
 *  2. Parse BibTeX entries (300 ms debounce) and emit them to the React
 *     context via DOM CustomEvents — the document always stays the truth
 *  3. Apply guarded write/delete requests from the React panel:
 *       - ranges are resolved against the CURRENTLY SHOWN document (no
 *         cached offsets → the "Invalid change range" crash class is gone)
 *       - the event carries `expectedSource` (the source snapshot the panel
 *         flushed from); a mismatch means the view already switched to
 *         another file, so the write is REJECTED (surfaced via a
 *         "write-failed" event) instead of corrupting the new document
 *       - after a SUCCESSFUL guarded write the fresh parse is re-emitted with
 *         `written: { id, mode, originalId }`, so the context re-binds the
 *         form to the written entry only when it actually landed; on
 *         rejection nothing changes (the banner shows and the form stays)
 *
 * This extension holds no React state; all bridging is event-based, which is
 * the sanctioned module pattern (see REDESIGN_PLAN.md §2.9).
 */
import { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { parseBibFile, serializeBibEntry } from '../utils/bib-parser'
import type { ParsedBibEntry } from '../utils/bib-parser'
import {
  planBibWrite,
  planBibDelete,
  planBibBulkDelete,
  planBibImport,
  isBibDocument,
} from '../utils/bib-write'
import type { BibEntry } from '../utils/bib-types'

/**
 * Module-internal event names. The React side (bib-editor-context.tsx /
 * bib-editor-provider.tsx) listens and dispatches using these names.
 */
export const BIB_ENTRIES_EVENT = 'bib-editor:entries-updated'
export const BIB_WRITE_EVENT = 'bib-editor:write'
export const BIB_DELETE_EVENT = 'bib-editor:delete'
export const BIB_IMPORT_EVENT = 'bib-editor:import'
export const BIB_SCROLL_TO_EVENT = 'bib-editor:scroll-to'
export const BIB_WRITE_FAILED_EVENT = 'bib-editor:write-failed'

class BibEditorPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private dispatchHandler: ((ev: Event) => void) | null = null
  private scrollHandler: ((ev: Event) => void) | null = null

  constructor(private view: EditorView) {
    this.setupDispatchListener()
    this.setupScrollListener()
    this.emitState()
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.debouncedParse()
    }
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.dispatchHandler) {
      document.removeEventListener(BIB_WRITE_EVENT, this.dispatchHandler)
      document.removeEventListener(BIB_DELETE_EVENT, this.dispatchHandler)
      document.removeEventListener(BIB_IMPORT_EVENT, this.dispatchHandler)
      this.dispatchHandler = null
    }
    if (this.scrollHandler) {
      document.removeEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
      this.scrollHandler = null
    }
  }

  /**
   * Whether the current document is a bibliography file (heuristic: an
   * `@type{` marker within the first 2k characters).
   */
  private detectBibFile(): boolean {
    // The `@type{` heuristic is module-internal (documented in the plan,
    // pinned by a unit test). isBibDocument samples the first 2k chars.
    return isBibDocument(this.view.state.doc.toString())
  }

  private emitState(
    written?: { id: string; mode: 'existing' | 'new'; originalId?: string }
  ) {
    const isBibFile = this.detectBibFile()
    const source = this.view.state.doc.toString()
    document.dispatchEvent(
      new CustomEvent(BIB_ENTRIES_EVENT, {
        detail: {
          entries: isBibFile ? this.parseEntries() : [],
          source,
          isBibFile,
          written,
        },
      })
    )
  }

  private parseEntries(): ParsedBibEntry[] {
    try {
      return parseBibFile(this.view.state.doc.toString())
    } catch {
      return []
    }
  }

  private debouncedParse() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => this.emitState(), 300)
  }

  /**
   * Guarded dispatch of write/delete requests from the panel.
   *
   * `expectedSource` is the source snapshot the panel read when it created
   * the request. If the view no longer holds that exact source, the user has
   * switched files (or the document changed externally) in the meantime →
   * reject instead of write. This makes the "flush from file A while file B
   * is becoming current" race unconditionally safe (REDESIGN_PLAN.md §2.2/R2)
   * and — because the panel only exists in visual mode for `.bib` files —
   * doubles as the "is this still my bib file" gate (plan §12 P1c).
   */
  private setupDispatchListener() {
    this.dispatchHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (!detail) {
        return
      }
      const source = this.view.state.doc.toString()
      const {
        entry,
        entries,
        mode,
        originalId,
        expectedSource,
      } = detail as {
        entry?: BibEntry
        entries?: BibEntry[]
        mode: 'existing' | 'new'
        originalId?: string
        expectedSource?: string
      } & { entryId?: string; entryIds?: string[] }

      if (ev.type === BIB_DELETE_EVENT && !isBibDocument(source)) {
        this.emitWriteFailed('not-a-bib-file')
        return
      }
      if (typeof expectedSource === 'string' && source !== expectedSource) {
        this.emitWriteFailed('doc-changed')
        return
      }

      if (ev.type === BIB_WRITE_EVENT) {
        if (!entry) {
          return
        }
        const guard = planBibWrite(
          source,
          entry,
          mode,
          serializeBibEntry,
          originalId
        )
        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          return
        }
        this.view.dispatch({
          changes: {
            from: guard.plan.from,
            to: guard.plan.to,
            insert: guard.plan.insert,
          },
        })
        // Fresh parse WITH the written id: the context re-binds the form to
        // the written entry only when it resolves in that parse. On
        // rejection (above) no re-emit happens → selection untouched, the
        // banner shows and the form stays for a fix (§2.3 / §12 P1a).
        this.emitState({ id: entry.id as string, mode, originalId })
      } else if (ev.type === BIB_IMPORT_EVENT) {
        // C5 Paste import: one guarded, all-or-nothing append of N entries.
        // A zero-entry plan is a deliberate no-op (nothing to import).
        const entriesArg = entries ?? []
        if (entriesArg.length === 0) {
          return
        }
        const guard = planBibImport(source, entriesArg, serializeBibEntry)
        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          return
        }
        this.view.dispatch({ changes: guard.changes })
        this.emitState()
      } else if (ev.type === BIB_DELETE_EVENT) {
        const { entryId, entryIds } = detail as {
          entryId?: string
          entryIds?: string[]
        }
        // Bulk delete (W5): one guarded write, all-or-nothing; a zero-
        // change plan (empty selection) is a deliberate no-op.
        if (entryIds !== undefined) {
          const guard = planBibBulkDelete(source, entryIds)
          if (!guard.ok) {
            this.emitWriteFailed(guard.reason)
            return
          }
          if (guard.changes.length === 0) {
            return
          }
          this.view.dispatch({ changes: guard.changes })
          this.emitState()
          return
        }
        const guard = planBibDelete(source, entryId)
        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          return
        }
        this.view.dispatch({
          changes: {
            from: guard.plan.from,
            to: guard.plan.to,
            insert: guard.plan.insert,
          },
        })
        this.emitState()
      }
    }
    document.addEventListener(BIB_WRITE_EVENT, this.dispatchHandler)
    document.addEventListener(BIB_DELETE_EVENT, this.dispatchHandler)
    document.addEventListener(BIB_IMPORT_EVENT, this.dispatchHandler)
  }

  private emitWriteFailed(reason: string) {
    document.dispatchEvent(
      new CustomEvent(BIB_WRITE_FAILED_EVENT, { detail: { reason } })
    )
  }

  /**
   * Scroll-to requests from the React panel (focus an entry in Code mode).
   */
  private setupScrollListener() {
    this.scrollHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (!detail) {
        return
      }
      const { position } = detail as { position: number }
      if (typeof position !== 'number') {
        return
      }
      const pos = Math.min(
        Math.max(0, position),
        this.view.state.doc.length
      )
      this.view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      })
      this.view.focus()
    }
    document.addEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
  }
}

/**
 * The extension registered in sourceEditorExtensions.
 *
 * The import-overleaf-module macro compiles the registration into
 * `createExtensions()`, which CALLS `moduleExtensions.map(e => e(options))`
 * — so this must be a factory function, not an Extension value.
 */
export const extension = (
  _options?: Record<string, unknown>
): Extension => {
  return [ViewPlugin.fromClass(BibEditorPlugin)]
}
