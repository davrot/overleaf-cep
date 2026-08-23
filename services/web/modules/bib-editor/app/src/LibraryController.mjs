/**
 * Library REST controller (LIBRARY_PLAN.md §4). Thin layer over
 * LibraryManager: session-scoped user id, param parsing, error mapping
 * (OError), and the .bib download framing. API shapes follow the SaaS
 * reference (D-C1: field values are plain `value` strings).
 */
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { expressify } from '@overleaf/promise-utils'
import * as LibraryManager from './LibraryManager.mjs'
import { serializeBibFile } from './LibrarySerializer.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LIBRARY_VIEW = path.resolve(__dirname, '../views/library/library')

const VALIDATION_MESSAGES = {
  'entries-missing': 'At least one reference is required.',
  'entries-too-many': 'Too many references in one batch.',
  'entry-not-object': 'Each reference must be an object.',
  'key-missing': 'A citation key is required.',
  'key-too-long': 'The citation key is too long.',
  'key-invalid':
    'The citation key is invalid (letters, numbers, dot, underscore and dash only).',
  'type-invalid': 'A valid entry type is required.',
  'type-unknown': 'Unknown entry type.',
  'fields-not-array': 'Fields must be a list.',
  'fields-too-many': 'Too many fields in one reference.',
  'field-not-object': 'Each field must be an object with name and value.',
  'field-name-invalid': 'Field names must be lowercase words.',
  'field-value-not-string': 'Field values must be strings.',
  'field-value-too-long': 'A field value is too long.',
  'nothing-to-delete': 'Provide ids or a search term to delete.',
}

/** Map a manager-thrown error (reason-tagged) to an OError for the API. */
function toOError(err, fallbackMessage) {
  if (err?.validationReason) {
    return new OError(
      VALIDATION_MESSAGES[err.validationReason] || fallbackMessage,
      { status: 400 }
    )
  }
  if (err?.notFound) {
    return new OError('Reference not found.', { status: 404 })
  }
  if (err?.duplicateKey) {
    return new OError(
      `The citation key “${err.duplicateKey}” is already used by another reference.`,
      { status: 409, duplicateKey: err.duplicateKey }
    )
  }
  return new OError(fallbackMessage, { status: 500 })
}

function getUserId(req) {
  return SessionManager.getLoggedInUserId(req.session)
}

async function listReferences(req, res) {
  const userId = getUserId(req)
  const { search, trashed, cursor, limit } = req.query
  const parsedLimit = limit === undefined ? undefined : Number(limit)
  const parsedTrashed =
    trashed === 'true' || trashed === '1' || trashed === 'yes'
  try {
    const result = await LibraryManager.listReferenceEntries(userId, {
      search: typeof search === 'string' && search.trim() ? search : null,
      trashed: !!parsedTrashed,
      cursor: typeof cursor === 'string' && cursor ? cursor : null,
      limit: parsedLimit,
    })
    res.json(result)
  } catch (err) {
    logger.error({ err, userId }, 'library: list failed')
    throw toOError(err, 'References couldn’t be loaded.')
  }
}

async function createReferences(req, res) {
  const userId = getUserId(req)
  const entries = req.body?.entries
  try {
    const items = await LibraryManager.createReferenceEntries(userId, entries)
    res.status(201).json({ items })
  } catch (err) {
    logger.warn({ err, userId }, 'library: create rejected')
    throw toOError(err, 'The reference could not be added.')
  }
}

async function matchReferences(req, res) {
  const userId = getUserId(req)
  const entries = req.body?.entries
  try {
    const matches = await LibraryManager.matchReferenceKeys(userId, entries)
    res.json({ matches })
  } catch (err) {
    logger.warn({ err, userId }, 'library: match failed')
    throw toOError(err, 'The check for existing references failed.')
  }
}

