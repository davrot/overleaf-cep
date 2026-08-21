import { describe, it, expect } from 'vitest'
import {
  planBibWrite,
  planBibDelete,
  isBibDocument,
  serializeBibEntry,
} from '../../../frontend/js/utils/bib-write'
import { parseBibFile } from '../../../frontend/js/utils/bib-parser'

describe('bib-write (R2 plan, pure)', () => {
  const src =
    '@article{k1,\n  title = {One},\n  year = {2020},\n}\n' +
    '@book{k2, title = {Two}, year = {2021}}\n'

  it('plans a replace for an existing entry using fresh offsets', () => {
    const guard = planBibWrite(src, { type: 'book', id: 'k2', fields: { title: 'Two (edited)', year: '2021' } }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(true)
    const { plan } = guard
    expect(plan.kind).toBe('replace')
    const [k2] = parseBibFile(src).filter(e => e.id === 'k2')
    expect(plan.from).toBe(k2.sourceStart)
    expect(plan.to).toBe(k2.sourceEnd)
    expect(plan.insert).toContain('title = {Two (edited)}')
    // applying the plan yields exactly one edit of the right range
    const applied = src.slice(0, plan.from) + plan.insert + src.slice(plan.to)
    const entries = parseBibFile(applied)
    expect(entries).toHaveLength(2)
    expect(entries.find(e => e.id === 'k2').fields.title).toBe('Two (edited)')
    expect(entries.find(e => e.id === 'k1')).toBeDefined()
  })

  it('rejects an existing-entry write when the entry is gone (Code-mode delete)', () => {
    const guard = planBibWrite(src, { type: 'book', id: 'k9', fields: {} }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(false)
    expect(guard.reason).toBe('entry-gone')
  })

  it('rejects an existing-entry write for a non-bib document', () => {
    const guard = planBibWrite('\n', { type: 'book', id: 'k1', fields: {} }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(false)
    expect(guard.reason).toBe('not-a-bib-file')
  })

  it('rejects ambiguous duplicate ids for an existing-entry write', () => {
    const dup = '@misc{a, title={X}}\n@misc{a, title={Y}}\n'
    const guard = planBibWrite(dup, { type: 'misc', id: 'a', fields: {} }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(false)
    expect(guard.reason).toBe('entry-gone')
  })

  it('plans a rename (new key) against the original key anchor, and rejects a collision', () => {
    // k2 → k9 (free): anchored by the original id, range preserved
    const ok = planBibWrite(src, { type: 'book', id: 'k9', fields: { title: 'Two', year: '2021' } }, 'existing', serializeBibEntry, 'k2')
    expect(ok.ok).toBe(true)
    const k2 = parseBibFile(src).find(e => e.id === 'k2')
    expect(ok.plan.from).toBe(k2.sourceStart)
    expect(ok.plan.to).toBe(k2.sourceEnd)
    expect(ok.plan.insert).toContain('k9')
    const applied = src.slice(0, ok.plan.from) + ok.plan.insert + src.slice(ok.plan.to)
    const entries = parseBibFile(applied)
    expect(entries.find(e => e.id === 'k9')).toBeDefined()
    expect(entries.find(e => e.id === 'k1')).toBeDefined()
    // k2 → k1 (a DIFFERENT entry owns k1): collision guard
    const clash = planBibWrite(src, { type: 'book', id: 'k1', fields: {} }, 'existing', serializeBibEntry, 'k2')
    expect(clash.ok).toBe(false)
    expect(clash.reason).toBe('key-taken')
  })

  it('appends a new entry at the end of the document', () => {
    const guard = planBibWrite(src, { type: 'misc', id: 'k3', fields: { title: 'New' } }, 'new', serializeBibEntry)
    expect(guard.ok).toBe(true)
    const { plan } = guard
    expect(plan.kind).toBe('append')
    expect(plan.from).toBe(src.length)
    expect(plan.to).toBe(src.length)
    const applied = src.slice(0, plan.from) + plan.insert + src.slice(plan.to)
    const entries = parseBibFile(applied)
    expect(entries).toHaveLength(3)
    expect(entries[2].id).toBe('k3')
  })

  it('appends without a leading newline for an empty document', () => {
    const guard = planBibWrite('', { type: 'misc', id: 'a', fields: { title: 'A' } }, 'new', serializeBibEntry)
    expect(guard.ok).toBe(true)
    expect(guard.plan.insert.startsWith('\n')).toBe(false)
    const applied = guard.plan.insert
    expect(parseBibFile(applied)).toHaveLength(1)
  })

  it('plans a delete that consumes the trailing newlines of an entry', () => {
    // k2 is the last entry and has one trailing newline: removing the entry
    // must not leave the stray blank line behind.
    const guard = planBibDelete(src, 'k2')
    expect(guard.ok).toBe(true)
    const { plan } = guard
    expect(plan.insert).toBe('')
    const applied = src.slice(0, plan.from) + plan.insert + src.slice(plan.to)
    expect(applied).toBe('@article{k1,\n  title = {One},\n  year = {2020},\n}\n')
    // deleting a MIDDLE entry consumes exactly its own trailing newline
    const guard2 = planBibDelete(src, 'k1')
    const applied2 = src.slice(0, guard2.plan.from) + guard2.plan.insert + src.slice(guard2.plan.to)
    const entries = parseBibFile(applied2)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('k2')
  })

  it('rejects delete of missing entries and non-bib documents', () => {
    expect(planBibDelete(src, 'nope').ok).toBe(false)
    expect(planBibDelete('\n', 'k1').ok).toBe(false)
  })

  it('isBibDocument matches the extension heuristic', () => {
    expect(isBibDocument('@article{k, x = {1}}')).toBe(true)
    expect(isBibDocument('\n\n% comment\n@misc{a}\n')).toBe(true)
    expect(isBibDocument('just text\n')).toBe(false)
    expect(isBibDocument('')).toBe(false)
  })

  it('isBibDocument: known heuristic limitation — a @type{ inside a leading comment matches (documented, acceptable)', () => {
    // The plan §3.3 notes this limitation; the test pins the CURRENT behavior
    // so any future change (e.g. filename-aware detection) must be deliberate.
    expect(isBibDocument('% a comment with @article{fake}\nreal text\n')).toBe(true)
    // a genuinely entry-less document stays non-bib
    expect(isBibDocument('just prose, no entry markers\n')).toBe(false)
  })
})
