import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import {
  readAdminSettings,
  resolveLanguageToolUrl,
} from './app/src/adminConfig.mjs'

/**
 * LanguageTool module entry point.
 *
 * The router is always registered (module is loaded unconditionally); the
 * endpoints themselves degrade gracefully (503) when no LanguageTool server is
 * configured.
 *
 * LanguageTool server URL resolution (per request, so admin changes apply at
 * runtime without restart):
 *   admin JSON `languageToolUrl`  >  LANGUAGE_TOOL_URL env  >  HOST+PORT env
 *
 * Admin force-off flags (shared JSON file managed from the LLM admin page):
 *   languageToolDisabledByAdmin  -> LanguageTool unavailable for everyone
 *   llmDisabledByAdmin           -> LLM grammar check + chat disabled for everyone
 */

const admin = await readAdminSettings()
const url = resolveLanguageToolUrl(admin)
const ltAdminDisabled = admin.languageToolDisabledByAdmin === true

// Startup-time flags, exposed to the frontend (ExpressLocals reads Settings).
Settings.languageToolURL = url
Settings.languageToolAdminDisabled = ltAdminDisabled
Settings.languageToolAvailable = !!url && !ltAdminDisabled
// Force-off flag for the LLM feature (admin can disable LLM even when
// available, mirroring LanguageTool).
Settings.llmAdminEnabled = !(admin.llmDisabledByAdmin === true)

logger.info(
  {
    languageToolAvailable: Settings.languageToolAvailable,
    languageToolAdminDisabled: ltAdminDisabled,
    llmAdminEnabled: Settings.llmAdminEnabled,
  },
  '[LT] Module init'
)

const { default: LanguageToolRouter } = await import(
  './app/src/LanguageToolRouter.mjs'
)

const LanguageToolModule = {
  name: 'languagetool',
  router: LanguageToolRouter,
}

export default LanguageToolModule