async function updateReference(req, res) {
  const userId = getUserId(req)
  const originalKey = req.params.key
  const { key, type, fields } = req.body?.entries?.[0] ?? req.body ?? {}
  try {
    const entry = await LibraryManager.updateReferenceEntry(userId, originalKey, {
      key,
      type,
      fields,
    })
    res.json(entry)
  } catch (err) {
    if (err?.notFound) {
      logger.warn({ err, userId, originalKey }, 'library: update not found')
    } else {
      logger.warn({ err, userId, originalKey }, 'library: update rejected')
    }
    throw toOError(err, 'The reference could not be saved.')
  }
}

async function deleteReferences(req, res) {
  const userId = getUserId(req)
  const body = req.body || {}
  try {
    const deletedCount = await LibraryManager.deleteReferenceEntries(userId, {
      ids: Array.isArray(body.ids) ? body.ids : null,
      search: typeof body.search === 'string' ? body.search : null,
      permanent: body.permanent === true,
    })
    res.json({ deletedCount })
  } catch (err) {
    logger.warn({ err, userId }, 'library: delete rejected')
    throw toOError(err, 'The references could not be deleted.')
  }
}

async function restoreReferences(req, res) {
  const userId = getUserId(req)
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null
  try {
    const restoredCount = await LibraryManager.restoreReferenceEntries(
      userId,
      ids
    )
    res.json({ restoredCount })
  } catch (err) {
    logger.warn({ err, userId }, 'library: restore failed')
    throw toOError(err, 'The references could not be restored.')
  }
}

async function countReferences(req, res) {
  const userId = getUserId(req)
  const { search, trashed } = req.query
  const parsedTrashed =
    trashed === 'true' || trashed === '1' || trashed === 'yes'
  try {
    const count = await LibraryManager.countReferenceEntries(userId, {
      search: typeof search === 'string' && search.trim() ? search : null,
      trashed: !!parsedTrashed,
    })
    res.json({ count })
  } catch (err) {
    logger.warn({ err, userId }, 'library: count failed')
    throw toOError(err, 'The reference count could not be loaded.')
  }
}

async function downloadReferences(req, res) {
  const userId = getUserId(req)
  const { mode, search, ids } = req.query
  const idList =
    typeof ids === 'string' && ids
      ? ids.split(',').map(s => s.trim()).filter(Boolean)
      : Array.isArray(ids)
        ? ids
        : null
  try {
    const items = await LibraryManager.downloadReferenceEntries(userId, {
      mode: mode === 'exclusion' ? 'exclusion' : 'inclusion',
      search: typeof search === 'string' && search.trim() ? search : null,
      ids: idList,
    })
    const bib = serializeBibFile(items)
    res
      .status(200)
      .set('Content-Type', 'text/plain; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="library.bib"')
      .send(bib)
  } catch (err) {
    logger.error({ err, userId }, 'library: download failed')
    throw toOError(err, 'The library could not be downloaded.')
  }
}

async function citationKeySuggestions(req, res) {
  const userId = getUserId(req)
  const base =
    typeof req.query.base === 'string' ? req.query.base : ''
  try {
    const keys = await LibraryManager.citationKeySuggestions(userId, base, {
      extra:
        typeof req.query.keys === 'string' && req.query.keys
          ? req.query.keys.split(',').map(s => s.trim()).filter(Boolean)
          : [],
    })
    res.json({ keys })
  } catch (err) {
    logger.warn({ err, userId }, 'library: suggestions failed')
    throw toOError(err, 'Citation key suggestions could not be loaded.')
  }
}

async function libraryPage(req, res) {
  res.render(LIBRARY_VIEW, { libraryView: 'library' })
}

async function libraryTrashPage(req, res) {
  res.render(LIBRARY_VIEW, { libraryView: 'trash' })
}

export default {
  listReferences: expressify(listReferences),
  createReferences: expressify(createReferences),
  matchReferences: expressify(matchReferences),
  updateReference: expressify(updateReference),
  deleteReferences: expressify(deleteReferences),
  restoreReferences: expressify(restoreReferences),
  countReferences: expressify(countReferences),
  downloadReferences: expressify(downloadReferences),
  citationKeySuggestions: expressify(citationKeySuggestions),
  libraryPage: expressify(libraryPage),
  libraryTrashPage: expressify(libraryTrashPage),
}
