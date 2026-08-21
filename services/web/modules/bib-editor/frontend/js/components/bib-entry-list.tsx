/**
 * List of BibTeX entries shown in the visual editor.
 *
 * Keyboard (REDESIGN_PLAN.md §2.7):
 *  - the search box is focused on mount (when entries exist),
 *  - ArrowUp/ArrowDown move through the entry cards (Enter opens),
 *  - Escape / clear search resets the filter.
 * Bulk selection is Phase B (plan §8) — no selection UI here yet.
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParsedBibEntry } from '../utils/bib-parser'
import {
  getEntryType,
  getMissingRequiredFields,
} from '../utils/bib-types'

type Props = {
  entries: ParsedBibEntry[]
  onSelect: (entry: ParsedBibEntry) => void
}

export default function BibEntryList({ entries, onSelect }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e => {
      const title = (e.fields.title || '').toLowerCase()
      const author = (e.fields.author || '').toLowerCase()
      const id = e.id.toLowerCase()
      const year = (e.fields.year || '').toLowerCase()
      const venue =
        (e.fields.journal || e.fields.booktitle || '').toLowerCase()
      return (
        title.includes(q) ||
        author.includes(q) ||
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
      const raf = requestAnimationFrame(() => {
        searchRef.current?.focus()
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [entries.length])

  const focusCard = useCallback((i: number) => {
    setActive(i)
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(`bib-card-${i}`)
        ?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusCard(Math.min(active + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        focusCard(Math.max(active - 1, 0))
      } else if (e.key === 'Home') {
        e.preventDefault()
        focusCard(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        focusCard(filtered.length - 1)
      } else if (e.key === 'Enter' && e.target === searchRef.current) {
        e.preventDefault()
        focusCard(active)
      }
    },
    [filtered.length, active, focusCard]
  )

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent, i: number) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusCard(Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        focusCard(Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(filtered[i])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    },
    [filtered, onSelect, focusCard]
  )

  return (
    <div className="bib-entry-list" onKeyDown={handleListKeyDown}>
      {/* Inline search (module-local; the upstream SearchForm is project-
          list specific — REDESIGN_PLAN §2.8) */}
      <input
        id="bib-list-search"
        ref={searchRef}
        type="search"
        className="bib-list-search-input"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('Search for entries')}
        aria-label={t('Search for entries')}
      />

      {/* Entry count */}
      <div className="bib-list-count">
        {filtered.length === entries.length
          ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
          : `${filtered.length} of ${entries.length} entries`}
      </div>

      {/* Entry list */}
      <div className="bib-list-entries">
        {filtered.length === 0 && (
          <div className="bib-list-empty">
            {entries.length === 0
              ? t('No bibliography entries yet. Click "Add new entry" to create one.')
              : t('No entries match your search.')}
          </div>
        )}
        {filtered.map((entry, i) => (
          <BibEntryCard
            key={`${entry.id}-${entry.sourceStart}`}
            entry={entry}
            index={i}
            onSelect={onSelect}
            onCardKeyDown={handleCardKeyDown}
          />
        ))}
      </div>
    </div>
  )
}

function BibEntryCard({
  entry,
  index,
  onSelect,
  onCardKeyDown,
}: {
  entry: ParsedBibEntry
  index: number
  onSelect: (entry: ParsedBibEntry) => void
  onCardKeyDown: (e: React.KeyboardEvent, i: number) => void
}) {
  const t = useTranslation().t
  const typeDef = getEntryType(entry.type)
  const missingFields = typeDef
    ? getMissingRequiredFields(typeDef.requiredFields, entry.fields)
    : []
  const invalid = missingFields.length > 0
  const title = entry.fields.title || t('Untitled')
  const author = entry.fields.author || ''
  const year = entry.fields.year || ''
  const venue =
    entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || ''

  // Truncate long author lists
  const authorDisplay = useMemo(() => {
    const parts = author.split(/\s+and\s+/i)
    if (parts.length <= 2) return author
    return `${parts[0]} et al.`
  }, [author])

  return (
    <div
      id={`bib-card-${index}`}
      className={['bib-entry-card', invalid ? 'bib-entry-card-invalid' : '']
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(entry)}
      onKeyDown={e => onCardKeyDown(e, index)}
    >
      <div className="bib-entry-card-header">
        <span className="bib-entry-card-type">@{entry.type}</span>
        <span className="bib-entry-card-key">{entry.id}</span>
      </div>
      <div className="bib-entry-card-title">{title}</div>
      {(authorDisplay || year) && (
        <div className="bib-entry-card-meta">
          {authorDisplay && <span>{authorDisplay}</span>}
          {authorDisplay && year && <span> · </span>}
          {year && <span>{year}</span>}
          {venue && <span> · {venue}</span>}
        </div>
      )}
    </div>
  )
}
