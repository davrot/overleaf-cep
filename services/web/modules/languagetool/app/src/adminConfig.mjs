import {
  readAdminSettings,
  writeAdminSettings,
  ADMIN_SETTINGS_PATH,
} from '../../../llm/app/src/LLMAdminController.mjs'

/**
 * LanguageTool admin configuration helpers.
 *
 * The LLM module owns the admin settings file (single source of truth,
 * managed via /admin/llm/settings). We re-export its reader/writer here so
 * every LanguageTool consumer imports from one place, and add the
 * LanguageTool-specific URL resolution.
 *
 * Shared admin fields:
 *   systemPrompt, llmApiUrl, llmApiKey, allowedModels   (LLM feature)
 *   llmDisabledByAdmin                                  (force-off LLM for all)
 *   languageToolUrl                                     (LanguageTool server URL)
 *   languageToolDisabledByAdmin                         (force-off LanguageTool)
 */

export { readAdminSettings, writeAdminSettings, ADMIN_SETTINGS_PATH }

/**
 * LanguageTool server URL resolution order (evaluated per request so admin
 * changes apply at runtime without a restart):
 *   admin JSON `languageToolUrl`  >  LANGUAGE_TOOL_URL env  >  HOST/PORT env
 * Returns undefined when nothing is configured (=> LanguageTool unavailable).
 */
export function resolveLanguageToolUrl(admin) {
  if (admin && admin.languageToolUrl) {
    return admin.languageToolUrl
  }
  if (process.env.LANGUAGE_TOOL_URL) {
    return process.env.LANGUAGE_TOOL_URL
  }
  if (process.env.LANGUAGE_TOOL_HOST || process.env.LANGUAGE_TOOL_PORT) {
    return `http://${process.env.LANGUAGE_TOOL_HOST || 'languagetool'}:${process.env.LANGUAGE_TOOL_PORT || '8010'}`
  }
  return undefined
}
