import { describe, it, expect } from 'vitest'
import {
  parseBibFile,
  serializeBibEntry,
} from '../../../frontend/js/utils/bib-parser.ts'
import {
  ENTRY_TYPES,
  ALL_FIELDS,
  getEntryType,
  flattenRequired,
} from '../../../frontend/js/utils/bib-types.ts'
import {
  OVERLEAF_TYPES,
  HUMAN_LABELS,
  CAPTURED_FORM_ROWS,
  OPTIONAL_FIELD_TAXONOMY,
  offeredOptionalFields,
  humanizeCitationHeading,
} from '../../../frontend/js/utils/overleaf-type-map.ts'
import bibtexSchema from '../../../frontend/js/utils/bibtex-schema.json'

/**
 * C1 (PHASE_C_PLAN.md §3): 48-type vocabulary + schema expansion.
 *
 *  - supportedPublicationTypes = 48, every block consistent, required ⊆
 *    captured form rows ∪ year (plan §1.2 note: rows are UI, validation
 *    requiredFields are separate — both derive from the same capture)
 *  - 48 round-trip cases: write (serialize) per machine type → parse →
 *    machine type preserved
 *  - per-type form rows match the capture table (CAPTURED_FORM_ROWS)
 *  - taxonomy exclusion (Article does NOT offer Journal/Journal title,
 *    DOES offer Journal subtitle)
 */

// bibtexSchema is a plain JSON import; shape is checked in test/unit
// (no TS cast — this file is .mjs and esbuild would reject it).
const SCHEMA = bibtexSchema

