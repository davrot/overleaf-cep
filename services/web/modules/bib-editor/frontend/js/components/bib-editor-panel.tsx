/**
 * BibEditor visual component — rendered in the main editor window when
 * the user switches to "Visual" mode on a .bib file.
 *
 * States:
 * - List mode: searchable entry list; clicking an entry opens the editor
 * - Edit mode: entry form with Delete/Cancel/Save in the footer
 * - Add mode: empty entry form with Cancel/Add in the footer
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import withErrorBoundary from '@/infrastructure/error-boundary'
import EditorSwitch from '@/features/source-editor/components/editor-switch'
import GenericConfirmModal from '@/features/ide-react/components/modals/generic-confirm-modal'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useBibEditorContext } from '../context/bib-editor-context'
import BibEntryList from './bib-entry-list'
import BibEntryForm from './bib-entry-form'
import { BIB_SCROLL_TO_EVENT } from '../extensions/bib-editor-extension'
import '../../stylesheets/bib-editor-panel.css'
import type { BibEntry } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'

function BibEditorPanel() {
  const { t } = useTranslation()
  const {
    entries,
    selectedEntry,
    mode,
    setMode,
    selectEntry,
    saveEntry,
    addEntry,
    deleteEntry,
    pendingAddDraft,
    setPendingAddDraft,
    pendingEditDraft,
    setPendingEditDraft,
  } = useBibEditorContext()
  const { setShowVisual } = useEditorPropertiesContext()

  // --- confirmation modal state ---
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  // store the scroll position to focus in Code after a confirmed Visual→Code switch
  const pendingScrollPosition = useRef<number | null>(null)

  // ── Draft persistence across file-tree navigation ───────────────────────
  // currentDraftRef holds the latest form values (updated via onDraftChange).
  // On unmount, if the user navigated away without saving/cancelling, we write
  // it to the context so it can be restored when they return.
  const currentDraftRef = useRef<BibEntry | null>(null)
  const modeRef = useRef(mode)
  const selectedEntryRef = useRef(selectedEntry)
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { selectedEntryRef.current = selectedEntry }, [selectedEntry])

  // On mount: read the pending add draft (used as the form's initial entry
  // below) then clear it from context so fresh "Add new entry" opens are empty.
  useEffect(() => {
    if (pendingAddDraft) setPendingAddDraft(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // On unmount: save the current draft to context so it survives the unmount.
  useEffect(() => {
    return () => {
      if (!currentDraftRef.current) return // cancelled or saved — nothing to preserve
      if (modeRef.current === 'add') {
        setPendingAddDraft(currentDraftRef.current)
      } else if (modeRef.current === 'edit' && selectedEntryRef.current) {
        setPendingEditDraft({
          originalId: selectedEntryRef.current.id,
          entry: currentDraftRef.current,
        })
      }
    }
  }, [setPendingAddDraft, setPendingEditDraft])
  // ────────────────────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    setMode('add')
  }, [setMode])

  const handleSaveEdit = useCallback(
    (updated: BibEntry) => {
      if (selectedEntry) {
        currentDraftRef.current = null
        saveEntry(selectedEntry, updated)
      }
    },
    [selectedEntry, saveEntry]
  )

  const handleSaveNew = useCallback(
    (entry: BibEntry) => {
      currentDraftRef.current = null
      addEntry(entry)
    },
    [addEntry]
  )

  const handleCancel = useCallback(() => {
    currentDraftRef.current = null // explicitly cancelled — don't preserve draft
    selectEntry(null)
    setMode('list')
  }, [selectEntry, setMode])

  const handleSelect = useCallback(
    (entry: ParsedBibEntry) => {
      selectEntry(entry)
    },
    [selectEntry]
  )

  // Show delete confirmation instead of deleting immediately
  const handleDeleteSelected = useCallback(() => {
    if (selectedEntry) {
      setShowDeleteConfirm(true)
    }
  }, [selectedEntry])

  const handleConfirmDelete = useCallback(() => {
    currentDraftRef.current = null // deleting — no draft needed
    if (selectedEntry) {
      deleteEntry(selectedEntry)
    }
    setShowDeleteConfirm(false)
  }, [selectedEntry, deleteEntry])

  // Intercept clicks on the EditorSwitch when in edit/add mode so we can
  // warn the user before discarding unsaved changes.
  const handleEditorSwitchCapture = useCallback(
    (e: React.MouseEvent) => {
      if (mode === 'list') return
      // Only intercept clicks aimed at activating the Code-editor option.
      // Labels are the visible/clickable part; the radio inputs are hidden.
      const label = (e.target as HTMLElement).closest('label') as HTMLLabelElement | null
      if (!label) return
      const radio = document.getElementById(label.htmlFor) as HTMLInputElement | null
      if (radio?.value !== 'cm6') return
      // Prevent the label from activating the radio → EditorSwitch onChange won't fire
      e.preventDefault()
      // Store where to scroll in the code editor (only relevant in edit mode)
      pendingScrollPosition.current =
        mode === 'edit' && selectedEntry ? selectedEntry.sourceStart : null
      setShowLeaveConfirm(true)
    },
    [mode, selectedEntry]
  )

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false)
    currentDraftRef.current = null // switching to Code — discard draft
    selectEntry(null)
    setMode('list')
    setShowVisual(false)
    // After the visual switch settles, scroll the code editor to the entry
    const pos = pendingScrollPosition.current
    if (pos !== null) {
      window.setTimeout(() => {
        document.dispatchEvent(
          new CustomEvent(BIB_SCROLL_TO_EVENT, { detail: { position: pos } })
        )
      }, 0)
      pendingScrollPosition.current = null
    }
  }, [selectEntry, setMode, setShowVisual])

  // Callback passed to BibEntryForm — updates the draft ref on every change.
  // Uses a ref (not state) so it doesn't cause re-renders.
  const handleDraftChange = useCallback((entry: BibEntry) => {
    currentDraftRef.current = entry
  }, [])

  // Initial entry for the edit form: use the pending edit draft if it matches
  // the currently selected entry, otherwise fall back to the saved entry values.
  const editFormEntry = useMemo(() => {
    if (!selectedEntry) return null
    if (pendingEditDraft?.originalId === selectedEntry.id) {
      return pendingEditDraft.entry
    }
    return {
      type: selectedEntry.type,
      id: selectedEntry.id,
      fields: { ...selectedEntry.fields },
    }
  }, [selectedEntry, pendingEditDraft])

  // Once the edit form has rendered with the draft, clear it from context so
  // the next time the user opens this entry they start from the saved state.
  useEffect(() => {
    if (
      mode === 'edit' &&
      selectedEntry &&
      pendingEditDraft?.originalId === selectedEntry.id
    ) {
      setPendingEditDraft(null)
    }
  }, [mode, selectedEntry, pendingEditDraft, setPendingEditDraft])

  return (
    <div className="bib-editor-panel">
      <div className="bib-editor-visual-nav">
        {mode !== 'list' && (
          <>
            <OLButton
              className="bib-editor-back-btn"
              size="sm"
              variant="link"
              leadingIcon="arrow_top_left"
              onClick={handleCancel}
            >
              {t('back')}
            </OLButton>
          </>
        )}
        {mode === 'list' && (
          <>
            <OLButton
              size="sm"
              variant="primary"
              onClick={handleAdd}
            >
              {t('Add new entry')}
            </OLButton>
          </>
        )}
        <span className="bib-editor-visual-nav-title">
          {mode === 'edit' && t('Edit Entry')}
          {mode === 'add' && t('New Entry')}
        </span>
        {/* Capture clicks on the toggle so we can warn before discarding unsaved form data */}
        <div onClickCapture={handleEditorSwitchCapture}>
          <EditorSwitch />
        </div>
      </div>
      <div className="bib-editor-panel-content">
        {mode === 'list' ? (
          <BibEntryList
            entries={entries}
            onSelect={handleSelect}
          />
        ) : mode === 'edit' && selectedEntry && editFormEntry ? (
          <BibEntryForm
            entry={editFormEntry}
            onSave={handleSaveEdit}
            onCancel={handleCancel}
            onDelete={handleDeleteSelected}
            existingIds={entries.map(e => e.id)}
            onDraftChange={handleDraftChange}
          />
        ) : mode === 'add' ? (
          <BibEntryForm
            entry={pendingAddDraft || { type: 'article', id: '', fields: {} }}
            onSave={handleSaveNew}
            onCancel={handleCancel}
            isNew
            existingIds={entries.map(e => e.id)}
            onDraftChange={handleDraftChange}
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

      {/* Leave-form confirmation (switching Visual → Code with unsaved changes) */}
      <GenericConfirmModal
        show={showLeaveConfirm}
        onHide={() => setShowLeaveConfirm(false)}
        title={t('Discard unsaved changes?')}
        message={t(
          'You have unsaved changes in the entry form. Switching to code mode will discard them.'
        )}
        confirmLabel={t('Switch to code')}
        onConfirm={handleConfirmLeave}
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
