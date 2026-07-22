/**
 * BibEditor visual component — rendered in the main editor window when
 * the user switches to "Visual" mode on a .bib file.
 *
 * States:
 * - List mode: searchable entry list; clicking an entry opens the editor
 * - Edit mode: entry form with Delete/Cancel/Save in the footer
 * - Add mode: empty entry form with Cancel/Add in the footer
 */
import React, { useCallback, useRef, useState } from 'react'
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
  } = useBibEditorContext()
  const { setShowVisual } = useEditorPropertiesContext()

  // --- confirmation modal state ---
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  // store the scroll position to focus in Code after a confirmed Visual→Code switch
  const pendingScrollPosition = useRef<number | null>(null)

  const handleAdd = useCallback(() => {
    setMode('add')
  }, [setMode])

  const handleSaveEdit = useCallback(
    (updated: BibEntry) => {
      if (selectedEntry) {
        saveEntry(selectedEntry, updated)
      }
    },
    [selectedEntry, saveEntry]
  )

  const handleSaveNew = useCallback(
    (entry: BibEntry) => {
      addEntry(entry)
    },
    [addEntry]
  )

  const handleCancel = useCallback(() => {
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
        ) : mode === 'edit' && selectedEntry ? (
          <BibEntryForm
            entry={{
              type: selectedEntry.type,
              id: selectedEntry.id,
              fields: { ...selectedEntry.fields },
            }}
            onSave={handleSaveEdit}
            onCancel={handleCancel}
            onDelete={handleDeleteSelected}
            existingIds={entries.map(e => e.id)}
          />
        ) : mode === 'add' ? (
          <BibEntryForm
            entry={{ type: 'article', id: '', fields: {} }}
            onSave={handleSaveNew}
            onCancel={handleCancel}
            isNew
            existingIds={entries.map(e => e.id)}
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
