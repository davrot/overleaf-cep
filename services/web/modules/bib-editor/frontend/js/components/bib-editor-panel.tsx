/**
 * BibEditor visual component — rendered in the main editor window when
 * the user switches to "Visual" mode on a .bib file.
 *
 * The open form is the draft (REDESIGN_PLAN.md §2.2–§2.3): there is no draft
 * persistence machinery. Whenever the panel is about to stop being relevant
 * for this document (Code toggle, Back, file switch, unmount) the current
 * form is flushed into the CodeMirror buffer via a GUARDED write request
 * (the extension re-resolves ranges against the live document and rejects
 * stale writes — see bib-editor-extension.ts).
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
import BibEntryList from './bib-entry-list'
import BibEntryForm from './bib-entry-form'
import type { BibEntry } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'
import { generateCitationKey } from '../utils/bib-parser'
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
    deleteEntry,
    scrollTo,
    clearWriteFailure,
  } = useBibEditorContext()
  const { showVisual } = useEditorPropertiesContext()
  const { openDocName } = useEditorOpenDocContext()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
  useEffect(() => { openDocNameMirror.current = openDocName })

  /**
   * Flush the open form into the current document (REDESIGN_PLAN.md R2).
   * The request carries `expectedSource`; the extension rejects it (and
   * surfaces a banner) when the document is no longer this bibliography.
   * Skips everything that is already the document (no-op writes).
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
      // context re-binds the selection to the written entry — but only when
      // it actually landed (parse-confirmed, §2.3 / §12 P1a). On rejection
      // nothing changes: the banner shows and the form stays for a fix.
      return
    }

    // existing: write only when the form actually diverged from the
    // freshly parsed entry (no no-op rewrites on every Back). The anchor
    // is the ORIGINAL key (a renamed entry is not parsed by its new key).
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

  // ── R2 leave watcher: flush whenever we stop being shown ──────────────

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
    }
    prevDocName.current = openDocName
  }, [openDocName, flushCurrentForm, deselect])

  // 3. unmount (tab close, etc.)
  useEffect(() => {
    return () => {
      flushCurrentForm()
    }
  }, [flushCurrentForm])

  // ── Selection handlers ──────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    setShowDeleteConfirm(false)
    flushCurrentForm()
    formRef.current = null
    deselect()
  }, [flushCurrentForm, deselect])

  const handleSelectNew = useCallback(() => {
    selectNew()
  }, [selectNew])

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
        // Materialize (append). The extension re-emits the fresh parse with
        // the written id and the context re-binds to it only when the entry
        // actually landed (parse-confirmed, §2.3 / §12 P1a). On rejection
        // the banner shows and this form stays in "new" mode for a fix.
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

  const existingEntry: ParsedBibEntry | null = useMemo(() => {
    if (selection?.kind === 'existing') {
      return entries.find(e => e.id === selection.entryId) || null
    }
    return null
  }, [selection, entries])

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

      <div className="bib-editor-visual-nav">
        {selection !== null && (
          <OLButton
            className="bib-editor-back-btn"
            size="sm"
            variant="link"
            leadingIcon="arrow_top_left"
            onClick={handleBack}
          >
            {t('back')}
          </OLButton>
        )}
        {selection === null && (
          <OLButton size="sm" variant="primary" onClick={handleSelectNew}>
            {t('Add new entry')}
          </OLButton>
        )}
        <span className="bib-editor-visual-nav-title">
          {selection?.kind === 'existing'
            ? t('Edit Entry')
            : selection?.kind === 'new'
              ? t('New Entry')
              : ''}
        </span>
        {/* Plain Code/Visual toggle — the leave watchers above handle
            "leaving visual" (no click interception, R2). */}
        <EditorSwitch />
      </div>

      <div className="bib-editor-panel-content">
        {selection === null ? (
          <BibEntryList entries={entries} onSelect={selectEntry} />
        ) : selection.kind === 'existing' && existingEntry ? (
          <BibEntryForm
            entry={{
              type: existingEntry.type,
              id: existingEntry.id,
              fields: { ...existingEntry.fields },
            }}
            kind="existing"
            originalId={existingEntry.id}
            existingIds={entries.map(e => e.id)}
            onFormChange={handleFormChange}
            onChecked={handleChecked}
            onDelete={() => setShowDeleteConfirm(true)}
            onBack={handleBack}
          />
        ) : selection.kind === 'new' ? (
          <BibEntryForm
            entry={selection.draft}
            kind="new"
            originalId={null}
            existingIds={entries.map(e => e.id)}
            onFormChange={handleFormChange}
            onChecked={handleChecked}
            onBack={handleBack}
          />
        ) : null}
      </div>

      {/* Delete confirmation */}
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
