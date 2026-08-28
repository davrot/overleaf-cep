import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LanguageToolController from './LanguageToolController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init languagetool router')

    // Authenticated endpoints (any logged-in user can use them; the
    // controller returns 503 when LanguageTool is not configured or the
    // admin has disabled it).
    webRouter.get(
      '/languagetool/languages',
      AuthenticationController.requireLogin(),
      LanguageToolController.getLanguages
    )

    webRouter.post(
      '/languagetool/check',
      AuthenticationController.requireLogin(),
      LanguageToolController.check
    )

    // Admin endpoints (connection check used by the admin settings "Check"
    // button).
    webRouter.post(
      '/admin/languagetool/check',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      LanguageToolController.checkConnection
    )
  },
}
