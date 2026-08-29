import logger from '@overleaf/logger'
import UserListController from './UserListController.mjs'
import ProjectListController from './ProjectListController.mjs'
import AdminToolsController from './AdminToolsController.mjs'
import SiteSettingsController from './SiteSettingsController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init AdminTools router')

    webRouter.get('/user/activate', UserListController.activateAccountPage)
    AuthenticationController.addEndpointToLoginWhitelist('/user/activate')

    webRouter.get('/admin/user',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.manageUsersPage
    )
    webRouter.post(
      '/admin/user/create',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.registerNewUser
    )
    webRouter.post('/admin/user/:userId/send-activation',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.sendActivationEmail
    )
    webRouter.get('/admin/user/:userId/info',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getAdditionalUserInfo,
    )
    webRouter.post('/admin/users',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getUsersJson
    )
    webRouter.post('/admin/user/:userId/delete',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.deleteUser
    )
    webRouter.post('/admin/user/:userId/update',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.updateUser,
    )
    webRouter.delete('/admin/user/:userId',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.purgeDeletedUser
    )
    webRouter.post('/admin/user/:userId/restore',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.restoreDeletedUser
    )
    webRouter.post('/admin/user/:userId/projects',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.getProjectsJson
    )

    webRouter.get('/admin/project',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.manageProjectsPage
    )
    webRouter.post('/admin/project/:project_id/trash',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.trashProjectForUser
    )
    webRouter.post('/admin/project/:project_id/untrash',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.untrashProjectForUser
    )
    webRouter.delete('/admin/project/:project_id/purge',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.purgeDeletedProject
    )
    webRouter.delete('/admin/project/:project_id',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.deleteProject
    )
    webRouter.post('/admin/project/:project_id/undelete',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.undeleteProject
    )

    webRouter.get('/admin/active-projects',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      AdminToolsController.activeProjects,
    )

    // ---- Manage Site (SiteSettings: templates/zotero/external-urls/signup) ---
    webRouter.get('/admin/site',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      SiteSettingsController.manageSitePage
    )
    webRouter.get('/admin/site-settings',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      SiteSettingsController.getSiteSettings
    )
    webRouter.put('/admin/site-settings/:section',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      SiteSettingsController.updateSiteSettings
    )
    // R6 item 7 (2026-08-29): list the users holding the template gallery
    // admin flag (Manage Site → Templates table).
    webRouter.get('/admin/site/template-admins',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.templateAdmins
    )
  },
}
