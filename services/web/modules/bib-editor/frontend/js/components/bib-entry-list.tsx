/**
 * List of BibTeX entries shown in the visual editor (Phase C capture,
 * PHASE_C_PLAN.md §1.3/§3-C3).
 *
 * Compact windowed rows (capture `bibtex-entry-card-*` BEM), each with:
 *  - checkbox (`bibtex-entry-card-checkbox`, aria "Select entry")
 *  - citation key (`bibtex-entry-card-key`)
 *  - persistent error icon (`bibtex-entry-error-icon`, aria
 *    "Entry has errors") — per-entry required-field check, no Check press
 *  - compact details line (author / title / year)
 * Bulk bar: select-all (`bibtex-bulk-actions-select-all`, aria
 * "Select all entries") + count ("N reference(s)", `{ count }`).
 * Search placeholder is DYNAMIC: "Search <openDocName>" (capture).
 *
 * Windowing: absolutely positioned rows + data-index (capture), simple
 * overscan window — see virtual-list.ts (pure, unit-tested).
 *
 * Selection state is lifted (props) so the C4 preview panel can close a
 * previewed row's preview on bulk delete and keep preview consistent.
 */
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from '@/shared/components/dropdown/dropdown-menu'
import type { ParsedBibEntry } from '../utils/bib-parser'
import { getEntryType, getMissingRequiredFields } from '../utils/bib-types'
import {
  visibleWindow,
  spacerHeights,
  type WindowMath,
} from '../utils/virtual-list.ts'

const ROW_HEIGHT = 47

type Props = {
  entries: ParsedBibEntry[]
  onSelect: (entry: ParsedBibEntry) => void
  /** Preview binding (C4): the entry id whose preview is open */
  previewId?: string | null
  /** Bulk selection (C3): checked row ids (bulk-bar driven) */
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: (kind: 'all' | 'none') => void
  /** Bulk delete (C4/W5): the panel wires this to the guarded W5 write */
  onBulkDelete?: () => void
  /** Open document filename (dynamic "Search <file>" placeholder) */
  openDocName?: string
  /** C5: add actions (Paste references / Enter manually / Library stub) */
  onAddPaste: () => void
  onAddManual: () => void
}

