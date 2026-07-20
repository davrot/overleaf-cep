/**
 * BibEditor visual component — rendered in the main editor window when
 * the user switches to "Visual" mode on a .bib file.
 *
 * States:
 * - List mode: searchable entry list; clicking an entry opens the editor
 * - Edit mode: entry form with Delete/Cancel/Save in the footer
 * - Add mode: empty entry form with Cancel/Add in the footer
 */
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import withErrorBoundary from '@/infrastructure/error-boundary'
import EditorSwitch from '@/features/source-editor/components/editor-switch'
import { useBibEditorContext } from '../context/bib-editor-context'
import BibEntryList from './bib-entry-list'
import BibEntryForm from './bib-entry-form'
import './bib-editor-panel.css'
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

  const handleDeleteSelected = useCallback(() => {
    if (selectedEntry) {
      deleteEntry(selectedEntry)
    }
  }, [selectedEntry, deleteEntry])

  return (
    <div className="bib-editor-panel">
      <div className="bib-editor-visual-nav">
        <div className="bib-editor-visual-nav-left">
          {mode !== 'list' && (
            <>
              <button
                className="btn btn-link btn-sm bib-editor-back-btn"
                onClick={handleCancel}
              >
                ← {t('Back')}
              </button>
              <span className="bib-editor-visual-nav-title">
                {mode === 'edit' ? t('Edit Entry') : t('New Entry')}
              </span>
            </>
          )}
        </div>
        <EditorSwitch />
      </div>
      <div className="bib-editor-panel-content">
        {mode === 'list' ? (
          <BibEntryList
            entries={entries}
            onSelect={handleSelect}
            onAdd={handleAdd}
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
