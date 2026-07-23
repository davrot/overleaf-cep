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
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useBibEditorContext } from '../context/bib-editor-context'
import BibEntryList from './bib-entry-list'
import BibEntryForm from './bib-entry-form'
import { BIB_SCROLL_TO_EVENT } from '../extensions/bib-editor-extension'
import '../../stylesheets/bib-editor-panel.css'
import type { BibEntry } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'
import { generateCitationKey } from '../utils/bib-parser'

function BibEditorPanel() {
  const { t } = useTranslation()
  const {
    isBibFile,
    entries,
    selectedEntry,
    mode,
    setMode,
    selectEntry,
    saveEntry,
    addEntry,
    deleteEntry,
    pendingAddDraft,
    pendingEditDraft,
    setPendingAddDraft,
    setPendingEditDraft,
  } = useBibEditorContext()
  const { setShowVisual } = useEditorPropertiesContext()
  const { openDocName } = useEditorOpenDocContext()

  // --- confirmation modal state ---
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // store the scroll position to focus in Code after a Visual→Code switch
  const pendingScrollPosition = useRef<number | null>(null)

  // currentDraftRef holds the latest form values (updated via onDraftChange).
  const currentDraftRef = useRef<BibEntry | null>(null)
  const modeRef = useRef(mode)
  const selectedEntryRef = useRef(selectedEntry)
  const openDocNameRef = useRef(openDocName)
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { selectedEntryRef.current = selectedEntry }, [selectedEntry])
  useEffect(() => { openDocNameRef.current = openDocName }, [openDocName])

  // Ensure unfinished forms are persisted directly into the .bib source
  // when the panel unmounts or when the current file changes.
  useEffect(() => {
    return () => {
      if (!currentDraftRef.current) return
      const draft = ensureEntryId(currentDraftRef.current)
      if (modeRef.current === 'edit' && selectedEntryRef.current) {
        setPendingEditDraft({ originalId: selectedEntryRef.current.id, entry: draft })
      } else if (modeRef.current === 'add') {
        setPendingAddDraft(draft)
      }
    }
  }, [setPendingEditDraft, setPendingAddDraft])

  useEffect(() => {
    if (openDocNameRef.current !== null && openDocName !== openDocNameRef.current) {
      // The opened document changed while the visual editor stayed mounted.
      // Persist the current draft instead of writing it directly back to source.
      if (currentDraftRef.current) {
        const draft = ensureEntryId(currentDraftRef.current)
        if (modeRef.current === 'edit' && selectedEntryRef.current) {
          setPendingEditDraft({ originalId: selectedEntryRef.current.id, entry: draft })
        } else if (modeRef.current === 'add') {
          setPendingAddDraft(draft)
        }
        currentDraftRef.current = null
      }
    }
  }, [openDocName, setPendingEditDraft, setPendingAddDraft])

  useEffect(() => {
    if (!isBibFile && mode !== 'list') {
      setMode('list')
      return
    }

    if (mode === 'list') {
      if (pendingEditDraft && entries.some(entry => entry.id === pendingEditDraft.originalId)) {
        const restored = entries.find(entry => entry.id === pendingEditDraft.originalId)
        if (restored) {
          selectEntry(restored)
          setMode('edit')
          return
        }
      }
      if (pendingAddDraft) {
        setMode('add')
      }
    }
  }, [isBibFile, mode, entries, pendingAddDraft, pendingEditDraft, selectEntry, setMode])

  // ────────────────────────────────────────────────────────────────────────

  const ensureEntryId = useCallback((entry: BibEntry): BibEntry => {
    if (entry.id?.trim()) return entry
    const generated = generateCitationKey(entry.fields)
    return { ...entry, id: generated }
  }, [])

  const saveCurrentDraft = useCallback(() => {
    if (!currentDraftRef.current) return
    const draft = ensureEntryId(currentDraftRef.current)
    if (modeRef.current === 'edit' && selectedEntryRef.current) {
      setPendingEditDraft({ originalId: selectedEntryRef.current.id, entry: draft })
    } else if (modeRef.current === 'add') {
      setPendingAddDraft(draft)
    }
    currentDraftRef.current = null
  }, [ensureEntryId, setPendingAddDraft, setPendingEditDraft])

  const handleAdd = useCallback(() => {
    setMode('add')
  }, [setMode])

  const handleSaveEdit = useCallback(
    (updated: BibEntry) => {
      if (selectedEntry) {
        currentDraftRef.current = null
        setPendingEditDraft(null)
        saveEntry(selectedEntry, updated)
      }
    },
    [selectedEntry, saveEntry, setPendingEditDraft]
  )

  const handleSaveNew = useCallback(
    (entry: BibEntry) => {
      currentDraftRef.current = null
      setPendingAddDraft(null)
      addEntry(entry)
    },
    [addEntry, setPendingAddDraft]
  )

  const handleCancel = useCallback(() => {
    currentDraftRef.current = null // explicitly cancelled — don't preserve draft
    setPendingAddDraft(null)
    setPendingEditDraft(null)
    selectEntry(null)
    setMode('list')
  }, [selectEntry, setMode, setPendingAddDraft, setPendingEditDraft])

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
      const label = (e.target as HTMLElement).closest('label') as HTMLLabelElement | null
      if (!label) return
      const radio = document.getElementById(label.htmlFor) as HTMLInputElement | null
      if (radio?.value !== 'cm6') return
      e.preventDefault()
      pendingScrollPosition.current =
        mode === 'edit' && selectedEntry ? selectedEntry.sourceStart : null
      saveCurrentDraft()
      selectEntry(null)
      setMode('list')
      setShowVisual(false)
      const pos = pendingScrollPosition.current
      if (pos !== null) {
        window.setTimeout(() => {
          document.dispatchEvent(
            new CustomEvent(BIB_SCROLL_TO_EVENT, { detail: { position: pos } })
          )
        }, 0)
        pendingScrollPosition.current = null
      }
    },
    [mode, selectedEntry, saveCurrentDraft, selectEntry, setMode, setShowVisual]
  )

  // Callback passed to BibEntryForm — updates the draft ref on every change.
  // Uses a ref (not state) so it doesn't cause re-renders.
  const handleDraftChange = useCallback((entry: BibEntry) => {
    currentDraftRef.current = entry
  }, [])

  // Initial entry for the edit form: use the selected entry's current values.
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

  const addFormEntry = useMemo(() => {
    return pendingAddDraft ?? { type: 'article', id: '', fields: {} }
  }, [pendingAddDraft])

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
            entry={addFormEntry}
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
