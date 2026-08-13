import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let WebdavModule = {}
if (process.env.WEBDAV_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling WebDAV module')

  const [
    { default: WebdavRouter },
    { WebdavSyncProjectStates },
    { WebdavUserCredentials }
  ] = await Promise.all([
    import('./app/src/WebdavRouter.mjs'),
    import('./app/models/webdavSyncProjectStates.mjs'),
    import('./app/models/webdavUserCredentials.mjs')
  ])

  // Set Settings.webdav for frontend exposure
  Settings.webdav = {
    enabled: true,
  }
  console.log('DEBUG: WebDAV enabled, Settings.webdav set to:', JSON.stringify(Settings.webdav))

  // Delete project sync state from mongo (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await WebdavSyncProjectStates.deleteMany({ projectId })
      logger.debug({ projectId }, 'on project expire: removed WebDAV sync state')
    } catch (err) {
      logger.warn(
        { projectId, err },
        'on project expire: failed to remove WebDAV sync state'
      )
    }
  })

  // Delete user credentials from mongo (hook 'expireDeletedUser')
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      const credentials = await WebdavUserCredentials.get(userId)
      
      // Unlink all projects associated with this user's WebDAV accounts
      if (credentials) {
        const username = credentials.username
        
        // Find all sync states for this user and unlink projects
        const syncStates = await WebdavSyncProjectStates.find({
          'connected': true,
          path: { $regex: new RegExp('.*' + username + '.*', 'i') }
        }).lean()
        
        for (const state of syncStates) {
          await WebdavSyncProjectStates.deleteOne({ projectId: state.projectId })
          logger.debug(
            { userId, projectId: state.projectId },
            'on user expire: unlinked project from WebDAV'
          )
        }
      }
      
      // Then delete credentials
      await WebdavUserCredentials.deleteMany({ userId })
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user credentials')
    }
  })

  WebdavModule = {
    router: WebdavRouter,
  }
}

console.log('DEBUG: WebDAV module ready, export:', WebdavModule ? 'router exists' : 'empty')
export default WebdavModule
