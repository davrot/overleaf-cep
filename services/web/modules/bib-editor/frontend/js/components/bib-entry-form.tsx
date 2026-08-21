/**
 * Form component for editing a single BibTeX entry.
 *
 * One form for both "existing" and "new" entries (REDESIGN_PLAN.md §2.3):
 *  - The primary button is always **Check** (validate only — for a new form
 *    it also materializes the entry into the file).
 *  - **Stars** follow the reviewer rule: a standalone required field shows a
 *    star while empty; every member of an OR-group shows a star while all of
 *    its members are empty. `requiredStarMembers` computes the live stars.
 *  - **Check messages** come from `validateEntry` (pure): standalone →
 *    "X is required"; OR-group → "Either A or B is required" under each empty
 *    member.
 *  - No pseudo-field rows: OR-groups are flattened; `displayFieldsFor` decides
 *    which fields are visible (existing: required + optional + valued;
 *    new: required + common optional; `showAll` reveals everything by type).
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
  displayFieldsFor,
  requiredStarMembers,
  flattenRequired,
} from '../utils/bib-types'
import { validateEntry } from '../utils/bib-validate'
import type { BibEntry } from '../utils/bib-types'

type Props = {
  /** The entry values the form starts from */
  entry: BibEntry
  kind: 'existing' | 'new'
  /** For 'existing': the citation key as parsed from the document */
  originalId: string | null
  /** IDs of all existing entries (citation-key collision hints) */
  existingIds?: string[]
  /** Called on every form-state change (panel flush bookkeeping) */
  onFormChange: (entry: BibEntry, originalId: string | null) => void
  /** Called when Check is pressed (new: also materializes) */
  onChecked: (entry: BibEntry, kind: 'existing' | 'new', originalId: string | null) => void
  onDelete?: () => void
  onBack?: () => void
}

/** Human-readable (untranslated) field labels for messages/tooltips */
function fieldLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const LARGE_FIELDS = new Set(['abstract', 'note', 'keywords'])

