import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import ConversionManager from './ConversionManager.js'
import ResourceWriter from './ResourceWriter.js'
import RequestParser from './RequestParser.js'
import { pipeline } from 'node:stream/promises'
import Settings from '@overleaf/settings'
import Path from 'node:path'

const SUPPORTED_CONVERSION_TYPES = new Map([['docx', 'docx']])

async function convertDocxToLaTeX(req, res) {
  const { path } = req.file
  if (!Settings.enablePandocConversions) {
    await fs.unlink(path).catch(() => {})
    return res.sendStatus(404)
  }
  logger.debug({ path }, 'received file for conversion')
  const conversionId = crypto.randomUUID()
  let zipPath
  try {
    zipPath = await ConversionManager.promises.convertDocxToLaTeXWithLock(
      conversionId,
      path
    )
  } finally {
    await fs.unlink(path).catch(() => {})
  }

  try {
    const zipStat = await fs.stat(zipPath)

    res.setHeader('Content-Length', zipStat.size)
    res.attachment('conversion.zip')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    const readStream = fsSync.createReadStream(zipPath)
    await pipeline(readStream, res)
  } finally {
    await fs
      .rm(Path.dirname(zipPath), { recursive: true, force: true })
      .catch(() => {})
  }
}

async function convertProjectToDocument(req, res) {
  if (!Settings.enablePandocConversions) {
    return res.sendStatus(404)
  }

  const type = req.query.type
  const extension = SUPPORTED_CONVERSION_TYPES.get(type)
  if (!extension) {
    return res.sendStatus(400)
  }

  const request = await RequestParser.promises.parse(req.body)
  request.project_id = req.params.project_id
  request.user_id = req.params.user_id
  request.metricsOpts = {}

  const conversionId = crypto.randomUUID()
  const conversionDir = Path.join(Settings.path.compilesDir, conversionId)

  logger.debug(
    {
      projectId: request.project_id,
      userId: request.user_id,
      rootResourcePath: request.rootResourcePath,
      type,
    },
    'syncing resources for project-to-document conversion'
  )

  try {
    await ResourceWriter.promises.syncResourcesToDisk(request, conversionDir)

    const documentPath =
      await ConversionManager.promises.convertLaTeXToDocumentInDirWithLock(
        conversionId,
        conversionDir,
        request.rootResourcePath,
        type,
        extension
      )

    const documentStat = await fs.stat(documentPath)
    res.setHeader('Content-Length', documentStat.size)
    res.attachment(`output.${extension}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const readStream = fsSync.createReadStream(documentPath)
    await pipeline(readStream, res)
  } finally {
    await fs.rm(conversionDir, { recursive: true, force: true }).catch(() => {})
  }
}

export default {
  convertDocxToLaTeX: expressify(convertDocxToLaTeX),
  convertProjectToDocument: expressify(convertProjectToDocument),
}