describe('C1: 48-type vocabulary (overleaf-type-map + schema)', () => {
  it('supports exactly the 48 captured machine types', () => {
    expect(SCHEMA.supportedPublicationTypes).toHaveLength(48)
    expect(new Set(SCHEMA.supportedPublicationTypes).size).toBe(48)
    const machineNames = OVERLEAF_TYPES.map(t => t.machine)
    expect(machineNames).toHaveLength(48)
    expect(new Set(machineNames).size).toBe(48)
    // the map and the schema agree on the set
    expect(SCHEMA.supportedPublicationTypes.slice().sort()).toEqual(
      [...machineNames].sort()
    )
  })

  it('entry types all carry labels / required / optional', () => {
    for (const t of ENTRY_TYPES) {
      expect(typeof t.label, `label for ${t.name}`).toBe('string')
      expect(t.label.length, `label non-empty for ${t.name}`).toBeGreaterThan(0)
      // misc has no requiredFields by design (btxdoc); every other type
      // requires at least its title (+ year where a publication type).
      const reqLen = t.requiredFields.length
      expect(
        reqLen >= 1 || t.name === 'misc',
        `${t.name} required (misc may be empty)`
      ).toBe(true)
      expect(HUMAN_LABELS[t.name], `HUMAN_LABELS[${t.name}]`).toBe(t.label)
    }
    // label lookup is case-insensitive at the consumer (getEntryType path)
    expect(getEntryType('ARTICLE')?.label).toBe('Article')
  })

  describe('schema invariants (all 48)', () => {
    for (const type of SCHEMA.supportedPublicationTypes) {
      const rule = SCHEMA.publicationTypes[type]
      it(`${type}: block exists, required ⊆ captured rows ∪ year, fields known`, () => {
        expect(
          SCHEMA.publicationTypes,
          `${type} must have a rule`
        ).toHaveProperty(type)
        const main = CAPTURED_FORM_ROWS[type] ?? { mainFields: [], postDate: [] }
        const allowed = new Set([
          ...main.mainFields,
          ...main.postDate,
          'year',
        ])
        for (const r of rule.requiredFields) {
          for (const f of Array.isArray(r) ? r : [r]) {
            expect(
              allowed,
              `${type}: required "${f}" not in captured form rows`
            ).toContain(f)
            expect(SCHEMA.allKnownFields, `${type}: "${f}" unknown field`).toContain(f)
          }
        }
        // Year + Date both always render (capture): both must be valid fields
        const reqFlat = new Set(flattenRequired(rule.requiredFields))
        const known = new Set(SCHEMA.allKnownFields)
        const all = [...rule.optionalFields, ...reqFlat]
        expect(all).toContain('year')
        expect(all).toContain('date')
        for (const f of rule.optionalFields) {
          expect(known, `${type}: optional "${f}" unknown`).toContain(f)
        }
      })

      it(`${type}: round-trip — serialize → parse keeps the machine type`, () => {
        const entry = {
          type,
          id: `k_${type.replace(/[^a-z0-9]/gi, '')}`,
          fields: { title: `T ${type}`, year: '2024' },
        }
        const src = serializeBibEntry(entry)
        expect(src.startsWith(`@${type}{`), src.slice(0, 20)).toBe(true)
        const parsed = parseBibFile(src)
        expect(parsed).toHaveLength(1)
        expect(parsed[0]?.type, 'machine type preserved').toBe(type)
        expect(parsed[0]?.id, 'key preserved').toBe(entry.id)
      })

      it(`${type}: all optional fields are known fields`, () => {
        const known = new Set(SCHEMA.allKnownFields)
        for (const f of rule.optionalFields) {
          expect(known).toContain(f)
        }
      })
    }
  })

  describe('form rows match the capture (§1.2 table)', () => {
    it('article: author, title, journal, journaltitle (journal ≠ journaltitle)', () => {
      expect(CAPTURED_FORM_ROWS.article?.mainFields).toEqual([
        'author',
        'title',
        'journal',
        'journaltitle',
      ])
      // journaltitle is NOT validation-required for article (journal is)
      const req = getEntryType('article')?.requiredFields ?? []
      const flat = flattenRequired(req)
      expect(flat).toContain('journal')
      expect(flat).not.toContain('journaltitle')
    })

    it('unpublished: Note row renders AFTER Date (postDate)', () => {
      expect(CAPTURED_FORM_ROWS.unpublished?.postDate).toEqual(['note'])
      expect(CAPTURED_FORM_ROWS.unpublished?.mainFields).toEqual([
        'author',
        'title',
      ])
    })

    it('electronic/online/www: DOI/Eprint/URL rows after Date', () => {
      for (const t of ['electronic', 'online', 'www']) {
        expect(CAPTURED_FORM_ROWS[t]?.postDate).toEqual(['doi', 'eprint', 'url'])
      }
    })

    it('mastersthesis/phdthesis: institution + school rows', () => {
      for (const t of ['mastersthesis', 'phdthesis']) {
        expect(CAPTURED_FORM_ROWS[t]?.mainFields).toEqual([
          'author',
          'title',
          'institution',
          'school',
        ])
      }
    })

    it('proceedings/mvproceedings: title only (no author row)', () => {
      expect(CAPTURED_FORM_ROWS.proceedings?.mainFields).toEqual(['title'])
      expect(CAPTURED_FORM_ROWS.mvproceedings?.mainFields).toEqual(['title'])
    })

    it('patent: author, title, number', () => {
      expect(CAPTURED_FORM_ROWS.patent?.mainFields).toEqual([
        'author',
        'title',
        'number',
      ])
    })

    it('report/thesis: author, title, type, institution', () => {
      for (const t of ['report', 'thesis']) {
        expect(CAPTURED_FORM_ROWS[t]?.mainFields).toEqual([
          'author',
          'title',
          'type',
          'institution',
        ])
      }
    })
  })

  describe('taxonomy (8 groups, 63 options — capture)', () => {
    it('has exactly 8 groups in capture order', () => {
      expect(
        OPTIONAL_FIELD_TAXONOMY.map(g => g.label)
      ).toEqual([
        'Common',
        'Contributors',
        'Books and volumes',
        'Periodicals and journals',
        'Events and conferences',
        'Publication details',
        'Digital and online',
        'Language and origin',
      ])
    })

    it('offers 63 options (capture-verified count)', () => {
      const all = OPTIONAL_FIELD_TAXONOMY.flatMap(g => g.fields)
      expect(all).toHaveLength(63)
      const names = new Set(all.map(f => f.field))
      expect(names.size, 'no duplicate field names').toBe(63)
    })

    it('only known fields (allKnownFields ∪ additions)', () => {
      const known = new Set(ALL_FIELDS)
      for (const g of OPTIONAL_FIELD_TAXONOMY) {
        for (const f of g.fields) {
          expect(known, `taxonomy field "${f.field}" must be known`).toContain(f.field)
        }
      }
    })

    it('Article: excludes Journal/Journal title (main rows), offers Journal subtitle', () => {
      const offered = offeredOptionalFields(
        'article',
        getEntryType('article')?.requiredFields ?? []
      )
      const offeredFields = new Set(offered.map(o => o.field))
      expect(offeredFields).not.toContain('journal')
      expect(offeredFields).not.toContain('journaltitle')
      expect(offeredFields).toContain('journalsubtitle')
      // required members are never offered
      expect(offeredFields).not.toContain('author')
      expect(offeredFields).not.toContain('year')
      expect(offeredFields).not.toContain('date')
    })

    it('book: Publisher is a main row → not offered (but location is)', () => {
      const offered = new Set(
        offeredOptionalFields('book', getEntryType('book')?.requiredFields ?? [])
          .map(o => o.field)
      )
      expect(offered).not.toContain('publisher')
      expect(offered).toContain('location')
    })

    it('unpublished: Note (postDate) not offered', () => {
      const offered = offeredOptionalFields(
        'unpublished',
        getEntryType('unpublished')?.requiredFields ?? []
      )
      expect(offered.map(o => o.field)).not.toContain('note')
    })
  })

  describe('humanizeCitationHeading (preview / import cards)', () => {
    it('Ernst et al. (2007) — multiple authors + year', () => {
      expect(
        humanizeCitationHeading('ernst07', {
          author: 'Ernst and Bruns and Pasch?',
          year: '2007',
        })
      ).toBe('Ernst et al. (2007)')
    })

    it('last-first BibTeX order: "Ernst, J. and Bruns, T." → Ernst et al.', () => {
      expect(
        humanizeCitationHeading('ernst07', {
          author: 'Ernst, J. and Bruns, T. and Pasch, E.',
          year: '2007',
        })
      ).toBe('Ernst et al. (2007)')
    })

    it('"Smith, John and Doe" → Smith et al. (1999)', () => {
      expect(
        humanizeCitationHeading('smith99', {
          author: 'Smith, John and Doe',
          year: '1999',
        })
      ).toBe('Smith et al. (1999)')
    })

    it('no people → citation key; no id → "Unknown"', () => {
      expect(humanizeCitationHeading('key123', { year: '2000' })).toBe(
        'key123 (2000)'
      )
      expect(humanizeCitationHeading('', {})).toBe('Unknown')
    })

    it('year missing → no parens', () => {
      expect(humanizeCitationHeading('x', { author: 'Curie' })).toBe('Curie')
    })

    it('space-form single author → surname', () => {
      expect(humanizeCitationHeading('x', { author: 'Ada Lovelace' })).toBe(
        'Lovelace'
      )
    })
  })
})
