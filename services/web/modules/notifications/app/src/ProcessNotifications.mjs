/**
 * Scheduled email-notification queue processor.
 *
 * Claims due documents from the `emailNotifications` collection and sends
 * them via the web `EmailHandler`. Run by `services/web/scripts/process_notifications.mjs`
 * (cron).
 *
 * Claim protocol (atomic, single-consumer safe):
 * - claim: `findOneAndUpdate` sets `processing: true` + `processingStartedAt`
 * - success: doc is deleted
 * - failure: doc gets `attempts += 1`, `nextRetryAt = now + backoff(attempts)`,
 *   `processing: false`; after `MAX_ATTEMPTS` it is dead-lettered (`dead: true`)
 * - a claim older than `STALE_PROCESSING_MS` (consumer crashed) is reclaimed
 *
 * Dry run (`OVERLEAF_NOTIFICATIONS_DRY_RUN=true`): resolves recipients and
 * counts, but sends nothing and leaves the queue un-consumed.
 */

import logger from '@overleaf/logger'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { db, connectionPromise } from '../../../../app/src/infrastructure/mongodb.mjs'

const BATCH_SIZE = Number(process.env.PROCESS_NOTIFICATIONS_BATCH_SIZE) || 100
const STALE_PROCESSING_MS = 1000 * 60 * 60 // 1 hour
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_BASE_MS = 2 * 60 * 60 * 1000 // 2 hours, doubling per attempt

const DRY_RUN = process.env.OVERLEAF_NOTIFICATIONS_DRY_RUN === 'true'

function _buildEmailTask(notification) {
  const emailType = notification.emailType || notification.type
  const opts = notification.opts || notification.options || notification.data || {}

  if (!emailType) {
    throw new Error('scheduled email notification is missing emailType')
  }

  // keep toUserId only as fallback; actual resolution happens in processNotifications
  if (notification.recipient_id && !opts.to && !opts.toUserId) {
    opts.toUserId = notification.recipient_id
  }

  if (notification.project_id && opts.projectId == null) {
    opts.projectId = notification.project_id
  }

  return { emailType, opts }
}

function _claimNextDueNotification() {
  const now = Date.now()
  const nowDate = new Date(now)
  const staleDate = new Date(now - STALE_PROCESSING_MS)

  return db.emailNotifications.findOneAndUpdate(
    {
      scheduledAt: { $lte: nowDate },
      $or: [
        // never-processed
        { processing: { $exists: false } },
        // failed with retry scheduled
        { processing: false, nextRetryAt: { $lt: nowDate } },
        // failed by the legacy writer (no backoff field)
        { processing: false, nextRetryAt: { $exists: false } },
        // stale in-progress claim (consumer died)
        { processing: true, processingStartedAt: { $lt: staleDate } },
      ],
      $nor: [{ dead: true }],
    },
    {
      $set: { processing: true, processingStartedAt: nowDate },
    },
    { sort: { scheduledAt: 1 }, returnDocument: 'after' }
  )
}

async function _markFailed(notification, err) {
  const attempts = (notification.attempts || 0) + 1
  logger.warn(
    { err: err?.message || String(err), attempts, notificationId: notification._id },
    'failed to process scheduled email notification'
  )

  if (attempts >= MAX_ATTEMPTS) {
    await db.emailNotifications.updateOne(
      { _id: notification._id },
      {
        $set: {
          dead: true,
          processing: false,
          attempts,
          processingError: err?.message || String(err),
        },
      }
    )
    return
  }

  const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempts - 1)
  await db.emailNotifications.updateOne(
    { _id: notification._id },
    {
      $set: {
        processing: false,
        attempts,
        nextRetryAt: new Date(Date.now() + backoff),
        processingError: err?.message || String(err),
      },
    }
  )
}

function _resetForDryRun(notification) {
  // Do not consume the doc: make it claimable again without a backoff.
  return db.emailNotifications.updateOne(
    { _id: notification._id },
    {
      $set: { processing: false },
      $unset: { nextRetryAt: '', processingStartedAt: '' },
    }
  )
}

export async function processNotifications() {
  await connectionPromise

  let notificationsFound = 0
  let notificationsReady = 0
  let emailsSent = 0
  let dryRunProcessed = 0
  let dryRunWouldHaveSent = 0

  while (notificationsFound < BATCH_SIZE) {
    const result = await _claimNextDueNotification()
    const notification = result && result.value
    if (!notification) {
      break
    }
    notificationsFound += 1

    try {
      const { emailType, opts } = _buildEmailTask(notification)

      // Resolve recipient_id to actual email address if not already set
      if (!opts.to && opts.toUserId) {
        const user = await UserGetter.promises.getUser(opts.toUserId, {
          email: 1,
        })
        if (!user || !user.email) {
          throw new Error(
            `recipient user ${opts.toUserId} not found or has no email`
          )
        }
        opts.to = user.email
        delete opts.toUserId
      }

      notificationsReady += 1

      if (DRY_RUN) {
        // Dry run leaves the queue un-consumed for inspection.
        await _resetForDryRun(notification)
        dryRunProcessed += 1
        dryRunWouldHaveSent += 1
        continue
      }

      await EmailHandler.promises.sendEmail(emailType, opts)
      emailsSent += 1
      await db.emailNotifications.deleteOne({ _id: notification._id })
    } catch (err) {
      await _markFailed(notification, err)
    }
  }

  return {
    notificationsFound,
    notificationsReady,
    emailsSent,
    dryRunProcessed,
    dryRunWouldHaveSent,
  }
}
