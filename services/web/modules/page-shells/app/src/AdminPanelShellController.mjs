import path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import AdminController from '../../../../app/src/Features/ServerAdmin/AdminController.mjs'
import captureRender from './captureRender.mjs'

/**
 * PSH — /admin/panel shell (UI-R10 W8).
 *
 * Runs the UPSTREAM `AdminController.index` handler (imported, unmodified)
 * against a fake response object, captures its exact render locals
 * (title/openSockets/systemMessages/privilegesMatrix/adminOverallTheme),
 * and renders them into this module's bookmarkable, themed shell view
 * `admin-panel.pug`, which reuses the upstream `bookmarkable_tabset`
 * mixin, the upstream `active-projects` partial, and the unchanged
 * upstream /admin POST endpoints.
 *
 * The original /admin page keeps working untouched.
 */
const adminPanelView = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../views/admin-panel.pug'
)

const AdminPanelShellController = {
  adminPanelPage: (req, res, next) => {
    void (async () => {
      const cap = captureRender()
      await cap.run(AdminController.index, req)

      if (cap.redirected) {
        return res.redirect(cap.redirected)
      }

      const { locals } = cap.ensureRendered()
      logger.debug({ reqId: req.id }, 'PSH rendering /admin/panel shell')
      res.render(adminPanelView, {
        ...locals,
        title: 'System Admin',
        // Shells identify themselves so stylesheets/logic can adjust:
        isAdminPanelShell: true,
        // Upstream /admin URL, kept for cross-links:
        upstreamAdminUrl: '/admin',
      })
    })().catch(next)
  },
}

export default AdminPanelShellController
