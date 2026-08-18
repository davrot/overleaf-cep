/**
 * Project-scope notification preferences.
 *
 * One document per (user, project) in the `notificationsPreferences`
 * collection (see migration 20251110151140). The values map 1:1 to the
 * radio levels in `project-notifications-setting.tsx`:
 * - "all"     -> all keys true
 * - "replies" -> replies/reopened/resolved/authored keys true, others false
 * - "off"     -> all keys false
 */
export type NotificationPreferencesSchema = {
  commentOnOwnProject: boolean
  commentOnInvitedProject: boolean
  repliesOnAuthoredThread: boolean
  repliesOnParticipatingThread: boolean
  commentResolvedOnAuthoredThread: boolean
  commentResolvedOnParticipatingThread: boolean
  commentReopenedOnAuthoredThread: boolean
  commentReopenedOnParticipatingThread: boolean
  trackedChangesOnOwnProject: boolean
  trackedChangesOnInvitedProject: boolean
  trackChangesAcceptedOnAuthoredChange: boolean
  trackChangesRejectedOnAuthoredChange: boolean
}

/**
 * Global (project-agnostic) notification preferences.
 *
 * Stored in the same `notificationsPreferences` collection with
 * `project_id: null`. Used as the fallback when a project-level
 * preference document does not exist.
 */
export type GlobalNotificationPreferencesSchema =
  NotificationPreferencesSchema
