import NotificationsPreferencesRouter from './app/src/NotificationsPreferencesRouter.mjs'
import { scheduleProjectChangeNotifications } from './app/src/ScheduleProjectChangeNotifications.mjs'

/**
 * Notifications module.
 *
 * Owns:
 * - the scheduled email-notification queue consumer (`ProcessNotifications.mjs`,
 *   also imported directly by `services/web/scripts/process_notifications.mjs`)
 * - per-project / global notification preference endpoints + the
 *   `/user/notification-preferences` page (`NotificationsPreferencesRouter.mjs`)
 * - the `projectModified` queue hook that schedules project-change emails
 *
 * Registered via `Settings.moduleImportSequence` ("notifications").
 */

/** @import { WebModule } from "../../types/web-module" */

/** @type {WebModule} */
const NotificationsModule = {
  router: NotificationsPreferencesRouter,
  hooks: {
    projectModified: scheduleProjectChangeNotifications,
  },
}

export default NotificationsModule
