import _ from 'lodash'
import logger from '@overleaf/logger'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { Readable } from 'node:stream'
import settings from '@overleaf/settings'
import * as SiteSettingsManager from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import { OError } from '../../../../app/src/Features/Errors/Errors.js'
import { Template } from './models/Template.mjs'
import {
  validateTemplateInput,
  renderTemplateHtmlFields,
  uploadTemplateAssets,
  deleteTemplateAssets,
  canUserOverrideTemplate,
  generateTemplateData
} from './TemplateGalleryHelper.mjs'
import { cleanHtml }  from './CleanHtml.mjs'
import { TemplateNameConflictError } from './TemplateErrors.mjs'
import { fetchStreamWithResponse } from '@overleaf/fetch-utils'
import archiver from 'archiver'
const TIMEOUT = 30000
const MAX_BUNDLE_ASSET_BYTES = 30 * 1024 * 1024 // per-asset cap (zip/pdf)

async function editTemplate({ templateId, updates }) {

  validateTemplateInput(updates)

  const template = await Template.findById(templateId)
  if (!template) {
    throw new OError('Current template not found, strange...', { status: 500, templateId })
  }

  if (updates.name) {
    const conflictingTemplate = await Template.findOne(
      { name: updates.name, _id: { $ne: templateId } },
      { owner: true }
    ).exec()
    if (conflictingTemplate) {
      throw new TemplateNameConflictError(String(conflictingTemplate.owner))
    }
  }

  await renderTemplateHtmlFields(updates)
  updates.lastUpdated = new Date()
  Object.assign(template, updates)

  await template.save()

  return updates
}

async function deleteTemplate({ templateId, version }) {
  await deleteTemplateAssets(templateId, version, true)
}

async function createTemplateFromProject({ projectId, userId, templateSource }) {
  validateTemplateInput(templateSource)
  let template = await Template.findOne({ name: templateSource.name }).exec()

  if (template && !templateSource.override) {
    const { canOverride, templateOwnerName } = await canUserOverrideTemplate(template, userId)

    return {
      conflict: true,
      canOverride,
      templateOwnerName
    }
  }

  const templateData = await generateTemplateData(projectId, templateSource)

  let previousVersionExists
  if (!template) {
    template = new Template(templateData)
    template.owner = userId
    previousVersionExists = false
  } else {
    Object.assign(template, templateData, {
      version: template.version + 1,
    })
    previousVersionExists = true
  }

  await uploadTemplateAssets(projectId, userId, templateSource.build, template)
  await template.save()

  if (previousVersionExists) {
    // Intentional fire-and-forget: previous-version asset cleanup does not
    // gate the create response.
    void deleteTemplateAssets(template._id, template.version - 1, false)
  }
  return {
    conflict: false,
    templateId: template._id,
  }
}

async function fetchTemplatePreview({ templateId, version, style }) {
  if (!templateId || !version) {
    throw new OError('Template ID and version are required', { status: 404 })
  }
  const styleParam = style ? `style=${style}` : ''
  const isImage = (style === 'preview' || style === 'thumbnail')

  if (style && !isImage) {
    throw new OError('Wrong style', { status: 404, style })
  }

  const pdfUrl = `${settings.apis.filestore.url}/template/${templateId}/v/${version}/pdf?${styleParam}`
  const { response } = await fetchStreamWithResponse(pdfUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(TIMEOUT),
  })

  if (!response.ok) {
    throw new OError(`Failed to fetch file: ${response.statusText}`, { status: 400, templateId, version, styleParam })
  }

  return {
    stream: Readable.from(response.body),
    contentType: isImage ? 'application/octet-stream' : 'application/pdf'
  }
}

async function getTemplatesPageData(category) {
  let links = (settings.templateLinks || []).map(l => ({ ...l }))
  try {
    const section = await SiteSettingsManager.getSection('templates', settings)
    links = (section.categories || [])
      .filter(c => c.enabled)
      .map(c => ({
        name: c.name,
        url: `/templates/${c.key}`,
        description: c.description || '',
      }))
  } catch {
    // env-seed fallback (settings.templateLinks)
  }
  const categoryName = links.find(item => (item.url || '').endsWith(`/${category}`))?.name
  const templateLinks = categoryName ? undefined : links.filter(link => link.url !== '/templates/all')
  return {
    categoryName,
    templateLinks
  }
}

