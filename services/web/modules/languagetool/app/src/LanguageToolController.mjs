import logger from '@overleaf/logger'
import fetch from 'node-fetch'
import {
  readAdminSettings,
  resolveLanguageToolUrl,
} from './adminConfig.mjs'

const MAX_TEXT_SIZE = 100_000 // 100 KB limit for safety

// Rules that produce excessive false positives on LaTeX documents.
const LATEX_DISABLED_RULES = [
  'WHITESPACE_RULE',
  'COMMA_PARENTHESIS_WHITESPACE',
  'CONSECUTIVE_SPACES',
  'DASH_RULE',
  'UPPERCASE_SENTENCE_START',
].join(',')

/**
 * Effective LanguageTool URL (per request, so admin changes apply at runtime
 * without a server restart).
 *  Admin JSON `languageToolUrl` (managed from the LLM admin settings page)
 *  wins over the env-derived `Settings.languageToolURL`.
 */
async function effectiveUrl() {
  const admin = await readAdminSettings()
  const adminDisabled = admin.languageToolDisabledByAdmin === true
  const url = resolveLanguageToolUrl(admin)
  return {
    available: !!(url && !adminDisabled),
    url,
    adminDisabled,
  }
}

const LanguageToolController = {
  /**
   * GET /languagetool/languages
   * Returns the list of supported languages from the LT service.
   */
  async getLanguages(req, res, next) {
    const { available, url } = await effectiveUrl()
    if (!available) {
      return res.status(503).json({
        error: 'LanguageTool is not available. Ask your administrator.',
      })
    }

    try {
      const response = await fetch(`${url}/v2/languages`, {
        headers: { Accept: 'application/json' },
        timeout: 10_000,
      })

      if (!response.ok) {
        logger.error(
          { status: response.status },
          'LanguageTool languages request failed'
        )
        return res.status(502).json({ error: 'LanguageTool request failed' })
      }

      const data = await response.json()
      res.json(data)
    } catch (err) {
      logger.error({ err }, 'Error fetching LanguageTool languages')
      next(err)
    }
  },

  /**
   * POST /languagetool/check
   * Proxies text/annotation data to the LanguageTool service and returns
   * matches. Accepts JSON body: { language, text?, data? }
   */
  async check(req, res, next) {
    const { available, url } = await effectiveUrl()
    if (!available) {
      return res.status(503).json({
        error: 'LanguageTool is not available. Ask your administrator.',
      })
    }

    const { language = 'auto', text, data } = req.body

    if (!text && !data) {
      return res.status(400).json({ error: 'text or data is required' })
    }

    // Sanitize: reject oversized requests
    const contentStr =
      typeof data === 'string'
        ? data
        : typeof data === 'object'
          ? JSON.stringify(data)
          : text || ''

    if (contentStr.length > MAX_TEXT_SIZE) {
      logger.warn(
        { size: contentStr.length },
        'LanguageTool request exceeds size limit, truncating'
      )
    }

    try {
      const params = new URLSearchParams()
      params.set('language', language)

      if (data) {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data)
        params.set('data', dataStr.slice(0, MAX_TEXT_SIZE))
      } else {
        params.set('text', (text || '').slice(0, MAX_TEXT_SIZE))
      }

      // Disable rules that produce excessive false positives in LaTeX documents
      params.set('disabledRules', LATEX_DISABLED_RULES)

      const response = await fetch(`${url}/v2/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
        timeout: 60_000,
      })

      if (!response.ok) {
        const body = await response.text()
        logger.error(
          { status: response.status, body },
          'LanguageTool check failed'
        )
        return res.json({ matches: [] })
      }

      const result = await response.json()
      res.json(result)
    } catch (err) {
      // On timeout or network error return empty results so the linter stays
      // silent.
      if (err.type === 'request-timeout' || err.name === 'FetchError') {
        logger.warn(
          { err },
          'LanguageTool check timed out or failed, returning empty results'
        )
        return res.json({ matches: [] })
      }
      logger.error({ err }, 'Error checking text with LanguageTool')
      next(err)
    }
  },

  /**
   * POST /admin/languagetool/check
   * Admin connection check for the LanguageTool server (used by the Check
   * button in the admin settings page). `url` is optional: the configured
   * admin URL is used when not provided, so the button works before saving.
   */
  async checkConnection(req, res, next) {
    const { url: providedUrl } = req.body
    const admin = await readAdminSettings()
    const url = providedUrl || resolveLanguageToolUrl(admin)

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'No LanguageTool URL configured',
      })
    }

    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/v2/languages`, {
        headers: { Accept: 'application/json' },
        timeout: 15_000,
      })

      if (!response.ok) {
        return res.json({
          success: false,
          error: `LanguageTool server responded with status ${response.status}`,
        })
      }

      const data = await response.json()
      const languageCount = Array.isArray(data) ? data.length : 0

      res.json({
        success: true,
        message: 'LanguageTool reachable',
        languageCount,
      })
    } catch (err) {
      logger.error({ err, url }, '[LT] Admin connection check failed')
      res
        .status(500)
        .json({ success: false, error: 'Connection attempt failed' })
    }
  },
}

export default LanguageToolController
