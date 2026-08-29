import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import AdminAuthorizationHelper from '../../../../app/src/Features/Helpers/AdminAuthorizationHelper.mjs'
const { hasAdminAccess } = AdminAuthorizationHelper
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'
import TemplateGalleryManager from'./TemplateGalleryManager.mjs'
import { getUserName } from './TemplateGalleryHelper.mjs'
import { TemplateNameConflictError, RecompileRequiredError } from './TemplateErrors.mjs'
import Settings from '@overleaf/settings'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

async function createTemplateFromProject(req, res, next) {
  const t = req.i18n.translate
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const result = await TemplateGalleryManager.createTemplateFromProject({
      projectId: req.params.Project_id,
      userId,
      templateSource: req.body,
    })
    if (result.conflict) {
      const ownerName = (result.templateOwnerName === 'you') ? t('you') : result.templateOwnerName
      const message = `${t('template_with_this_title_exists_and_owned_by_x', { x: ownerName })} `
                    + t(result.canOverride ? 'do_you_want_to_overwrite_it' : 'you_cant_overwrite_it')
      return res.status(409).json({ canOverride: result.canOverride, message })
    }
    return res.status(200).json({ template_id: result.templateId })
  } catch (error) {
    if (error instanceof Errors.InvalidNameError) {
      return res.status(error.info?.status || 400).json({ message: error.message })
    }

    const mainMessage = t('failed_to_publish_as_a_template')
    if (error instanceof RecompileRequiredError) {
      return res.status(error.info?.status || 400).json({
        message: `${mainMessage} ${t('try_recompile_project')}`
      })
    }
    return res.status(400).json({ message: mainMessage })
  }
}

async function editTemplate(req, res, next) {
  const t = req.i18n.translate
  try {
    const result = await TemplateGalleryManager.editTemplate({
      templateId: req.params.template_id,
      updates: req.body
    })
    res.status(200).json(result)
  } catch (error) {
    if (error instanceof TemplateNameConflictError) {
      const ownerId = error.info?.ownerId
      const userId = SessionManager.getLoggedInUserId(req.session)
      const ownerName = (ownerId === userId)
        ? t('you')
        : await getUserName(ownerId) || t('unknown')
      const message = t(error.message, { x: ownerName })
      return res.status(409).json({ message })
    }
    if (error instanceof Errors.InvalidNameError) {
      return res.status(error.info?.status || 400).json({ message: error.message })
    }
    logger.error({ error }, 'Failure saving template')
    return res.status(500).json({ message: t('something_went_wrong_server') })
  }
}

async function deleteTemplate(req, res, next) {
  const t = req.i18n.translate
  try {
    await TemplateGalleryManager.deleteTemplate({
      templateId: req.params.template_id,
      version: req.body.version
    })
    res.sendStatus(200)
  } catch (error) {
    logger.error({ error }, 'Failure deleting template')
    return res.status(500).json({ message: t('something_went_wrong_server') })
  }
}

async function getTemplatePreview(req, res, next) {
  try {
    const templateId = req.params.template_id
    const { version, style } = req.query

    const { stream, contentType } = await TemplateGalleryManager.fetchTemplatePreview({ templateId, version, style })

    res.setHeader('Content-Type', contentType)
    stream.pipe(res)
  } catch (error) {
    if (error.info?.status == 404) {
      return ErrorController.notFound(req, res, next)
    }
    return res.status(error.info?.status || 400).json(error.info)
  }
}

/**
 * Theme support parity with /project + /library: expose the logged-in
 * user's overallTheme (ol-userSettings meta) so useThemedPage follows the
 * Dark/Light/System setting and the account menu renders the theme
 * toggle (ol-overallThemes is a global render local).
 */
async function themeLocals(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) return {}
  try {
    const user = await UserGetter.promises.getUser(userId)
    if (!user) return {}
    const userSettings = await UserSettingsHelper.buildUserSettings(req, res, user)
    return { userSettings }
  } catch (err) {
    logger.warn({ err, userId }, 'template-gallery: theme locals unavailable; page renders with defaults')
    return {}
  }
}

