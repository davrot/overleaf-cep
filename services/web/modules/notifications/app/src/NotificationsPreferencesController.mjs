// @ts-check

import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import * as Path from 'node:path'
import { parseReq, z } from '../../../../app/src/infrastructure/Validation.mjs'
import NotificationsPreferencesHandler from './NotificationsPreferencesHandler.mjs'

const globalPreferencesSchema = z.object({
  muteAllNotifications: z.boolean(),
})

const projectPreferencesSchema = z.looseObject({})

// Form submission from /user/notification-preferences (form-encoded, not
// JSON): checkbox value present when checked, absent when unchecked.
const updateGlobalPreferencesFormSchema = z.object({
  body: z.looseObject({
    muteAllNotifications: z.string().optional(),
  }),
})

async function globalPreferencesPage(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const preferences = await NotificationsPreferencesHandler.promises.getGlobalPreferences(
      userId
    )
    res.render(
      Path.resolve(import.meta.dirname, '../views/user/notification-preferences'),
      {
        title: 'email_preferences',
        muteAllNotifications: preferences.muteAllNotifications,
      }
    )
  } catch (err) {
    next(err)
  }
}

async function getGlobalPreferences(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const preferences = await NotificationsPreferencesHandler.promises.getGlobalPreferences(
      userId
    )
    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

async function updateGlobalPreferences(req, res, next) {
  try {
    const { body } = parseReq(req, globalPreferencesSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)

    await NotificationsPreferencesHandler.promises.saveGlobalPreferences(
      userId,
      body
    )

    res.json(body)
  } catch (err) {
    next(err)
  }
}

async function updateGlobalPreferencesFromForm(req, res, next) {
  try {
    const { body } = parseReq(req, updateGlobalPreferencesFormSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)

    const preferences = {
      muteAllNotifications: Boolean(body.muteAllNotifications),
    }

    await NotificationsPreferencesHandler.promises.saveGlobalPreferences(
      userId,
      preferences
    )

    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

async function getProjectPreferences(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const preferences = await NotificationsPreferencesHandler.promises.getProjectPreferences(
      userId,
      req.params.projectId
    )
    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

async function saveProjectPreferences(req, res, next) {
  try {
    const { body } = parseReq(req, projectPreferencesSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)

    await NotificationsPreferencesHandler.promises.saveProjectPreferences(
      userId,
      req.params.projectId,
      body
    )

    res.json(null)
  } catch (err) {
    next(err)
  }
}

async function sendTestEmail(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await UserGetter.promises.getUser(userId, { email: 1 })

    if (!user || !user.email) {
      throw new Error('User email not found')
    }

    await EmailHandler.promises.sendEmail('testEmail', { to: user.email })

    res.json({ message: res.locals.translate('email_sent') })
  } catch (err) {
    logger.warn({ err, userId: req.session?.userId }, 'failed to send test email')
    next(err)
  }
}

export default {
  globalPreferencesPage,
  getGlobalPreferences,
  updateGlobalPreferences,
  updateGlobalPreferencesFromForm,
  getProjectPreferences,
  saveProjectPreferences,
  sendTestEmail,
}
