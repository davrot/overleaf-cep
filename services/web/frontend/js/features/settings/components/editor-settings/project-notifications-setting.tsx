import { useTranslation } from 'react-i18next'
import RadioButtonSetting, { RadioOption } from '../radio-button-setting'
import {
  NotificationLevel,
  useProjectNotificationPreferences,
} from '../../hooks/use-project-notification-preferences'
import BetaBadgeIcon from '@/shared/components/beta-badge-icon'

export default function ProjectNotificationsSetting() {
  const { t } = useTranslation()
  const { notificationLevel, setNotificationLevel, isLoading } =
    useProjectNotificationPreferences()

  const options: Array<RadioOption<NotificationLevel>> = [
    {
      value: 'all',
      label: t('all_project_activity'),
      description: t('all_project_activity_description'),
    },
    {
      value: 'replies',
      label: t('replies_to_your_activity_only'),
      description: t('replies_to_your_activity_only_description'),
    },
    {
      value: 'off',
      label: t('off'),
      description: t('no_project_notifications_description'),
    },
  ]

  return (
    <>
      <RadioButtonSetting
        id="projectNotifications"
        options={options}
        value={isLoading ? undefined : notificationLevel}
        onChange={setNotificationLevel}
      />
      <div className="global-notifications-link">
        <a
          href="/user/notification-preferences"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('manage_overleaf_email_preferences')}
        </a>
      </div>
      <div className="project-notifications-beta-note">
        <BetaBadgeIcon />
        <div>
          <span className="beta-note-text">
            {t('email_notifications_are_currently_in_beta')}{' '}
            {t('these_settings_might_change_in_the_future')}{' '}
          </span>
          {/* TODO: update forms link */}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://forms.gle/"
          >
            {t('give_feedback')}
          </a>
        </div>
      </div>
    </>
  )
}
