import logger from '@overleaf/logger'

/**
 * Compare two file trees and identify differences
 * @param {Object} leftTree - First tree structure (from project A)
 * @param {Object} rightTree - Second tree structure (from project B)
 * @returns {Object} Comparison results with conflicts, added, removed, identical
 */
export function compareTrees(leftTree, rightTree) {
  const result = {
    conflicts: [],
    onlyInLeft: [],
    onlyInRight: [],
    identical: []
  }

  // Build maps for faster lookup
  const leftMap = new Map()
  leftTree.entries.forEach(e => leftMap.set(e.relative_path, e))

  const rightMap = new Map()
  rightTree.entries.forEach(e => rightMap.set(e.relative_path, e))

  // Find differences
  for (const [path, leftEntry] of leftMap) {
    if (!rightMap.has(path)) {
      result.onlyInLeft.push(leftEntry)
    } else {
      const rightEntry = rightMap.get(path)
      
      if (leftEntry.checksum && rightEntry.checksum) {
        if (leftEntry.checksum === rightEntry.checksum) {
          result.identical.push({ path, checksum: leftEntry.checksum })
        } else {
          result.conflicts.push({
            path,
            leftChecksum: leftEntry.checksum,
            rightChecksum: rightEntry.checksum
          })
        }
      } else {
        // Fallback to size comparison if no checksums
        if (leftEntry.size === rightEntry.size) {
          result.identical.push({ path, size: leftEntry.size })
        } else {
          result.conflicts.push({
            path,
            leftSize: leftEntry.size,
            rightSize: rightEntry.size,
            note: 'size mismatch (checksums unavailable)'
          })
        }
      }
    }
  }

  // Find files only in right tree
  for (const [path] of rightMap) {
    if (!leftMap.has(path)) {
      result.onlyInRight.push(rightMap.get(path))
    }
  }

  logger.debug({
    conflicts: result.conflicts.length,
    onlyInLeft: result.onlyInLeft.length,
    onlyInRight: result.onlyInRight.length,
    identical: result.identical.length
  }, 'Tree comparison complete')

  return result
}

export default { compareTrees }
