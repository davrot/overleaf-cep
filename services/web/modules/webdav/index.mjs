import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import {
  addOptionalCleanupHandlerBeforeStoppingTraffic,
} from '../../app/src/infrastructure/GracefulShutdown.mjs'
import WebdavRouter from './app/src/WebdavRouter.mjs'
import WebdavCredentials from './app/src/WebdavCredentials.mjs'
import WebdavSync from './app/src/WebdavSync.mjs'
import NotificationsBuilder from '../../app/src/Features/Notifications/NotificationsBuilder.mjs'

const enabled = process.env.WEBDAV_ENABLED?.toLowerCase() === 'true'

if (enabled) {
  Settings.webdav = {
    rootPath: process.env.WEBDAV_ROOT_PATH || '/Overleaf',
    requestTimeoutMs: Number(process.env.WEBDAV_REQUEST_TIMEOUT_MS) || 10_000,
    retryCount: Number(process.env.WEBDAV_RETRY_COUNT) || 2,
    retryDelayMs: Number(process.env.WEBDAV_RETRY_DELAY_MS) || 250,
  }

  Modules.hooks.attach('expireDeletedUser', userId =>
    WebdavCredentials.remove(userId)
  )

  Modules.hooks.attach('removeWebdav', userId =>
    WebdavCredentials.remove(userId)
  )

  Modules.hooks.attach('projectFlushed', projectId =>
    WebdavSync.syncProjectForLinkedUsers(projectId)
  )

  Modules.hooks.attach('projectCreated', projectId =>
    WebdavSync.syncProjectForLinkedUsers(projectId)
  )

  Modules.hooks.attach('projectDeleted', params =>
    WebdavSync.deleteProjectForUsers(params)
  )

  Modules.hooks.attach('projectModified', ({ projectId }) =>
    WebdavSync.syncProjectForLinkedUsers(projectId)
  )

  Modules.hooks.attach('projectEntityMoved', params =>
    WebdavSync.moveEntityForLinkedUsers(params)
  )

  Modules.hooks.attach(
    'tpdsDuplicateProjectNames',
    ({ userId, source }) =>
      source === 'webdav' ? WebdavCredentials.remove(userId) : undefined
  )
}

let pollTimer
let pollInProgress = false

async function start() {
  const intervalMs = Number(process.env.WEBDAV_POLL_INTERVAL_MS) || 0
  if (!enabled || intervalMs <= 0) return

  const poll = async () => {
    if (pollInProgress) return
    pollInProgress = true
    const startedAt = Date.now()
    try {
      const users = await WebdavCredentials.getLinkedUserIds()
      logger.info({ userCount: users.length, intervalMs }, 'WebDAV polling cycle started')
      const results = await Promise.allSettled(
        users.map(userId => WebdavSync.pollUser(userId))
      )
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          logger.error(
            { err: result.reason, userId: users[index] },
            'WebDAV polling failed for user'
          )
          await WebdavCredentials.updateSyncStatus(users[index], {
            lastSyncError: result.reason?.message || 'polling failed',
          })
          try {
            await NotificationsBuilder.promises.webdavSync(users[index]).create(
              'failure'
            )
          } catch (error) {
            logger.warn({ err: error }, 'failed to create WebDAV polling notification')
          }
        }
      }
      logger.info(
        {
          userCount: users.length,
          failedUserCount: results.filter(result => result.status === 'rejected').length,
          durationMs: Date.now() - startedAt,
        },
        'WebDAV polling cycle completed'
      )
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - startedAt },
        'WebDAV polling cycle failed'
      )
    } finally {
      pollInProgress = false
    }
  }
  await poll()
  pollTimer = setInterval(poll, intervalMs)
  pollTimer.unref?.()
  addOptionalCleanupHandlerBeforeStoppingTraffic('webdav polling', async () => {
    clearInterval(pollTimer)
    pollTimer = undefined
  })
}

export default enabled
  ? {
    router: WebdavRouter,
    start,
  }
  : {}