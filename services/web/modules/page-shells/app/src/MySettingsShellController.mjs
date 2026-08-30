import path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import UserPagesController from '../../../../app/src/Features/User/UserPagesController.mjs'
import captureRender from './captureRender.mjs'

/**
 * PSH — /user/mysettings shell (UI-R10 W8).
 *
 * Runs the UPSTREAM `UserPagesController.settingsPage` handler (imported,
 * unmodified — including its session-message consumption and split-test
 * assignments) against a fake response object, captures its exact render
 * locals, and renders the SAME `pages/user/settings` React entrypoint
 * through this module's own view `user-my-settings.pug`
 * (mirrors upstream app/views/user/settings.pug: entrypoint, vars and
 * meta tags, using the identical local names — verified by unit tests).
 *
 * The original /user/settings page keeps working untouched.
 */
const mySettingsView = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../views/user-my-settings.pug'
)

const MySettingsShellController = {
  mySettingsPage: (req, res, next) => {
    void (async () => {
      const cap = captureRender()
      await cap.run(UserPagesController.settingsPage, req)

      if (cap.redirected) {
        // Upstream sent the user to the login page / home.
        return res.redirect(cap.redirected)
      }

      const { locals } = cap.ensureRendered()
      logger.debug({ reqId: req.id }, 'PSH rendering /user/mysettings shell')
      res.render(mySettingsView, {
        ...locals,
        isMySettingsShell: true,
        upstreamSettingsUrl: '/user/settings',
      })
    })().catch(next)
  },
}

export default MySettingsShellController
