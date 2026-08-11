import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let DropboxModule = {}
if (process.env.DROPBOX_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling Dropbox module')

  const [
    { default: DropboxRouter },
    { DropboxSyncProjectStates },
    { DropboxUserCredentials },
  ] = await Promise.all([
    import('./app/src/DropboxRouter.mjs'),
    import('./app/models/dropboxSyncProjectStates.mjs'),
    import('./app/models/dropboxUserCredentials.mjs'),
  ])

  // Set Settings.dropbox for frontend exposure
  Settings.dropbox = {
    enabled: true,
    apiUrl: process.env.DROPBOXINTERFACE_API_URL || 'http://localhost:4003',
  }

  logger.debug({}, 'Dropbox settings:', JSON.stringify(Settings.dropbox))

  // Delete project sync state from mongo (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await DropboxSyncProjectStates.deleteMany({ projectId })
      logger.debug({ projectId }, 'on project expire: removed Dropbox sync state')
    } catch (err) {
      logger.warn(
        { projectId, err },
        'on project expire: failed to remove Dropbox sync state'
      )
    }
  })

  // Delete user credentials from mongo (hook 'expireDeletedUser')
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      await DropboxUserCredentials.deleteMany({ userId })
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user credentials')
    }
  })

  DropboxModule = {
    router: DropboxRouter,
  }
}

logger.info({}, 'Dropbox module ready:', DropboxModule ? 'router exists' : 'disabled')
export default DropboxModule
