/**
 * Form component for editing a single BibTeX entry's fields.
 * Adapted from the old bib-importer manual editor, cleaned up
 * for the new sidebar-panel style.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import {
  Dropdown,
  DropdownToggle,
  DropdownMenu,
  DropdownItem,
} from '@/shared/components/dropdown/dropdown-menu'
import { generateCitationKey } from '../utils/bib-parser'
import { fetchEntryFromDoi } from '../utils/doi-fetcher'
import {
  ENTRY_TYPES,
  getEntryType,
  getFieldsForType,
} from '../utils/bib-types'
import type { BibEntry } from '../utils/bib-types'

type Props = {
  entry: BibEntry
  onSave: (entry: BibEntry) => void
  onCancel: () => void
  onDelete?: () => void
  isNew?: boolean
  /** IDs of all existing entries (to detect citation key collisions) */
  existingIds?: string[]
  /** Called on every form-state change so the parent can persist a draft */
  onDraftChange?: (entry: BibEntry) => void
}

/** Human-readable labels for field names */
const FIELD_LABELS: Record<string, string> = {
  author: 'Author(s)',
  title: 'title',
  journal: 'Journal',
  booktitle: 'Book Title',
  year: 'Year',
  month: 'Month',
  volume: 'Volume',
  number: 'Number / Issue',
  pages: 'Pages',
  publisher: 'Publisher',
  editor: 'Editor',
  school: 'School',
  institution: 'Institution',
  organization: 'Organization',
  series: 'Series',
  edition: 'Edition',
  chapter: 'Chapter',
  address: 'Address',
  howpublished: 'How Published',
  doi: 'DOI',
  url: 'URL',
  isbn: 'ISBN',
  issn: 'ISSN',
  keywords: 'Keywords',
  abstract: 'Abstract',
  note: 'Note',
  language: 'language',
  file: 'file',
}

const LARGE_FIELDS = new Set(['abstract', 'note', 'keywords'])

