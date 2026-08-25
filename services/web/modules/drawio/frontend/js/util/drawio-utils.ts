/**
 * Pure helpers for the diagram editor module.
 *
 * Kept free of React/browser-context dependencies so they can be
 * unit-tested in Node (`modules/drawio/test/unit`).
 */

/**
 * Companion renderings produced on save. `svg` is only used as the
 * fallback companion (when SVG→PDF conversion fails) so the user loses
 * nothing.
 */
export type ExportKind = 'png' | 'pdf' | 'svg'

export function companionFileName(docName: string, kind: ExportKind): string {
  const base = (docName || 'diagram.drawio').replace(/\.drawio$/i, '')
  return `${base}.${kind}`
}

export interface TreeNode {
  _id?: string
  name?: string
  docs?: TreeNode[]
  fileRefs?: TreeNode[]
  folders?: TreeNode[]
  [key: string]: unknown
}

/** Recursively find the parent folder ID for a given entity in a file tree. */
export function findParentFolderId(
  node: TreeNode,
  entityId: string
): string | null {
  if (node.docs?.some(d => d._id === entityId)) return node._id ?? null
  if (node.fileRefs?.some(f => f._id === entityId)) return node._id ?? null
  for (const sub of node.folders ?? []) {
    if (sub._id === entityId) return node._id ?? null
    const found = findParentFolderId(sub, entityId)
    if (found) return found
  }
  return null
}

export function findFileRefById(node: TreeNode, fileId: string): TreeNode | null {
  const direct = node.fileRefs?.find(f => f._id === fileId)
  if (direct) return direct
  for (const sub of node.folders ?? []) {
    const found = findFileRefById(sub, fileId)
    if (found) return found
  }
  return null
}
