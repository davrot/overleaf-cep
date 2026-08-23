/**
 * BibEditor visual component — rendered in the main editor window when
 * the user switches to "Visual" mode on a .bib file.
 *
 * Layout (Phase C capture, PHASE_C_PLAN.md §1.3/§1.4/§3-C4):
 *   .bibtex-entry-list-panel
 *     └─ .bibtex-list-and-preview
 *          ├─ .bibtex-entry-list        (C3 compact windowed rows; its
 *          │                            toolbar = search + Add (C5), and
 *          │                            the bulk bar = select-all + count
 *          │                            + bulk-Delete (W5 core))
 *          └─ .bibtex-entry-preview-
 *             panel (C4: Details form / Abstract tab)  — hidden until a
 *                card is previewed (selection kind 'existing')
 *
 * Selection === preview (C4): the context `selection` (kind 'existing')
 * IS the previewed entry; prev/next chevrons walk the current parse list
 * (file order). Bulk row-checkbox selection is panel-local state — never
 * document state.
 *
 * Draft model (REDESIGN_PLAN.md R2, capture OQ-7): there is no draft
 * persistence machinery. The open form (preview Details tab, or the C5
 * "Enter manually" modal) is the draft; whenever the panel is about to stop
 * being relevant for this document (Code toggle, Close/back, file switch,
 * unmount) the current form is flushed into the CodeMirror buffer via a
 * GUARDED write request (the extension re-resolves ranges against the live
 * document and rejects stale writes — see bib-editor-extension.ts).
 *
 * Flush compares the form against the *freshly parsed* entry, so leaving
 * with no effective change writes nothing; a type-only "new" form
 * materializes nothing (§2.3).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import withErrorBoundary from '@/infrastructure/error-boundary'
import EditorSwitch from '@/features/source-editor/components/editor-switch'
import GenericConfirmModal from '@/features/ide-react/components/modals/generic-confirm-modal'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useBibEditorContext } from '../context/bib-editor-context'
import { BIB_UNDO_EVENT, BIB_REDO_EVENT } from '../extensions/bib-editor-extension'
import BibEntryList from './bib-entry-list'
import BibEntryForm from './bib-entry-form'
import BibEntryPreview from './bib-entry-preview'
import BibImportModal from './bib-import-modal'
import BibImportFromLibrary from './bib-import-from-library'
import type { BibEntry } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'
import { generateCitationKey } from '../utils/bib-parser'
import { downloadBibFilename, bulkDeleteIds, nextEntry, prevEntry } from '../utils/preview-model.ts'
import '../../stylesheets/bib-editor-panel.css'

function shallowEntriesEqual(
  a: { type: string; id: string; fields: Record<string, string> },
  b: { type: string; id: string; fields: Record<string, string> } | undefined
): boolean {
  if (!b) return false
  if (a.type !== b.type) return false
  if (a.id !== b.id) return false
  const ak = Object.keys(a.fields)
  const bk = Object.keys(b.fields)
  if (ak.length !== bk.length) return false
  return ak.every(k => a.fields[k] === b.fields[k])
}

function BibEditorPanel() {
  const { t } = useTranslation()
  const {
    entries,
    source,
    selection,
    writeFailure,
    selectEntry,
    selectNew,
    updateNewEntryTypePreset,
    deselect,
    writeEntry,
    importMany,
    deleteEntry,
    scrollTo,
    clearWriteFailure,
  } = useBibEditorContext()
  const { showVisual } = useEditorPropertiesContext()
  const { openDocName } = useEditorOpenDocContext()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
 /** C5: the Paste-references import modal is open */
  const [importOpen, setImportOpen] = useState(false)
  // C9: "Import from Library" (LIBRARY_PLAN.md — the one deliberate deviation)
  const [libraryImportOpen, setLibraryImportOpen] = useState(false)
  const [bulkDeleteGuard, setBulkDeleteGuard] = useState<
    { entryIds: string[]; expectedSource: string } | null
  >(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef(selectedIds)

  /** Latest form values (written there by BibEntryForm on every change). */
  const formRef = useRef<{
    entry: BibEntry
    kind: 'existing' | 'new'
    originalId: string | null
  } | null>(null)

  // Mirrors of the reactive values so effect cleanups use the LATEST values
  // without re-running the effects.
  const selectionMirror = useRef(selection)
  const sourceMirror = useRef(source)
  const entriesMirror = useRef<ParsedBibEntry[]>(entries)
  const openDocNameMirror = useRef(openDocName)
  useEffect(() => { selectionMirror.current = selection }, [selection])
  useEffect(() => { sourceMirror.current = source }, [source])
  useEffect(() => { entriesMirror.current = entries }, [entries])
  useEffect(() => { openDocNameMirror.current = openDocName }, [openDocName])

  /**
   * Flush the open form into the current document (REDESIGN_PLAN.md R2,
   * OQ-7: flush-on-leave — the preview has no Save button). The request
   * carries `expectedSource`; the extension rejects it (and surfaces a
   * banner) when the document is no longer this bibliography. Skips
   * everything that is already the document (no-op writes).
   */
  const flushCurrentForm = useCallback(() => {
    const form = formRef.current
    const sel = selectionMirror.current
    if (!form || !sel) return

    if (sel.kind === 'new') {
      const entry: BibEntry = {
        type: form.entry.type,
        id: form.entry.id.trim(),
        fields: { ...form.entry.fields },
      }
      // Type-only form: materialize nothing (§2.3).
      if (entry.id === '' && Object.keys(entry.fields).length === 0) {
        return
      }
      const finalEntry: BibEntry =
        entry.id === ''
          ? { ...entry, id: generateCitationKey(entry.fields) }
          : entry
      writeEntry({
        entry: finalEntry,
        mode: 'new',
        expectedSource: sourceMirror.current,
      })
      // The extension re-emits the fresh parse with `written` and the
      // context re-binds the selection to the written entry — but only
      // when it actually landed (parse-confirmed, §2.3 / §12 P1a). On
      // rejection nothing changes: the banner shows and the form stays
      // for a fix.
      return
    }

    // existing (preview Details): write only when the form actually
    // diverged from the freshly parsed entry (no no-op rewrites on every
    // Close). The anchor is the ORIGINAL key (a renamed entry is not
    // parsed by its new key).
    const original = entriesMirror.current.find(
      e => e.id === (form.originalId ?? sel.entryId)
    )
    const entry: BibEntry = {
      type: form.entry.type,
      id: form.entry.id.trim(),
      fields: { ...form.entry.fields },
    }
    // Unchanged = same id AND same values (a pure key rename is NOT
    // unchanged — §12 P1b). Renames are re-resolved by the write planner
    // against the original key, and the context re-binds the selection
    // afterwards (parse-confirmed; not done here — §12 P1a).
    const unchanged =
      original !== null &&
      original.id === entry.id &&
      shallowEntriesEqual(entry, original)
    if (unchanged) {
      return
    }
    writeEntry({
      entry,
      mode: 'existing',
      originalId: form.originalId ?? undefined,
      expectedSource: sourceMirror.current,
    })
  }, [writeEntry])

  // ── R2 leave watchers: flush whenever we stop being shown ─────────────

  // 1. showVisual: true → false (Code toggle): flush + reveal the entry in
  //    Code (same behavior as the old code-switch capture, now side-
  //    effect-free).
  const prevShowVisual = useRef(showVisual)
  useEffect(() => {
    if (prevShowVisual.current && !showVisual) {
      const sel = selectionMirror.current
      flushCurrentForm()
      if (sel?.kind === 'existing') {
        const entry = entriesMirror.current.find(e => e.id === sel.entryId)
        if (entry) {
          scrollTo(entry.sourceStart)
        }
      }
    }
    prevShowVisual.current = showVisual
  }, [showVisual, flushCurrentForm, scrollTo])

  // 2. openDocName changes while visual is mounted (file switch).
  const prevDocName = useRef(openDocName)
  useEffect(() => {
    if (prevDocName.current !== null && openDocName !== prevDocName.current) {
      // Best-effort: the CM document most likely still holds the old file
      // (loading is async) — if it has already switched the guard rejects
      // the write and the panel surfaces the banner. No corruption possible.
      flushCurrentForm()
      deselect()
      setBulkDeleteGuard(null)
      setSelectedIds([])
    }
    prevDocName.current = openDocName
  }, [openDocName, flushCurrentForm, deselect])

  // 3. unmount (tab close, etc.)
  useEffect(() => {
    return () => {
      flushCurrentForm()
    }
  }, [flushCurrentForm])

  // Bulk selection: drop ids that no longer resolve in the current parse
  // (e.g. after a Code-mode edit or a delete).
  useEffect(() => {
    setSelectedIds(prev => {
      const present = new Set(entries.map(e => e.id))
      const next = prev.filter(id => present.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [entries])

  // ── Preview (C4): the context selection (existing) drives it ─────────

  const previewEntry = useMemo<ParsedBibEntry | null>(() => {
    if (selection?.kind === 'existing') {
      return entries.find(e => e.id === selection.entryId) || null
    }
    return null
  }, [selection, entries])
  const previewIndex = useMemo(() => {
    if (selection?.kind !== 'existing') return -1
    return entries.findIndex(e => e.id === selection.entryId)
  }, [selection, entries])

  const handlePreviewClose = useCallback(() => {
    setShowDeleteConfirm(false)
    flushCurrentForm()
    formRef.current = null
    deselect()
  }, [flushCurrentForm, deselect])

  // Prev/next = prev/next entry in the current parse list (file order,
  // wrap-to-ends per the preview-model tests). Crossing the boundary
  // flushes (R2) and then re-selects — leave-then-select ordering keeps
  // the R2 guarantee.
  const handlePrev = useCallback(() => {
    const prev = prevEntry(entries, previewIndex)
    if (!prev || (selection?.kind === 'existing' && prev.id === selection.entryId)) {
      return
    }
    flushCurrentForm()
    formRef.current = null
    selectEntry(prev)
  }, [previewIndex, entries, selection, flushCurrentForm, selectEntry])

  const handleNext = useCallback(() => {
    const next = nextEntry(entries, previewIndex)
    if (!next || (selection?.kind === 'existing' && next.id === selection.entryId)) {
      return
    }
    flushCurrentForm()
    formRef.current = null
    selectEntry(next)
  }, [previewIndex, entries, selection, flushCurrentForm, selectEntry])

  const handleSelectNew = useCallback(() => {
    // C5 "Enter manually": opens the Add reference modal (selection 'new'
    // drives the modal state — flush/rebind semantics unchanged).
    setImportOpen(false)
    selectNew()
  }, [selectNew])

  const handleBack = useCallback(() => {
    setShowDeleteConfirm(false)
    flushCurrentForm()
    formRef.current = null
    deselect()
  }, [flushCurrentForm, deselect])

  const handleFormChange = useCallback(
    (entry: BibEntry, originalId: string | null) => {
      // W1: remember the type chosen on a new-entry form (the preset).
      // Existing entries: the type is bound to the parsed entry — don't
      // pollute the preset from an edit.
      if (originalId === null) {
        updateNewEntryTypePreset(entry.type)
      }
      formRef.current = {
        entry: {
          type: entry.type,
          id: entry.id,
          fields: { ...entry.fields },
        },
        kind: originalId === null ? 'new' : 'existing',
        originalId,
      }
    },
    [updateNewEntryTypePreset]
  )

  const handleChecked = useCallback(
    (entry: BibEntry, kind: 'existing' | 'new') => {
      if (kind === 'new') {
        const finalEntry: BibEntry =
          entry.id.trim() !== ''
            ? { ...entry, id: entry.id.trim() }
            : { ...entry, id: generateCitationKey(entry.fields) }
        // Materialize (append). The extension re-emits the fresh parse
        // with the written id and the context re-binds to it only when the
        // entry actually landed (parse-confirmed, §2.3 / §12 P1a). On
        // rejection the banner shows and this form stays in "new" mode
        // for a fix.
        writeEntry({
          entry: finalEntry,
          mode: 'new',
          expectedSource: sourceMirror.current,
        })
      }
      // kind 'existing': Check is validate-only — nothing to do.
    },
    [writeEntry]
  )

  // ── Delete: single (preview Actions) + bulk (bulk bar, W5 core) ───────

  const handleConfirmDelete = useCallback(() => {
    const sel = selectionMirror.current
    setShowDeleteConfirm(false)
    formRef.current = null
    if (sel?.kind === 'existing') {
      deleteEntry({
        entryId: sel.entryId,
        expectedSource: sourceMirror.current,
      })
    }
    deselect()
  }, [deleteEntry, deselect])

  // Guard before the bulk write: snapshot { source, ids } so the confirm
  // action re-checks both against the live context at dispatch time
  // (W5 all-or-nothing, no partial deletes on a stale source).
  const handleAskBulkDelete = useCallback(() => {
    setBulkDeleteGuard({
      entryIds: bulkDeleteIds(
        entriesMirror.current,
        selectedIdsRef.current
      ),
      expectedSource: sourceMirror.current,
    })
  }, [])

  const handleConfirmBulkDelete = useCallback(() => {
    const guard = bulkDeleteGuard
    setBulkDeleteGuard(null)
    if (!guard) return
    const liveSource = sourceMirror.current
    // Stale source since the ask → abort (the extension guard is the
    // second line of defense; here we avoid the confirm dance on a doc
    // that already changed).
    if (liveSource !== guard.expectedSource) {
      return
    }
    deleteEntry({
      entryIds: guard.entryIds,
      expectedSource: liveSource,
    })
    setSelectedIds([])
    formRef.current = null
    // The preview for a deleted row closes (the context also clears a
    // vanished selection — same result).
    const sel = selectionMirror.current
    if (sel?.kind === 'existing' && guard.entryIds.includes(sel.entryId)) {
      deselect()
    }
  }, [deleteEntry, deselect, bulkDeleteGuard])

  // C5 Paste import: one guarded, all-or-nothing append (the extension
  // re-resolves against the live doc and rejects stale-source/conflict,
  // surfacing the banner — the modal closes optimistically, like the
  // W5 bulk delete).
  const handleImportEntries = useCallback((importEntries: BibEntry[]) => {
    importMany({ entries: importEntries, expectedSource: sourceMirror.current })
    setImportOpen(false)
  }, [importMany])

  // C9: Import-from-Library uses the SAME guarded, all-or-nothing write.
  const handleLibraryImport = useCallback((importEntries: BibEntry[]) => {
    importMany({ entries: importEntries, expectedSource: sourceMirror.current })
    setLibraryImportOpen(false)
  }, [importMany])

  // Download (OQ-6: whole file). The browser saves the current document
  // text; no range export.
  const handleDownload = useCallback(() => {
    const blob = new Blob([sourceMirror.current], {
      type: 'text/plain',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = downloadBibFilename(openDocNameMirror.current)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  // Bulk selection handlers (lifted into the panel — C4: the preview must
  // close for a deleted previewed row, and the confirm modal lives here).
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

  const handleToggleSelectAll = useCallback((kind: 'all' | 'none') => {
    setSelectedIds(
      kind === 'all' ? entries.map(e => e.id) : []
    )
  }, [entries])

  return (
    <div className="bib-editor-panel">
      {writeFailure !== null && (
        <div className="bib-write-failure-banner" role="alert">
          <span className="bib-write-failure-banner-text">
            {t('Could not save: the file changed or is no longer a bibliography.')}
          </span>
          <button
            type="button"
            className="bib-write-failure-dismiss"
            aria-label={t('Dismiss')}
            onClick={(e) => {
              e.stopPropagation()
              clearWriteFailure()
            }}
          >
            {t('Dismiss')}
          </button>
        </div>
      )}

      {/* SaaS bibtex toolbar (reference 2a): Undo/Redo on the left, the
          Code/Visual toggle (right) with the reserved search slot.
          The visual "new entry" back action stays on the left. */}
      <div
        className="bibtex-toolbar"
        role="toolbar"
        aria-label={t('BibTeX editor toolbar')}
      >
        <div className="ol-toolbar-layout-left">
          {selection?.kind === 'new' && (
            <OLButton
              className="bibtex-toolbar-back"
              size="sm"
              variant="link"
              leadingIcon="arrow_top_left"
              onClick={handleBack}
            >
              {t('back')}
            </OLButton>
          )}
          <div
            className="ol-editor-toolbar-button-group"
            aria-label={t('toolbar_undo_redo_actions')}
          >
            <button
              type="button"
              className="ol-cm-toolbar-button"
              aria-label={t('undo')}
              onClick={() =>
                document.dispatchEvent(new CustomEvent(BIB_UNDO_EVENT))
              }
            >
              <span className="material-symbols" aria-hidden="true">
                undo
              </span>
              <span className="visually-hidden">{t('undo')}</span>
            </button>
            <button
              type="button"
              className="ol-cm-toolbar-button"
              aria-label={t('redo')}
              onClick={() =>
                document.dispatchEvent(new CustomEvent(BIB_REDO_EVENT))
              }
            >
              <span className="material-symbols" aria-hidden="true">
                redo
              </span>
              <span className="visually-hidden">{t('redo')}</span>
            </button>
          </div>
        </div>
        <div className="ol-toolbar-layout-right">
          {/* Code/Visual toggle — the leave watchers above handle
              "leaving visual" (no click interception, R2). */}
          <EditorSwitch />
          {/* SaaS reserves the search slot (hidden on narrow widths). */}
          <div style={{ display: 'flex', visibility: 'hidden' }} aria-hidden="true">
            <button
              type="button"
              className="ol-cm-toolbar-button"
              aria-label={t('toolbar_search_file')}
            >
              <span className="material-symbols" aria-hidden="true">
                search
              </span>
              <span className="visually-hidden">
                {t('toolbar_search_file')}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="bib-editor-panel-content">
        {selection?.kind === 'new' ? (
          // C5 replaces this full-view form with the "Enter manually"
          // Add-dropdown modal. Kept until then (C4 is revertible alone).
          <BibEntryForm
            entry={selection.draft}
            kind="new"
            originalId={null}
            existingIds={entries.map(e => e.id)}
            onFormChange={handleFormChange}
            onChecked={handleChecked}
            onBack={handleBack}
          />
        ) : (
          <div className="bibtex-list-and-preview">
            <BibEntryList
              entries={entries}
              onSelect={selectEntry}
              previewId={
                selection?.kind === 'existing' ? selection.entryId : null
              }
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onBulkDelete={
                selectedIds.length > 0
                  ? handleAskBulkDelete
                  : undefined
              }
              openDocName={openDocName}
              onAddPaste={() => setImportOpen(true)}
              onAddManual={handleSelectNew}
              onAddFromLibrary={() => setLibraryImportOpen(true)}
            />
            {selection?.kind === 'existing' && previewEntry ? (
              <BibEntryPreview
                entries={entries}
                entry={{
                  type: previewEntry.type,
                  id: previewEntry.id,
                  fields: { ...previewEntry.fields },
                }}
                previewIndex={previewIndex}
                onPrev={handlePrev}
                onNext={handleNext}
                onClose={handlePreviewClose}
                onDownload={handleDownload}
                onDelete={() => setShowDeleteConfirm(true)}
                onFormChange={handleFormChange}
                existingIds={entries.map(e => e.id)}
                canDelete
              />
            ) : null}
          </div>
        )}
      </div>

      {/* Single-entry delete confirm (preview Actions) */}
      <GenericConfirmModal
        show={showDeleteConfirm}
        onHide={() => setShowDeleteConfirm(false)}
        title={t('Delete entry')}
        message={t(
          'Are you sure you want to delete this entry? This action cannot be undone.'
        )}
        confirmLabel={t('delete')}
        primaryVariant="danger"
        onConfirm={handleConfirmDelete}
      />

      {/* Bulk delete confirm (W5 core, bulk bar) */}
      <GenericConfirmModal
        show={bulkDeleteGuard !== null}
        onHide={() => setBulkDeleteGuard(null)}
        title={t('Delete entry')}
        message={t('Delete __count__ references? This action cannot be undone.', {
          count: bulkDeleteGuard?.entryIds.length ?? 0,
        })}
        confirmLabel={t('delete')}
        primaryVariant="danger"
        onConfirm={handleConfirmBulkDelete}
      />

      {/* C5 paste import (the Add dropdown "Paste references") */}
      <BibImportModal
        show={importOpen}
        existingIds={entries.map(e => e.id)}
        source={source}
        expectedSource={sourceMirror.current}
        onImport={handleImportEntries}
        onHidden={() => setImportOpen(false)}
      />

      {/* C9 (LIBRARY_PLAN.md): Import from Library — the Add dropdown item
          (enabled; the pre-L disabled stub is the no-wire fallback). */}
      <BibImportFromLibrary
        show={libraryImportOpen}
        existingIds={entries.map(e => e.id)}
        onImport={handleLibraryImport}
        onHidden={() => setLibraryImportOpen(false)}
      />
    </div>
  )
}

function BibEditorFallback() {
  const { t } = useTranslation()
  return (
    <div className="bib-editor-panel">
      <div className="bib-editor-placeholder">
        <div className="bib-editor-placeholder-text">
          {t('Something went wrong loading the bibliography editor.')}
        </div>
      </div>
    </div>
  )
}

export default withErrorBoundary(BibEditorPanel, () => <BibEditorFallback />)