export default function BibEntryList({
  entries,
  onSelect,
  previewId = null,
  selectedIds = [],
  onToggleSelect,
  onToggleSelectAll,
  onBulkDelete,
  openDocName,
  onAddPaste,
  onAddManual,
}: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(470)
  const searchRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      const title = (e.fields.title || '').toLowerCase()
      const author = (e.fields.author || '').toLowerCase()
      const editor = (e.fields.editor || '').toLowerCase()
      const id = e.id.toLowerCase()
      const year = (e.fields.year || '').toLowerCase()
      const venue = (
        e.fields.journal ||
        e.fields.journaltitle ||
        e.fields.booktitle ||
        ''
      ).toLowerCase()
      return (
        title.includes(q) ||
        author.includes(q) ||
        editor.includes(q) ||
        id.includes(q) ||
        year.includes(q) ||
        venue.includes(q)
      )
    })
  }, [entries, search])

  // Focus the search box when the list mounts (reviewer: on opening a bib
  // file in list mode, focus goes to the search box).
  useEffect(() => {
    if (entries.length > 0) {
      const raf = requestAnimationFrame(() => searchRef.current?.focus())
      return () => cancelAnimationFrame(raf)
    }
  }, [entries.length])

  // Viewport height (fixed-row windowing needs the visible height).
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined
    const measure = () => setViewportHeight(el.clientHeight || 470)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const window: WindowMath = visibleWindow(
    scrollTop,
    viewportHeight,
    ROW_HEIGHT,
    filtered.length
  )
  const spacers = spacerHeights(filtered.length, ROW_HEIGHT, window)

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearch('')
      }
    },
    []
  )

  return (
    <div className="bibtex-entry-list">
      <div className="bibtex-entry-list-toolbar">
        <div className="bibtex-toolbar-row">
          <input
            id="bib-list-search"
            ref={searchRef}
            type="search"
            className="bibtex-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('Search __fileName__', {
              fileName: openDocName || '.bib',
            })}
            aria-label={t('search')}
          />
          {/* C5 Add dropdown (capture bibtex-add-button): Paste references
              ["BibTeX, DOI"] / Enter manually. "Import from Library" (C9)
              stub lands here too (disabled + tooltip). */}
          <Dropdown align="end">
            <DropdownToggle
              className="bibtex-add-button btn-secondary btn-sm"
              aria-label={t('Add')}
              aria-expanded={false}
            >
              <span className="material-symbols" aria-hidden="true">
                add
              </span>
              {t('Add')}
            </DropdownToggle>
            <DropdownMenu>
              <DropdownItem description={t('BibTeX, DOI')} onClick={onAddPaste}>
                {t('Paste references')}
              </DropdownItem>
              <DropdownItem onClick={onAddManual}>
                {t('Enter manually')}
              </DropdownItem>
              {/* C9 stub — reserve the menu slot (user-confirmed) */}
              <DropdownItem disabled>
                <span title={t('Library import is not available in this build yet.')}>{t('Import from Library')}</span>
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>

      {/* Bulk bar (C3 capture): select-all ("Select all entries") +
          "N reference(s)" = the count of entries in view. Delete (C4
          wire-up over W5 core) appears when any row is checked. */}
      <div className="bibtex-bulk-actions-bar">
        <label className="bibtex-bulk-actions-select-all">
          <input
            type="checkbox"
            aria-label={t('Select all entries')}
            checked={
              filtered.length > 0 &&
              selectedIds.length > 0 &&
              selectedIds.every(id =>
                filtered.some(e => e.id === id)
              )
            }
            onChange={e => onToggleSelectAll?.(e.target.checked ? 'all' : 'none')}
          />
          <span>{t('Select all')}</span>
        </label>
        {selectedIds.length > 0 && onBulkDelete ? (
          <button
            type="button"
            className="bibtex-bulk-actions-delete btn btn-danger btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onBulkDelete?.()
            }}
          >
            {t('delete')}
          </button>
        ) : null}
        <span className="bibtex-bulk-actions-count">
          {t('__count__ reference(s)', { count: filtered.length })}
        </span>
      </div>

      <div className="bibtex-list-count" aria-hidden="true">
        {filtered.length === entries.length
          ? t('__count__ reference(s)', { count: entries.length })
          : `${filtered.length} / ${entries.length}`}
      </div>

      {(filtered.length === 0 || entries.length === 0) && (
        <div className="bib-list-empty">
          {entries.length === 0
            ? t('No bibliography entries yet. Click "Add new entry" to create one.')
            : t('No entries match your search.')}
        </div>
      )}

      {/* Windowed list body (capture: role=list, absolute rows, data-index) */}
      <div
        ref={viewportRef}
        className="bibtex-entry-list-body"
        role="list"
        onScroll={onScroll}
        style={{
          height:
            Math.max(spacers.top + (window.end - window.start) * ROW_HEIGHT + spacers.bottom, 47)
        }}
      >
        <div className="bibtex-list-spacer" style={{ height: spacers.top }} />
        {filtered.slice(window.start, window.end).map((entry, i) => (
          <div
            key={`${entry.id}-${entry.sourceStart}`}
            data-index={window.start + i}
            className="bibtex-entry-card-row"
            role="listitem"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}
          >
            <BibEntryCard
              entry={entry}
              index={window.start + i}
              onSelect={onSelect}
              previewing={previewId === entry.id}
              checked={selectedIds.includes(entry.id)}
              onToggleSelect={onToggleSelect}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function BibEntryCard({
  entry,
  index,
  onSelect,
  previewing,
  checked,
  onToggleSelect,
}: {
  entry: ParsedBibEntry
  index: number
  onSelect: (entry: ParsedBibEntry) => void
  previewing: boolean
  checked: boolean
  onToggleSelect?: (id: string) => void
}) {
  const t = useTranslation().t
  const typeDef = getEntryType(entry.type)
  const missingFields = typeDef
    ? getMissingRequiredFields(typeDef.requiredFields, entry.fields)
    : []
  const hasErrors =
    missingFields.length > 0 || entry.id.trim().length === 0
  const title = entry.fields.title || t('Untitled')
  const author = entry.fields.author || ''
  const year = entry.fields.year || entry.fields.date || ''

  // Truncate long author lists
  const authorDisplay = useMemo(() => {
    const parts = author.split(/\s+and\s+/i)
    if (parts.length <= 2) return author
    const first = parts[0] || ''
    return `${first} et al.`
  }, [author])

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(entry)
      }
    },
    [entry, onSelect]
  )

  return (
    <div
      id={`bibtex-entry-card-${entry.id}#${index}`}
      className={[
        'bibtex-entry-card',
        'bibtex-entry-card-compact',
        'bibtex-entry-card-clickable',
        hasErrors ? 'bibtex-entry-card-errors' : '',
        previewing ? 'bibtex-entry-card-previewing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={-1}
      onClick={() => onSelect(entry)}
      onKeyDown={handleCardKeyDown}
    >
      <div className="bibtex-entry-card-checkbox">
        <input
          type="checkbox"
          aria-label={t('Select entry')}
          checked={checked}
          onClick={e => e.stopPropagation()}
          onChange={() => onToggleSelect?.(entry.id)}
        />
      </div>
      <div className="bibtex-entry-card-content">
        <div className="bibtex-entry-card-header">
          <span className="bibtex-entry-card-key">{entry.id}</span>
          <span className="bibtex-entry-card-details">
            {authorDisplay && (
              <span className="bibtex-entry-card-author">{authorDisplay}</span>
            )}
            {title && <span className="bibtex-entry-card-title">{title}</span>}
            {year && <span className="bibtex-entry-card-year">{year}</span>}
          </span>
        </div>
      </div>
      {hasErrors && (
        <span className="bibtex-entry-error-icon" role="img" aria-label={t('Entry has errors')}>
          <span className="material-symbols" aria-hidden="true">
            error
          </span>
        </span>
      )}
    </div>
  )
}
