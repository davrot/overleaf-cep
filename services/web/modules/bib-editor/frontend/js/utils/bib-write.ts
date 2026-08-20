/**
 * Pure write planning for the "file is truth" write path (plan §2.2 / R2).
 *
 * All functions here take the *current* document source and an entry to
 * write, and return a concrete write plan (a range to replace, or an append
 * position) or a guard error. Nothing here touches the DOM, React state, or
 * the editor — the CodeMirror extension and the context apply the plan.
 *
 * This kills the stale-offset bug: ranges are always recomputed against the
 * source we are about to write to, and clamped when they are no longer valid.
 */
import { parseBibFile } from './bib-parser'
import type { BibEntry } from './bib-types'

export type BibWritePlan = {
  kind: 'replace' | 'append'
  /** inclusive start offset */
  from: number
  /** exclusive end offset (=== from for append) */
  to: number
  /** text to splice in between from and to */
  insert: string
  /** true when the plan had to be clamped to stay valid */
  clamped: boolean
}

export type BibWriteGuard =
  | { ok: true; plan: BibWritePlan }
  | { ok: false; reason: string }

/**
 * Serialize a BibEntry to a BibTeX string.
 *
 * Kept here (and re-exported from bib-parser for the write path) so that the
 * write planner and the parser share one formatter. `escapeBibValue` is
 * idempotent so double-escaping never happens.
 */
export { serializeBibEntry } from './bib-parser'

const CLAMP_REASON = 'range-out-of-doc'
const NOT_A_BIB_REASON = 'not-a-bib-file'
const ENTRY_GONE_REASON = 'entry-gone'

/**
 * True when the document is the bibliography the panel is bound to (a .bib
 * file with at least one entry, or an empty .bib that may gain its first
 * entry). Used by the extension to gate writes and avoid corrupting a
 * different / closed document.
 */
export function isBibDocument(source: string): boolean {
  // matches the extension's detectBibFile heuristic (first 2k chars)
  const sample = source.slice(0, Math.min(source.length, 2000))
  return /@\s*[\w-]+\s*\{/i.test(sample)
}

/**
 * Plan a write of a single entry against the *current* source.
 *
 * mode 'existing': the entry id must resolve to exactly one parsed entry; the
 * plan replaces that entry's range. If the id is missing from the source
 * (the user deleted it in Code mode while the panel was open) the guard is
 * 'entry-gone' and the view must surface a toast rather than write.
 *
 * mode 'new': the entry is appended at the end of the source.
 *
 * In both modes the range is clamped into [0, source.length] and `clamped`
 * is set true. A clamped plan is safe to apply; it can only never be larger
 * than the document.
 */
export function planBibWrite(
  source: string,
  entry: BibEntry,
  mode: 'existing' | 'new',
  serialize: (entry: BibEntry) => string
): BibWriteGuard {
  if (!isBibDocument(source) && mode === 'existing') {
    return { ok: false, reason: NOT_A_BIB_REASON }
  }

  if (mode === 'existing') {
    const entries = parseBibFile(source)
    const match = entries.filter(
      e => e.id === entry.id && e.type.toLowerCase() === (entry.type || '').toLowerCase()
    )
    if (match.length !== 1) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    const { sourceStart, sourceEnd } = match[0]
    const from = Math.max(0, Math.min(sourceStart, source.length))
    const to = Math.max(0, Math.min(sourceEnd, source.length))
    return {
      ok: true,
      plan: {
        kind: 'replace',
        from,
        to,
        insert: serialize(entry),
        clamped: from !== sourceStart || to !== sourceEnd,
      },
    }
  }

  // 'new': append at the end, surrounded by newlines so entries stay on
  // their own lines.
  const insert =
    source.endsWith('\n') || source.length === 0
      ? serialize(entry)
      : '\n' + serialize(entry)
  return {
    ok: true,
    plan: { kind: 'append', from: source.length, to: source.length, insert, clamped: false },
  }
}

/**
 * Delete an entry from a source by id. Returns guard + plan (removal) or a
 * guard reason when it is not present.
 */
export function planBibDelete(
  source: string,
  entryId: string
): BibWriteGuard {
  if (!isBibDocument(source)) {
    return { ok: false, reason: NOT_A_BIB_REASON }
  }
  const entries = parseBibFile(source)
  const match = entries.filter(e => e.id === entryId)
  if (match.length !== 1) {
    return { ok: false, reason: ENTRY_GONE_REASON }
  }
  const { sourceStart, sourceEnd } = match[0]
  // consume trailing newlines so we don't leave blank lines
  let end = sourceEnd
  while (
    end < source.length &&
    (source[end] === '\n' || source[end] === '\r')
  ) {
    end++
  }
  return {
    ok: true,
    plan: {
      kind: 'replace',
      from: sourceStart,
      to: end,
      insert: '',
      clamped: false,
    },
  }
}
