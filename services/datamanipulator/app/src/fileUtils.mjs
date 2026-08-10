
import crypto from 'crypto'

export const FileTypes = {
  TEXT: 'text',
  BINARY: 'binary'
}

/**
 * Detect if a file is binary based on extension and content sample
 * @param {string} filepath - Path to the file (for extension check)
 * @param {Buffer} buffer - File content bytes
 * @returns {{ type: 'text'|'binary', encoding?: string }} Detection result
 */
export function detectFileType(filepath, buffer) {
  const binaryExts = new Set([
    'pdf', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'ttf', 'woff',
    'woff2', 'eot', 'ico', 'exe', 'msi', 'bin', 'tar', 'gz',
    'rar', '7z', 'img', 'iso', 'dmg'
  ])

  const ext = filepath.split('.').pop()?.toLowerCase() || ''

  // Fast path: extension-based detection
  if (binaryExts.has(ext)) {
    return { type: FileTypes.BINARY }
  }

  // Content-based detection for unknown extensions
  if (!buffer || buffer.length === 0) {
    return { type: FileTypes.TEXT, encoding: 'utf8' }
  }

  const sampleSize = Math.min(buffer.length, 8192)
  const sample = buffer.slice(0, sampleSize)

  // Check for null bytes (>5% null = binary)
  let nullCount = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      nullCount++
      if (nullCount > sample.length * 0.05) {
        return { type: FileTypes.BINARY }
      }
    }
  }

  // Try to decode as UTF-8
  try {
    const decoder = new TextDecoder('utf8', { fatal: true })
    decoder.decode(sample)
    return { type: FileTypes.TEXT, encoding: 'utf8' }
  } catch {
    // Check if it's valid Latin-1 (every byte is valid)
    let allValid = true
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i]
      if (!(byte >= 0 && byte <= 255)) {
        allValid = false
        break
      }
    }

    if (allValid && nullCount === 0) {
      return { type: FileTypes.TEXT, encoding: 'latin1' }
    }

    return { type: FileTypes.BINARY }
  }
}

/**
 * Calculate SHA256 checksum of file content
 * @param {Buffer} buffer - File content
 * @returns {string} Checksum in format "sha256:hexdigest"
 */
export function calculateChecksum(buffer) {
  if (!buffer || buffer.length === 0) {
    return 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // Empty file hash
  }

  try {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    return `sha256:${hash}`
  } catch {
    console.warn("Failed to calculate checksum")
    return `sha256:placeholder-${buffer.length}`
  }
}

/**
 * Get file metadata for a single file
 * @param {string} filepath - Relative path within project
 * @param {Buffer} buffer - File content
 * @returns {Object} Metadata object
 */
export function getFileMetadata(filepath, buffer) {
  const { type, encoding } = detectFileType(filepath, buffer)
  return {
    relative_path: filepath,
    name: filepath.split('/').pop() || filepath,
    type: 'file',
    size: buffer.length,
    binary: type === FileTypes.BINARY,
    checksum: calculateChecksum(buffer),
    mtime: new Date().toISOString(),
    ...(encoding && { encoding })
  }
}

export default {
  FileTypes,
  detectFileType,
  calculateChecksum,
  getFileMetadata
}
