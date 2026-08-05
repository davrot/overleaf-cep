import DropboxSync from './app/src/DropboxSync.mjs'
import DropboxCredentials from './app/src/DropboxCredentials.mjs'
import DropboxRouter from './app/src/DropboxRouter.mjs'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import SyncQueue from '../../app/src/infrastructure/SyncQueue.mjs'
import {
    addOptionalCleanupHandlerBeforeStoppingTraffic,
} from '../../app/src/infrastructure/GracefulShutdown.mjs'

const enabled = process.env.DROPBOX_ENABLED?.toLowerCase() === 'true'
const projectSyncTimers = new Map()

function scheduleProjectSync(projectId) {
    const key = projectId.toString()
    const previousTimer = projectSyncTimers.get(key)
    if (previousTimer) clearTimeout(previousTimer)
    const timer = setTimeout(() => {
        projectSyncTimers.delete(key)
        DropboxSync.syncProjectForLinkedUsers(projectId).catch(error => {
            logger.error({ err: error, projectId }, 'Dropbox modified project sync failed')
        })
    }, 1000)
    projectSyncTimers.set(key, timer)
}

if (enabled) {
    Settings.dropbox = { enabled: true }
    Modules.hooks.attach('expireDeletedUser', userId => DropboxSync.unlink(userId))
    Modules.hooks.attach('removeDropbox', userId => DropboxSync.unlink(userId))
    Modules.hooks.attach('projectFlushed', projectId =>
        DropboxSync.syncProjectForLinkedUsers(projectId).catch(error => {
            logger.error({ err: error, projectId }, 'Dropbox flushed project sync failed')
        })
    )
    Modules.hooks.attach('projectCreated', projectId => {
        setTimeout(() => scheduleProjectSync(projectId), 0)
    })
    Modules.hooks.attach('projectOpened', ({ projectId }) =>
        scheduleProjectSync(projectId)
    )
    Modules.hooks.attach('projectModified', ({ projectId }) => {
        scheduleProjectSync(projectId)
    })
    Modules.hooks.attach('projectEntityMoved', params =>
        DropboxSync.moveEntityForLinkedUsers(params)
    )
    Modules.hooks.attach('projectDeleted', params =>
        DropboxSync.deleteProjectForUsers(params)
    )
    Modules.hooks.attach('tpdsDuplicateProjectNames', ({ userId, source }) =>
        source === 'dropbox' ? DropboxSync.unlink(userId) : undefined
    )
}

let pollTimer
let pollInProgress = false

async function start() {
    SyncQueue.register('dropbox', async ({ userId, projectId }) => {
        await DropboxSync.flushProject(userId, projectId)
    })
    const intervalMs = Number(process.env.DROPBOX_POLL_INTERVAL_MS) || 0
    if (!enabled || intervalMs <= 0) return
    const poll = async () => {
        if (pollInProgress) return
        pollInProgress = true
        try {
            const users = await DropboxSync.getLinkedUserIds()
            const results = await Promise.allSettled(users.map(userId => DropboxSync.poll(userId)))
            for (const [index, result] of results.entries()) {
                if (result.status === 'rejected') {
                    logger.error({ err: result.reason, userId: users[index] }, 'Dropbox polling failed')
                    await DropboxCredentials.update(users[index], {
                        lastSyncAt: new Date().toISOString(),
                        lastSyncError: result.reason?.message || 'polling failed',
                    })
                }
            }
        } finally {
            pollInProgress = false
        }
    }
    await poll()
    pollTimer = setInterval(poll, intervalMs)
    pollTimer.unref?.()
    addOptionalCleanupHandlerBeforeStoppingTraffic('Dropbox polling', async () => {
        clearInterval(pollTimer)
        pollTimer = undefined
    })
}

export default enabled
    ? {
        router: DropboxRouter,
        start,
    }
    : {}