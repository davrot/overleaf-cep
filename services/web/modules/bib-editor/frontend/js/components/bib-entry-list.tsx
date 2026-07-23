/**
 * List of BibTeX entries shown in the visual editor.
 * Each entry card is clickable — clicking opens the entry editor.
 */
import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import SearchForm from './search-form.tsx'
import type { ParsedBibEntry } from '../utils/bib-parser'
import {
  getEntryType,
  getMissingRequiredFields,
} from '../utils/bib-types'

type Props = {
  entries: ParsedBibEntry[]
  onSelect: (entry: ParsedBibEntry) => void
}

export default function BibEntryList({
  entries,
  onSelect,
}: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e => {
      const title = (e.fields.title || '').toLowerCase()
      const author = (e.fields.author || '').toLowerCase()
      const id = e.id.toLowerCase()
      const year = (e.fields.year || '').toLowerCase()
      const journal = (e.fields.journal || e.fields.booktitle || '').toLowerCase()
      return (
        title.includes(q) ||
        author.includes(q) ||
        id.includes(q) ||
        year.includes(q) ||
        journal.includes(q)
      )
    })
  }, [entries, search])

  return (
    <div className="bib-entry-list">
      {/* Search bar */}
      <SearchForm
        inputValue={search}
        setInputValue={setSearch}
        className={"bib-list-search"}
      />

      {/* Entry count */}
      <div className="bib-list-count">
        {filteredEntries.length === entries.length
          ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
          : `${filteredEntries.length} of ${entries.length} entries`}
      </div>

      {/* Entry list */}
      <div className="bib-list-entries">
        {filteredEntries.length === 0 && (
          <div className="bib-list-empty">
            {entries.length === 0
              ? t('No bibliography entries yet. Click "Add new entry" to create one.')
              : t('No entries match your search.')}
          </div>
        )}
        {filteredEntries.map(entry => (
          <BibEntryCard
            key={`${entry.id}-${entry.sourceStart}`}
            entry={entry}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function BibEntryCard({
  entry,
  onSelect,
}: {
  entry: ParsedBibEntry
  onSelect: (e: ParsedBibEntry) => void
}) {
  const { t } = useTranslation()
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
      className={['bib-entry-card', invalid ? 'bib-entry-card-invalid' : '']
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(entry)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(entry)
      }}
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
