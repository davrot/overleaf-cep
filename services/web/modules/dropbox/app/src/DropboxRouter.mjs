import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import DropboxController from './DropboxController.mjs'
import DropboxWebhookController from './DropboxWebhookController.mjs'

export default {
    apply(webRouter) {
        webRouter.get(
            '/dropbox/beginAuth',
            AuthenticationController.requireLogin(),
            DropboxController.beginAuth
        )
        webRouter.get(
            '/dropbox/completeRegistration',
            AuthenticationController.requireLogin(),
            DropboxController.completeRegistration
        )
        webRouter.get(
            '/dropbox/unlink',
            AuthenticationController.requireLogin(),
            DropboxController.unlink
        )
        webRouter.get(
            '/user/dropbox/status',
            AuthenticationController.requireLogin(),
            DropboxController.status
        )
        webRouter.post(
            '/user/dropbox/poll',
            AuthenticationController.requireLogin(),
            DropboxController.poll
        )
        webRouter.post(
            '/user/dropbox/sync',
            AuthenticationController.requireLogin(),
            DropboxController.sync
        )
        webRouter.get(
            '/project/:project_id/dropbox/status',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            DropboxController.projectStatus
        )
        webRouter.post(
            '/project/:project_id/dropbox/sync',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            DropboxController.syncProject
        )
        webRouter.post(
            '/project/:project_id/dropbox/resolve',
            AuthenticationController.requireLogin(),
            AuthorizationMiddleware.ensureUserCanWriteProjectContent,
            DropboxController.resolveConflict
        )
        webRouter.get('/dropbox/webhook', DropboxWebhookController.verify)
    },
    applyNonCsrfRouter(webRouter) {
        webRouter.post('/dropbox/webhook', DropboxWebhookController.webhook)
    },
}