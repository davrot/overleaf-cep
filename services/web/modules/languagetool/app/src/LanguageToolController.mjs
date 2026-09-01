import logger from '@overleaf/logger'
import {
  readAdminSettings,
  resolveLanguageToolUrl,
} from './adminConfig.mjs'

const MAX_TEXT_SIZE = 100_000 // 100 KB limit for safety

// Timeout budgets (ms) per endpoint.
const LANGUAGES_TIMEOUT_MS = 10_000
const CHECK_TIMEOUT_MS = 60_000
const CONNECTION_CHECK_TIMEOUT_MS = 15_000

// Rules that produce excessive false positives on LaTeX documents.
const LATEX_DISABLED_RULES = [
  'WHITESPACE_RULE',
  'COMMA_PARENTHESIS_WHITESPACE',
  'CONSECUTIVE_SPACES',
  'DASH_RULE',
  'UPPERCASE_SENTENCE_START',
].join(',')

/**
 * Effective check level for this request:
 *  - body.picky === false → 'default' (project/user opted out)
 *  - body.picky === true  → 'picky'
 *  - absent               → LANGUAGE_TOOL_LEVEL env, else 'picky'
 *
 * picky is ON by default (owner decision, 2026-08-31): the self-hosted LT
 * image ships the full rule set and picky unlocks the tag="picky" rules
 * (passive voice, wordiness, fragments, ...); a user annoyed by them turns
 * it OFF in the project settings, which the editor extension forwards here.
 */
export function checkLevel(reqBody) {
  const picky = reqBody && Object.prototype.hasOwnProperty.call(reqBody, 'picky')
    ? reqBody.picky === true
    : undefined
  if (picky !== undefined) return picky ? 'picky' : 'default'
  const envLevel = String(process.env.LANGUAGE_TOOL_LEVEL || '').toLowerCase()
  if (envLevel === 'picky' || envLevel === 'default') return envLevel
  return 'picky'
}

/**
 * Effective LanguageTool URL (per request, so admin changes apply at runtime
 * without a server restart).
 *  Admin JSON `languageToolUrl` (managed from the LLM admin settings page)
 *  wins over the env-derived fallback. Trailing slashes are normalized.
 */
async function effectiveUrl() {
  const admin = await readAdminSettings()
  const adminDisabled = admin.languageToolDisabledByAdmin === true
  const raw = resolveLanguageToolUrl(admin)
  const url = typeof raw === 'string' ? raw.replace(/\/+$/, '') : raw
  return {
    available: !!(url && !adminDisabled),
    url,
    adminDisabled,
  }
}

function isAbortOrTimeout(err) {
  return err?.name === 'TimeoutError' ||
         err?.name === 'AbortError' ||
         err?.code === 'ABORT_ERR'
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
        signal: AbortSignal.timeout(LANGUAGES_TIMEOUT_MS),
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
      if (isAbortOrTimeout(err)) {
        logger.warn({ err: err?.name }, 'LanguageTool languages request timed out')
        return res.status(504).json({ error: 'LanguageTool timed out' })
      }
      logger.error({ err }, 'Error fetching LanguageTool languages')
      next(err)
    }
  },

  /**
   * POST /languagetool/check
   * Proxies text/annotation data to the LanguageTool service and returns
   * matches. Accepts JSON body: { language, text?, data?, picky? }
   */
  async check(req, res, next) {
    const { available, url } = await effectiveUrl()
    if (!available) {
      return res.status(503).json({
        error: 'LanguageTool is not available. Ask your administrator.',
      })
    }

    const body = req.body || {}
    const { language = 'auto', text, data } = body
    const level = checkLevel(body)

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

      // picky rules (passive voice, wordiness, fragments, ...) are WITHHELD
      // by the LT server unless requested; default ON here, per-project opt-
      // out arrives as picky:false from the editor extension.
      params.set('level', level)

      // Disable rules that produce excessive false positives in LaTeX documents
      params.set('disabledRules', LATEX_DISABLED_RULES)

      const response = await fetch(`${url}/v2/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      })

      if (!response.ok) {
        const errText = await response.text()
        logger.error(
          { status: response.status, errText: errText.slice(0, 500) },
          'LanguageTool check failed'
        )
        return res.json({ matches: [] })
      }

      const result = await response.json()
      res.json(result)
    } catch (err) {
      // On timeout or network error return empty results so the linter stays
      // silent.
      if (isAbortOrTimeout(err) || err?.name === 'TypeError') {
        logger.warn(
          { err: err?.name || err?.message },
          'LanguageTool check failed or timed out, returning empty results'
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
  async checkConnection(req, res) {
    const providedUrl = req.body && req.body.url
    const admin = await readAdminSettings()
    const fallback = resolveLanguageToolUrl(admin)
    const rawUrl = providedUrl || fallback
    const url = typeof rawUrl === 'string' ? rawUrl.replace(/\/+$/, '') : rawUrl

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'No LanguageTool URL configured',
      })
    }

    try {
      const response = await fetch(`${url}/v2/languages`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(CONNECTION_CHECK_TIMEOUT_MS),
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
      logger.error({ err: err?.name || err?.message, url }, '[LT] Admin connection check failed')
      res
        .status(500)
        .json({ success: false, error: 'Connection attempt failed' })
    }
  },
}

export default LanguageToolController