export default function BibEntryForm({
  entry,
  kind,
  originalId,
  existingIds = [],
  onFormChange,
  onChecked,
  onDelete,
  onBack,
}: Props) {
  const { t } = useTranslation()
  const [type, setType] = useState(entry.type || 'article')
  const [id, setId] = useState(entry.id || '')
  const [fields, setFields] = useState<Record<string, string>>({
    ...entry.fields,
  })
  const [showAllFields, setShowAllFields] = useState(false)
  const [checked, setChecked] = useState(false)
  // Notify the panel on every form change (flush bookkeeping).
  useEffect(() => {
    onFormChange({ type, id, fields }, kind === 'existing' ? originalId : null)
  }, [type, id, fields, kind, originalId, onFormChange])

  // Re-sync from the parsed entry when a different entry is opened
  // (selection change remounts the form — this effect covers it).
  const [entrySig, setEntrySig] = useState(
    () => `${kind}:${originalId ?? ''}:${JSON.stringify(entry)}`
  )
  useEffect(() => {
    const sig = `${kind}:${originalId ?? ''}:${JSON.stringify(entry)}`
    if (sig !== entrySig) {
      setEntrySig(sig)
      setType(entry.type || 'article')
      setId(entry.id || '')
      setFields({ ...entry.fields })
      setShowAllFields(false)
      setChecked(false)
    }
  }, [entry, kind, originalId, entrySig])

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
        doi: fetched.fields.doi || rawDoi,
      }))
      setDoiFetchSuccess(true)
    } catch (err) {
      setDoiFetchError(
        err instanceof Error ? err.message : t('Failed to fetch DOI')
      )
    } finally {
      setDoiFetching(false)
    }
  }, [doiInput, t])

  const entryTypeDef = getEntryType(type)

  // Live validation (pure): stars + per-field Check messages.
  const starMembers = entryTypeDef
    ? new Set(requiredStarMembers(entryTypeDef.requiredFields, fields))
    : new Set<string>()

  const checkResult = checked
    ? validateEntry({ type, id, fields }, kind)
    : null

  const visibleFields = displayFieldsFor(
    entryTypeDef,
    kind,
    fields,
    showAllFields
  )

  const requiredStarSet = starMembers

  const handleFieldChange = useCallback((name: string, value: string) => {
    setFields(prev => ({ ...prev, [name]: value }))
  }, [])

  const handleGenerateKey = useCallback(() => {
    const base = generateCitationKey(fields)
    // When editing, the current entry's own ID is not a collision
    const otherIds = new Set(
      kind === 'new'
        ? existingIds
        : existingIds.filter(eid => eid !== originalId)
    )
    if (!otherIds.has(base)) {
      setId(base)
      return
    }
    for (const ch of 'bcdefghijklmnopqrstuvwxyz') {
      const candidate = `${base}${ch}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}${n}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    setId(base)
  }, [fields, existingIds, kind, originalId])

  const handleCheck = useCallback(() => {
    setChecked(true)
    onChecked({ type, id: id.trim(), fields }, kind, originalId)
  }, [type, id, fields, kind, originalId, onChecked])

  const handleTypeChange = useCallback((name: string) => {
    setType(name)
    setChecked(false)
  }, [])

  const selectedType = ENTRY_TYPES.find(et => et.name === type)

  // Field message after Check.
  //   standalone missing → "<Label> is required"
  //   OR-group missing   → "Either A or B is required" (one message per empty member)
  const messageFor = (fieldName: string): string | null => {
    if (!checkResult) {
      return null
    }
    const msg = checkResult.byField[fieldName]
    if (!msg) {
      return null
    }
    switch (msg.kind) {
      case 'required-missing': {
        const a = msg.labelFields[0]
        const b = msg.labelFields[1]
        if (msg.group && a && b !== undefined) {
          return t('Either __a__ or __b__ is required', {
            a: fieldLabel(a),
            b: fieldLabel(b),
          })
        }
        return t('__a__ is required', { a: fieldLabel(fieldName) })
      }
      case 'id-required':
        return t('Citation key is required')
      case 'id-invalid':
        return t('Citation key contains invalid characters')
      case 'year-format':
        return t('Year should be a 4-digit number')
      case 'doi-format':
        return t('DOI format looks invalid')
      case 'url-invalid':
        return t('URL looks invalid')
      default:
        return null
    }
  }

  // Focus D3: on opening an entry, focus the first empty required field,
  // falling back to the citation key.
  const focusOnceRef = useRef(false)
  useEffect(() => {
    if (focusOnceRef.current) return
    focusOnceRef.current = true
    const firstEmpty = flattenRequired(
      getEntryType(type)?.requiredFields || []
    ).find(f => !fields[f]?.trim())
    const targetId =
      firstEmpty === 'author'
        ? 'bib-field-author-0'
        : firstEmpty
        ? `bib-field-${firstEmpty}`
        : 'bib-key'
    const raf = requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [type, fields])

  // W2 (§2.7): Esc while typing in a form FIELD = back to the list (Back
  // flushes per R2; focus lands on the list's search box via its mount
  // effect). Scoped to text inputs only — Esc on the Check button, the type
  // dropdown toggle, or any other control does nothing (no interference
  // with the UI-kit dropdown's own Esc handling).
  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Escape') return
      const el = e.target
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (onBack) onBack()
    },
    [onBack]
  )

  return (
    // W2 (§2.7): Esc while typing in a form FIELD = back to the list (Back
    // flushes per R2; focus lands on the list's search box via its mount
    // effect). Scoped to text inputs: Esc on the Check button, the type
    // dropdown toggle, or any other control does nothing (no interference
    // with the UI-kit dropdown's own Esc handling). The form div is the
    // bubbling target (repo pattern for onKeyDown-on-div, e.g.
    // file-tree-inner, pdf-js-viewer).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="bib-entry-form"
      onKeyDown={handleFormKeyDown}
    >
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
            onClick={() => void handleFetchDoi()}
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
            aria-label={t('Choose entry type')}
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
                onClick={() => handleTypeChange(et.name)}
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
          {kind === 'existing' && (
            <span className="bib-form-required"> *</span>
          )}
        </OLFormLabel>
        <div className="bib-form-key-row">
          <OLFormControl
            className={`bib-form-input ${
              checkResult?.byField.id ? 'bib-form-input-error' : ''
            }`}
            maxLength="128"
            autoComplete="off"
            type="text"
            id="bib-key"
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="e.g. smith2024"
          />
          <OLTooltip
            key="tooltip-generate"
            id="tooltip-generate"
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
        {kind === 'new' && (
          <span className="bib-form-hint">{t('Leave empty to generate on Check')}</span>
        )}
        {kind === 'existing' && checkResult?.byField.id && (
          <span className="bib-form-error">
            {messageFor('id')}
          </span>
        )}
      </div>

      {/* Entry fields */}
      {visibleFields.map(fieldName => {
        const isStarred = requiredStarSet.has(fieldName)
        const message = messageFor(fieldName)
        return (
          <div className="bib-form-row" key={fieldName}>
            <OLFormLabel
              className="bib-form-label"
              htmlFor={`bib-field-${fieldName}`}
            >
              {fieldLabel(fieldName)}
              {isStarred && (
                <span className="bib-form-required"> *</span>
              )}
            </OLFormLabel>
            {LARGE_FIELDS.has(fieldName) ? (
              <OLFormControl
                as="textarea"
                id={`bib-field-${fieldName}`}
                className={`bib-form-textarea ${
                  message ? 'bib-form-input-error' : ''
                }`}
                maxLength="4096"
                autoComplete="off"
                type="text"
                value={fields[fieldName] || ''}
                onChange={e => handleFieldChange(fieldName, e.target.value)}
                rows={3}
              />
            ) : fieldName === 'author' ? (
              <BibAuthorField
                value={fields[fieldName] || ''}
                onChange={val => handleFieldChange(fieldName, val)}
                error={!!message}
              />
            ) : (
              <OLFormControl
                id={`bib-field-${fieldName}`}
                className={`bib-form-input ${
                  message ? 'bib-form-input-error' : ''
                }`}
                maxLength="512"
                type="text"
                value={fields[fieldName] || ''}
                onChange={e => handleFieldChange(fieldName, e.target.value)}
              />
            )}
            {message && (
              <span className="bib-form-error">{message}</span>
            )}
          </div>
        )
      })}

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

      {/* Footer: Delete (existing only) on left, Back + Check on right */}
      <div className="bib-form-footer">
        <div className="bib-form-footer-left">
          {kind === 'existing' && onDelete && (
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
            onClick={onBack}
          >
            {t('back')}
          </OLButton>
          <OLButton
            variant="primary"
            size="sm"
            onClick={handleCheck}
          >
            {t('Check')}
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
function BibAuthorField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error?: boolean
}) {
  const { t } = useTranslation()

  const parseAuthors = useCallback(
    (v: string) => (v ? v.split(/\s+and\s+/i).map(a => a.trim()) : ['']),
    []
  )

  const [authors, setAuthors] = useState<string[]>(() => parseAuthors(value))

  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      setAuthors(parseAuthors(value))
    }
  }, [value, parseAuthors])

  const commit = (list: string[]) => {
    onChange(list.filter(a => a.trim()).join(' and '))
  }

  const setAuthorAt = (idx: number, val: string) => {
    const next = authors.map((a, i) => (i === idx ? val : a))
    setAuthors(next)
    commit(next)
  }

  const addAuthor = () => {
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
            placeholder={t('Last, First')}
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