// SECURITY: key/val reach here from user-controlled route params and query
// strings. Building `{ [key]: val }` directly was a Mongoose query-injection
// hole (e.g. key=$where = server-side JS oracle; unknown keys degenerated to
// findOne({})). Only the two lookups the product actually performs are
// allowed, with value validation for _id; anything else is a safe miss.
async function getTemplate(key, val) {
  if (key === '_id') {
    if (!mongoose.Types.ObjectId.isValid(String(val))) {
      logger.warn('getTemplate: invalid _id provided')
      return null
    }
    const template = await Template.findById(val).exec()
    if (!template) return null

    return _formatTemplateForPage(template)
  }

  if (key === 'name') {
    const template = await Template.findOne({ name: String(val) }).exec()
    if (!template) return null

    return _formatTemplateForPage(template)
  }

  logger.warn('getTemplate: unknown lookup key ignored', { key })
  return null
}

async function getCategoryTemplates(reqQuery) {
  const {
    category,
    by = 'lastUpdated',
    order = 'desc',
  } = reqQuery || {}

  const query = (category === 'all') ? {} : { category : '/templates/' + category }
  const projection = { _id : 1, version : 1, name : 1, author : 1, description : 1, lastUpdated : 1 }
  const allTemplates = await Template.find(query, projection).exec()
  const formattedTemplates = allTemplates.map(_formatTemplateForList)
  const sortedTemplates = _sortTemplates(formattedTemplates, { by, order })

  return {
    totalSize: sortedTemplates.length,
    templates: sortedTemplates,
  }
}

function _sortTemplates(templates, sort) {
  if (
    (sort.by && !['lastUpdated', 'name'].includes(sort.by)) ||
    (sort.order && !['asc', 'desc'].includes(sort.order))
  ) {
    throw new OError('Invalid sorting criteria', { status: 400, sort })
  }
  const sortedTemplates = _.orderBy(
    templates,
    [sort.by || 'lastUpdated'],
    [sort.order || 'desc']
  )
  return sortedTemplates
}

function _formatTemplateForList(template) {
  return {
    id: String(template._id),
    version: String(template.version),
    name: template.name,
    author: cleanHtml(template.author, "plainText"),
    description: cleanHtml(template.description, "plainText"),
    lastUpdated: template.lastUpdated,
  }
}

function _formatTemplateForPage(template) {
  return {
    id: template._id.toString(),
    version: template.version.toString(),
    category: template.category,
    name: template.name,
    author: cleanHtml(template.author, "linksOnly"),
    authorMD: template.authorMD,
    description: cleanHtml(template.description, "reachText"),
    descriptionMD: template.descriptionMD,
    license: template.license,
    lastUpdated: template.lastUpdated,
    owner: template.owner,
    mainFile: template.mainFile,
    compiler: template.compiler,
    imageName: template.imageName,
    language: template.language,
  }
}

/**
 * New 3 (2026-08-28): the ENABLED template categories (admin-managed
 * via Manage Extensions -> Templates; env seeds underneath) — used by
 * the ds-nav page switcher (Templates sub-items).
 */
function getEnabledCategories() {
  return SiteSettingsManager.getSection('templates').then(section => {
    return (section.categories || [])
      .filter(c => c.enabled !== false)
      .map(c => ({ key: c.key, name: c.name || c.key }))
  })
}

/* ------------------------------------------------------------------ */
/* 3b (2026-08-28): template bundle save/import.
 * Bundle = zip with template.json (metadata) + source.zip +
 * optional output.pdf. Export assembles from the filestore; import
 * re-uploads source.zip (+output.pdf) for a (new|bumped) Template
 * doc. Admin console surface: Manage Extensions -> Templates.
 */
function _bundleAssetUrls(templateId, version) {
  const base = `${settings.apis.filestore.url}/template/${templateId}/v/${version}`
  return { zip: `${base}/zip`, pdf: `${base}/pdf` }
}

