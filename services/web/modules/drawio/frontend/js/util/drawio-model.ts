/**
 * Pure helpers for normalising a diagram document into the model XML
 * understood by maxGraph's `ModelXmlSerializer.import()`.
 *
 * Kept free of React/DOM dependencies so it can be unit-tested in Node
 * (`modules/drawio/test/unit` via vitest).
 */

/**
 * Empty diagram document: a classic mxGraph model with the two mandatory
 * root cells (id `0` and id `1` with parent `0`).
 *
 * The file is stored as plain text in the Overleaf project, so it stays
 * human-readable, diffable and re-editable (in this editor, in the source
 * editor, or in the free Draw.io desktop app — maxGraph registers
 * `mxGraphModel`/`mxCell`/`mxPoint` codec aliases precisely for this
 * compatibility).
 */
export const EMPTY_DIAGRAM =
  '<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'

const MODEL_ROOT_RE = /^\s*<(?:mxGraphModel|GraphDataModel)\b/

const PLAIN_MODEL_RE =
  /<(?:mxGraphModel|GraphDataModel)[\s>][\s\S]*?<\/(?:mxGraphModel|GraphDataModel)>/

/**
 * Normalise raw document content into a single `<mxGraphModel>` (or
 * `<GraphDataModel>`) element string, or `null` when the content is empty
 * or not a diagram model.
 *
 * Accepted:
 *  - a bare `<mxGraphModel>…</mxGraphModel>` / `<GraphDataModel>…</…>` document;
 *  - a classic `<mxfile>` wrapper that contains a plain (non-compressed)
 *    `<mxGraphModel>` diagram — the model element is extracted.
 *
 * Rejected (returns `null`; caller starts from an empty model):
 *  - empty/whitespace content, compressed `<diagram>` payloads, unrelated
 *    file content.
 */
export function toModelXml(
  content: string | null | undefined
): string | null {
  const text = (content ?? '').trim()
  if (text.length === 0) {
    return null
  }
  if (MODEL_ROOT_RE.test(text)) {
    return text
  }
  const match = text.match(PLAIN_MODEL_RE)
  if (match) {
    return match[0]
  }
  return null
}
