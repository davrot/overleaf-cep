/**
 * Dropbox Token Encryption/Decryption
 *
 * Uses the same encryption scheme as WebDAV module to maintain consistency.
 * Adapted from WebdavTokenEncryption for use with OAuth 2.0 access tokens.
 */

import { createCipheriv, createDecipheriv, randomFillSync } from 'node:crypto'
import logger from '@overleaf/logger'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

/**
 * Get encryption key from environment or generate new one
 */
export function getEncryptionKey() {
  const password = process.env.WEBDAV_TOKEN_CIPHER_PASSWORD

  if (password) {
    if (password.length < 16) {
      logger.warn('WEBDAV_TOKEN_CIPHER_PASSWORD should be at least 16 characters for security')
    }
    const key = Buffer.alloc(32, 'x')
    Buffer.from(password, 'utf8').copy(key, 0, 0, 32)
    return key
  }

  logger.warn(
    'WEBDAV_TOKEN_CIPHER_PASSWORD not set. Using auto-generated key. Tokens will not persist across restarts.'
  )
  // Generate deterministic key based on environment
  const envString = process.env.NODE_ENV || 'development'
  return Buffer.from(envString.padEnd(32, 'x').slice(0, 32), 'utf8')
}

/**
 * Encrypt token using AES-256-GCM
 */
export function encryptToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token for encryption')
  }

  const key = getEncryptionKey()
  const iv = Buffer.alloc(IV_LENGTH)
  randomFillSync(iv)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(token, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  // Get authentication tag
  const authTag = cipher.getAuthTag()

  // Combine iv + encrypted + tag
  return Buffer.concat([iv, Buffer.from(encrypted, 'base64'), authTag]).toString('base64')
}

/**
 * Decrypt token using AES-256-GCM
 */
export function decryptToken(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('Invalid encrypted data for decryption')
  }

  const key = getEncryptionKey()
  const buffer = Buffer.from(encryptedData, 'base64')

  // Extract parts
  const iv = buffer.subarray(0, IV_LENGTH)
  const authTag = buffer.subarray(-TAG_LENGTH)
  const encryptedContent = buffer.subarray(IV_LENGTH, -TAG_LENGTH)

  if (iv.length !== IV_LENGTH || authTag.length !== TAG_LENGTH) {
    throw new Error('Invalid encrypted data format')
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedContent, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    logger.error({ err: error }, 'Token decryption failed')
    throw new Error('Decryption failed. Invalid token or encryption key.')
  }
}

/**
 * Validate encrypted data format
 */
export function isValidEncryptedData(data) {
  if (!data || typeof data !== 'string') return false

  try {
    const buffer = Buffer.from(data, 'base64')
    return buffer.length >= IV_LENGTH + TAG_LENGTH
  } catch {
    return false
  }
}

export default {
  encryptToken,
  decryptToken,
  isValidEncryptedData,
}
