import _ from 'lodash'
import logger from '@overleaf/logger'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { Readable } from 'node:stream'
import settings from '@overleaf/settings'
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
const TIMEOUT = 30000

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
  const categoryName = settings.templateLinks.find(item => item.url.endsWith(`/${category}`))?.name
  const templateLinks = categoryName ? undefined : settings.templateLinks.filter(link => link.url !== '/templates/all')
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

export default {
  createTemplateFromProject,
  editTemplate,
  deleteTemplate,
  getTemplate,
  getCategoryTemplates,
  fetchTemplatePreview,
  getTemplatesPageData,
}
