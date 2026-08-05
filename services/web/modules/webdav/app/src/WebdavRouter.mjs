import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import WebdavController from './WebdavController.mjs'

export default {
  apply(webRouter) {
    webRouter.get(
      '/user/webdav/status',
      AuthenticationController.requireLogin(),
      WebdavController.status
    )
    webRouter.post(
      '/user/webdav/connect',
      AuthenticationController.requireLogin(),
      WebdavController.connect
    )
    webRouter.post(
      '/user/webdav/disconnect',
      AuthenticationController.requireLogin(),
      WebdavController.disconnect
    )
    webRouter.post(
      '/user/webdav/poll',
      AuthenticationController.requireLogin(),
      WebdavController.poll
    )
    webRouter.post(
      '/project/:project_id/webdav/sync',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      WebdavController.syncProject
    )
    webRouter.post(
      '/project/:project_id/webdav/conflict',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      WebdavController.resolveConflict
    )
  },
}