export default function BibEntryForm({
  entry,
  onSave,
  onCancel,
  onDelete,
  isNew = false,
  existingIds = [],
  onDraftChange,
}: Props) {
  const { t } = useTranslation()
  const [type, setType] = useState(entry.type || 'article')
  const [id, setId] = useState(entry.id || '')
  const [fields, setFields] = useState<Record<string, string>>({
    ...entry.fields,
  })
  const [showAllFields, setShowAllFields] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Report form-state changes for draft persistence across file-tree navigation
  useEffect(() => {
    onDraftChange?.({ type, id, fields })
  }, [type, id, fields, onDraftChange])

  // DOI fetch state
  const [doiInput, setDoiInput] = useState(entry.fields.doi || '')
  const [doiFetching, setDoiFetching] = useState(false)
  const [doiFetchError, setDoiFetchError] = useState<string | null>(null)
  const [doiFetchSuccess, setDoiFetchSuccess] = useState(false)

  const handleFetchDoi = useCallback(async () => {
    const rawDoi = doiInput.trim()
    if (!rawDoi) return
    setDoiFetching(true)
    setDoiFetchError(null)
    setDoiFetchSuccess(false)
    try {
      const fetched = await fetchEntryFromDoi(rawDoi)
      setType(fetched.type)
      setFields(prev => ({
        ...prev,
        ...fetched.fields,
        // keep existing DOI field consistent with what was typed
        doi: fetched.fields.doi || rawDoi,
      }))
      setDoiFetchSuccess(true)
    } catch (err) {
      setDoiFetchError(
        err instanceof Error ? err.message : 'Failed to fetch DOI'
      )
    } finally {
      setDoiFetching(false)
    }
  }, [doiInput])

  const entryTypeDef = getEntryType(type)
  const requiredFields = entryTypeDef?.requiredFields || []
  const optionalFields = entryTypeDef?.optionalFields || []

  // Show required fields + optional fields that have values, plus optionally all
  const visibleFields = showAllFields
    ? getFieldsForType(type)
    : [
      ...requiredFields,
      ...optionalFields.filter(f => fields[f]?.trim()),
    ]

  // Deduplicate
  const uniqueVisible = [...new Set(visibleFields)]

  const handleFieldChange = useCallback((name: string, value: string) => {
    setFields(prev => ({ ...prev, [name]: value }))
  }, [])

  const handleGenerateKey = useCallback(() => {
    const base = generateCitationKey(fields)
    // When editing, the current entry's own ID is not a collision
    const otherIds = new Set(
      isNew ? existingIds : existingIds.filter(eid => eid !== entry.id)
    )
    if (!otherIds.has(base)) {
      setId(base)
      return
    }
    // Append 'b', 'c', ... until we find a free key
    const suffixes = 'bcdefghijklmnopqrstuvwxyz'
    for (const ch of suffixes) {
      const candidate = `${base}${ch}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    // Fallback: numeric suffix
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}${n}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    setId(base) // give up, use base
  }, [fields, existingIds, isNew, entry.id])

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {}

    if (!id.trim()) {
      errs.id = t('Citation key is required')
    } else if (!/^[A-Za-z0-9_:.\-/]+$/.test(id)) {
      errs.id = t('Citation key contains invalid characters')
    }

    for (const f of requiredFields) {
      if (!fields[f]?.trim()) {
        errs[f] = t(FIELD_LABELS[f] || f) + ' ' + t('is required')
      }
    }

    if (fields.year && !/^\d{4}$/.test(fields.year.trim())) {
      errs.year = t('Year should be a 4-digit number')
    }

    if (fields.doi && !/^10\.\d{4,9}\/\S+$/.test(fields.doi.trim())) {
      errs.doi = t('DOI format looks invalid')
    }

    if (fields.url) {
      try {
        new URL(fields.url.trim())
      } catch {
        errs.url = t('URL looks invalid')
      }
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }, [id, fields, requiredFields, t])

  const handleSave = useCallback(() => {
    if (!validate()) return
    onSave({ type, id: id.trim(), fields })
  }, [type, id, fields, validate, onSave])

  const selectedType = ENTRY_TYPES.find(et => et.name === type)

  return (
    <div className="bib-entry-form">
      {/* DOI import row */}
      <div className="bib-form-row">
        <OLFormLabel className="bib-form-label" htmlFor="bib-doi-import">
          {t('Import from DOI')}
        </OLFormLabel>
        <div className="bib-doi-row">
          <OLFormControl
            id="bib-doi-import"
            className="bib-form-input"
            maxLength="128"
            type="text"
            value={doiInput}
            onChange={e => {
              setDoiInput(e.target.value)
              setDoiFetchSuccess(false)
              setDoiFetchError(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleFetchDoi()
              }
            }}
            placeholder="10.1038/s41586-021-03819-2"
          />
          <OLButton
            variant="secondary"
            size="sm"
            disabled={doiFetching || !doiInput.trim()}
            onClick={handleFetchDoi}
            form="clone-project-form"
          >
            {doiFetching ? '…' : t('Fetch')}
          </OLButton>
        </div>
        {doiFetchError && (
          <span className="bib-form-error">{doiFetchError}</span>
        )}
        {doiFetchSuccess && (
          <span className="bib-doi-success">{t('Fields populated from DOI')}</span>
        )}
      </div>

      <hr className="bib-form-divider" />

      {/* Entry type selector */}
      <div className="bib-form-row">
        <OLFormLabel className="bib-form-label" htmlFor="bib-type">
          {t('Type')}
        </OLFormLabel>
        <Dropdown>
          <DropdownToggle
            id="bib-type-dropdown"
            className="btn-secondary"
            aria-label="Select bibliography entry type"
          >
            <span className="text-truncate" aria-hidden>
              @{selectedType?.name} — {selectedType?.label}
            </span>
          </DropdownToggle>

          <DropdownMenu flip={false}>
            {ENTRY_TYPES.map(et => (
              <DropdownItem
                key={et.name}
                active={et.name === type}
                onClick={() => setType(et.name)}
              >
                @{et.name} — {et.label}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
      </div>

      {/* Citation key */}
      <div className="bib-form-row">
        <OLFormLabel className="bib-form-label" htmlFor="bib-key">
          {t('Citation Key')}
          <span className="bib-form-required"> *</span>
          {errors.id && (
            <span className="bib-form-error"> — {errors.id}</span>
          )}
        </OLFormLabel>
        <div className="bib-form-key-row">
          <OLFormControl
            className={`bib-form-input ${errors.id ? 'bib-form-input-error' : ''}`}
            maxLength="128"
            autoComplete="off"
            type="text"
            id="bib-key"
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="e.g. smith2024"
          />
          <OLTooltip
            key={'tooltip-generate'}
            id={'tooltip-generate'}
            description={t('Auto-generate from author/year')}
            overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
          >
            <OLButton
              variant="secondary"
              size="sm"
              onClick={handleGenerateKey}
            >
              {t('Generate')}
            </OLButton>
          </OLTooltip>
        </div>
      </div>

      {/* Entry fields */}
      {uniqueVisible.map(fieldName => (
        <div className="bib-form-row" key={fieldName}>
          <OLFormLabel
            className="bib-form-label"
            htmlFor={`bib-field-${fieldName}`}
          >
            {t(FIELD_LABELS[fieldName]) || fieldName}
            {requiredFields.includes(fieldName) && (
              <span className="bib-form-required"> *</span>
            )}
            {errors[fieldName] && (
              <span className="bib-form-error"> — {errors[fieldName]}</span>
            )}
          </OLFormLabel>
          {LARGE_FIELDS.has(fieldName) ? (
            <OLFormControl
              as="textarea"
              id={`bib-field-${fieldName}`}
              className={`bib-form-textarea ${errors[fieldName] ? 'bib-form-input-error' : ''}`}
              maxLength="4096"
              autoComplete="off"
              type="text"
              value={fields[fieldName] || ''}
              onChange={e => handleFieldChange(fieldName, e.target.value)}
              rows={3}
            />
          ) : fieldName === 'author' ? (
            <AuthorField
              value={fields[fieldName] || ''}
              onChange={val => handleFieldChange(fieldName, val)}
              error={errors[fieldName]}
            />
          ) : (
            <OLFormControl
              id={`bib-field-${fieldName}`}
              className={`bib-form-input ${errors[fieldName] ? 'bib-form-input-error' : ''}`}
              maxLength="512"
              type="text"
              value={fields[fieldName] || ''}
              onChange={e => handleFieldChange(fieldName, e.target.value)}
            />
          )}
        </div>
      ))}

      {/* Toggle optional fields */}
      <div className="bib-form-row">
        <OLButton
          variant="link"
          size="sm"
          className="bib-form-toggle-opt-fields"
          onClick={() => setShowAllFields(!showAllFields)}
        >
          {showAllFields
            ? t('Show fewer fields')
            : t('Show all fields')}
        </OLButton>
      </div>

      {/* Footer: Delete on left, Cancel/Save on right */}
      <div className="bib-form-footer">
        <div className="bib-form-footer-left">
          {!isNew && onDelete && (
            <OLButton
              variant="danger"
              size="sm"
              onClick={onDelete}
            >
              {t('delete')}
            </OLButton>
          )}
        </div>
        <div className="bib-form-footer-right">
          <OLButton
            variant="secondary"
            size="sm"
            onClick={onCancel}
          >
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            size="sm"
            onClick={handleSave}
          >
            {isNew ? t('add') : t('save')}
          </OLButton>
        </div>
      </div>
    </div>
  )
}

/**
 * Author field with "and"-separated author management.
 * Internal state handles empty rows; only serializes non-empty authors to onChange.
 * Supports reordering via up/down buttons.
 */
function AuthorField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  const { t } = useTranslation()

  const parseAuthors = (v: string) =>
    v ? v.split(/\s+and\s+/i).map(a => a.trim()) : ['']

  // Maintain internal list (including empty in-progress rows)
  const [authors, setAuthors] = useState<string[]>(() => parseAuthors(value))

  // Sync when value changes from outside (e.g. DOI fetch, field reset)
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      setAuthors(parseAuthors(value))
    }
  }, [value])

  // Serialize non-empty authors back to the parent
  const commit = (list: string[]) => {
    const serialized = list.filter(a => a.trim()).join(' and ')
    onChange(serialized)
  }

  const setAuthorAt = (idx: number, val: string) => {
    const next = authors.map((a, i) => (i === idx ? val : a))
    setAuthors(next)
    commit(next)
  }

  const addAuthor = () => {
    // Just extend the internal list; don't commit (empty row has no content yet)
    setAuthors(prev => [...prev, ''])
  }

  const removeAuthor = (idx: number) => {
    const next = authors.length > 1 ? authors.filter((_, i) => i !== idx) : ['']
    setAuthors(next)
    commit(next)
  }

  const moveAuthor = (idx: number, dir: -1 | 1) => {
    const to = idx + dir
    if (to < 0 || to >= authors.length) return
    const next = [...authors]
      ;[next[idx], next[to]] = [next[to], next[idx]]
    setAuthors(next)
    commit(next)
  }

  return (
    <div className="bib-author-field">
      {authors.map((a, i) => (
        <div key={i} className="bib-author-row">
          <OLFormControl
            className={`bib-form-input ${error ? 'bib-form-input-error' : ''}`}
            maxLength="128"
            type="text"
            id={`bib-field-author-${i}`}
            value={a}
            onChange={e => setAuthorAt(i, e.target.value)}
            placeholder={t('Last, First') || 'Last, First'}
          />
          <div className="bib-author-actions">
            <OLIconButton
              icon="arrow_upward_alt"
              variant="secondary"
              size="sm"
              accessibilityLabel={t('Move up')}
              onClick={() => moveAuthor(i, -1)}
              disabled={i === 0}
            />
            <OLIconButton
              icon="arrow_downward_alt"
              variant="secondary"
              size="sm"
              accessibilityLabel={t('Move down')}
              onClick={() => moveAuthor(i, 1)}
              disabled={i === authors.length - 1}
            />
            <OLIconButton
              icon="close"
              variant="danger-ghost"
              size="sm"
              accessibilityLabel={t('Remove author')}
              onClick={() => removeAuthor(i)}
              disabled={authors.length === 1 && !a.trim()}
            />
          </div>
        </div>
      ))}
      <OLButton
        variant="secondary"
        size="sm"
        className="bib-author-add"
        onClick={addAuthor}
      >
        {t('Add author')}
      </OLButton>
    </div>
  )
}