async function _collectStream(stream) {
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    if (total > MAX_BUNDLE_ASSET_BYTES) {
      throw new OError('template asset too large', { status: 413 })
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function _templateToBundleMeta(template) {
  const t = template.toJSON()
  const { _id, __v, owner, ...meta } = t
  return meta
}

async function getTemplateBundle({ templateId, userId }) {
  const template = await Template.findById(templateId)
  if (!template) {
    throw new OError('Template not found', { status: 404, templateId })
  }
  const { canOverride } = await canUserOverrideTemplate(template, userId)
  if (!canOverride) {
    throw new OError('not allowed to download this template bundle', { status: 403 })
  }
  const { zip: zipUrl, pdf: pdfUrl } = _bundleAssetUrls(
    String(template._id),
    template.version
  )
  const zipReq = await fetchStreamWithResponse(zipUrl, {
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!zipReq.response.ok) {
    throw new OError('Template source not found', { status: 404 })
  }
  const sourceZip = await _collectStream(zipReq.stream)
  let outputPdf = null
  try {
    const pdfReq = await fetchStreamWithResponse(pdfUrl, {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (pdfReq.response.ok) outputPdf = await _collectStream(pdfReq.stream)
  } catch (err) {
    logger.warn({ err, templateId }, 'bundle export: no/failed output.pdf (continuing without)')
  }
  const archive = archiver('zip', { zlib: { level: 6 } })
  const chunks = []
  archive.on('data', c => chunks.push(c))
  const finished = new Promise((resolve, reject) => {
    archive.on('end', resolve)
    archive.on('error', reject)
  })
  archive.append(JSON.stringify(_templateToBundleMeta(template), null, 2), {
    name: 'template.json',
  })
  archive.append(sourceZip, { name: 'source.zip' })
  if (outputPdf) archive.append(outputPdf, { name: 'output.pdf' })
  archive.finalize()
  await finished
  const filename = `${String(template.name || 'template').replace(/[/:*?"<>|\s]+/g, '_')}_v${template.version}.bundle.zip`
  return {
    buffer: Buffer.concat(chunks),
    filename,
    contentType: 'application/zip',
  }
}

async function importTemplateBundle({ data, userId, override, privileged = false }) {
  const { readZipEntries } = await import('./_bundleZip.mjs')
  const bundle = await readZipEntries(data)
  const metaRaw = bundle.get('template.json')
  const sourceRaw = bundle.get('source.zip')
  const pdfRaw = bundle.get('output.pdf')
  if (!metaRaw || !sourceRaw) {
    throw new OError('Bundle must contain template.json and source.zip', { status: 400 })
  }
  let meta
  try {
    meta = JSON.parse(metaRaw.toString('utf8'))
  } catch (err) {
    throw new OError('template.json is not valid JSON', { status: 400 })
  }
  const doc = {
    name: String(meta.name || '').trim(),
    category: String(meta.category || '').trim(),
    descriptionMD: meta.descriptionMD || '',
    authorMD: meta.authorMD || '',
    license: String(meta.license || '').trim() || 'CC-BY 4.0',
    mainFile: String(meta.mainFile || 'main.tex'),
    compiler: String(meta.compiler || settings.defaultLatexCompiler),
    imageName: meta.imageName || null,
    language: meta.language || null,
  }
  if (!doc.name || !doc.category) {
    throw new OError('Bundle metadata requires name and category', { status: 400 })
  }
  validateTemplateInput(doc)
  await renderTemplateHtmlFields(doc)

  const existing = await Template.findOne({ name: doc.name }).exec()

  // 3a: per-category publishable enforcement for non-privileged importers
  // (site admins / the configured template manager are always allowed).
  if (!privileged) {
    try {
      const section = await SiteSettingsManager.getSection('templates', settings)
      const cat = (section.categories || []).find(c => c.key === doc.category)
      if (cat && cat.publishable === false) {
        throw new OError('You may not publish templates in this category', { status: 403 })
      }
    } catch (err) {
      if (err.status === 403) throw err
      // settings miss: fall through (legacy policy)
    }
  }

  if (existing) {
    const { canOverride } = await canUserOverrideTemplate(existing, userId)
    if (!override || !canOverride) {
      throw new TemplateNameConflictError(String(existing.owner))
    }
  }

  const sourceBuf = sourceRaw

  let template
  if (existing) {
    Object.assign(existing, doc, {
      version: (existing.version || 1) + 1,
      lastUpdated: new Date(),
    })
    template = existing
  } else {
    template = new Template(doc)
    template.owner = userId
  }
  const version = template.version
  const { zip: zipUrl, pdf: pdfUrl } = _bundleAssetUrls(String(template._id), version)
  const [zipRes, pdfRes] = await Promise.all([
    fetchStreamWithResponse(zipUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: sourceBuf,
      signal: AbortSignal.timeout(TIMEOUT),
    }),
    pdfRaw
      ? fetchStreamWithResponse(pdfUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: pdfRaw,
          signal: AbortSignal.timeout(TIMEOUT),
        })
      : Promise.resolve({ response: { status: 200, ok: true } }),
  ])
  if (zipRes.response.status !== 200 || pdfRes.response.status !== 200) {
    if (!existing) {
      await Template.deleteOne({ _id: template._id }).catch(() => {})
    }
    throw new OError('Failed to store template assets', { status: 502 })
  }
  await template.save()
  if (existing) {
    // fire-and-forget previous-version asset cleanup (same pattern as create)
    void deleteTemplateAssets(template._id, version - 1, false)
  }
  return { templateId: String(template._id), version, created: !existing }
}

export { getEnabledCategories, getTemplateBundle, importTemplateBundle }

export default {
  createTemplateFromProject,
  editTemplate,
  deleteTemplate,
  getEnabledCategories,
  getTemplate,
  getCategoryTemplates,
  fetchTemplatePreview,
  getTemplatesPageData,
  getTemplateBundle,
  importTemplateBundle,
}