async function templatesCategoryPage(req, res, next) {
  const t = req.i18n.translate
  try {
    let { category } = req.params
    const result = await TemplateGalleryManager.getTemplatesPageData(category)

    let title
    if (result.categoryName) {
      title = t('latex_templates') + ' — ' + result.categoryName
    } else {
      category = null
      title = t('templates_page_title')
    }
    res.render(Path.resolve(__dirname, '../views/template_gallery/template-gallery'), {
      title,
      category,
      ...await themeLocals(req, res),
    })
  } catch (error) {
    next(error)
  }
}

async function templateDetailsPage(req, res, next) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const template = await TemplateGalleryManager.getTemplate('_id', req.params.template_id)
    res.render(Path.resolve(__dirname, '../views/template_gallery/template'), {
      title: `${t('template')}: ${template.name}`,
      template: JSON.stringify(template),
      languages: Settings.languages,
      userIsTemplatesManager: Boolean(Settings.templates?.user_id && Settings.templates.user_id === userId),
      ...await themeLocals(req, res),
    })
  } catch (error) {
    return ErrorController.notFound(req, res, next)
  }
}

async function getTemplateJSON(req, res, next) {
  try {
    const { key, val } = req.query
    const template = await TemplateGalleryManager.getTemplate(key, val)
    res.json(template)
  } catch (error) {
    next(error)
  }
}

async function getCategoryTemplatesJSON(req, res, next) {
  try {
    const result = await TemplateGalleryManager.getCategoryTemplates(req.query)
    res.json(result)
  } catch (error) {
    next(error)
  }
}

/** New 3: GET /api/template/categories — enabled categories for the
 *  navigation switcher's Templates sub-items. */
async function getCategoriesJSON(req, res, next) {
  try {
    const categories = await TemplateGalleryManager.getEnabledCategories()
    res.json(categories)
  } catch (error) {
    next(error)
  }
}

/** 3b: GET /template/:template_id/bundle — download a template bundle
 *  (template.json + source.zip + output.pdf) for save/restore. */
async function downloadTemplateBundle(req, res) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const { buffer, filename, contentType } =
      await TemplateGalleryManager.getTemplateBundle({
        templateId: req.params.template_id,
        userId,
      })
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', String(buffer.length))
    res.end(buffer)
  } catch (error) {
    const status = error.status || 500
    logger.error({ error, templateId: req.params.template_id }, 'template bundle download failed')
    res.status(status).json({ message: status === 403 ? t('You are not allowed to do that') : error.message })
  }
}

/** 3b: POST /template/bundle/import — import a template bundle
 *  (base64 zip in body.data; body.override replaces an existing template
 *  with the same name). */
async function importTemplateBundle(req, res) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = SessionManager.getSessionUser(req.session)
  try {
    const { data, override } = req.body || {}
    if (typeof data !== 'string' || data.length === 0) {
      return res.status(400).json({ message: t('bundle_data_missing') })
    }
    const privileged = hasAdminAccess(user) ||
      Settings.templates?.user_id === userId
    const result = await TemplateGalleryManager.importTemplateBundle({
      data: Buffer.from(data, 'base64'),
      userId,
      override: !!override,
      privileged,
    })
    return res.json({
      template_id: result.templateId,
      version: result.version,
      created: result.created,
    })
  } catch (error) {
    if (error instanceof TemplateNameConflictError) {
      const ownerName = error.info?.ownerId === userId ? t('you') : error.info?.ownerId || 'unknown'
      return res.status(409).json({
        canOverride: true,
        message: t('template_with_this_title_exists_and_owned_by_x', { x: ownerName }),
      })
    }
    const status = error.status || 500
    logger.error({ error }, 'template bundle import failed')
    res.status(status).json({ message: error.message })
  }
}

export default {
  createTemplateFromProject,
  getCategoriesJSON,
  editTemplate,
  deleteTemplate,
  getTemplatePreview,
  templatesCategoryPage,
  templateDetailsPage,
  getTemplateJSON,
  getCategoryTemplatesJSON,
  downloadTemplateBundle,
  importTemplateBundle,
}
