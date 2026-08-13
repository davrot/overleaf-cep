import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLNotification from '@/shared/components/ol/ol-notification'
import GithubLogo from '@/shared/svgs/github-logo'
import GitLabLogo from '@/shared/svgs/gitlab-logo'

export const GitHubSyncWidget = function GitHubSyncWidget() {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  // Get server type from environment or default to github
  const serverType = process.env.GIT_SYNC_SERVER_TYPE || 'github'
  
  // Determine icon based on server type
  const ServerLogo = () => {
    switch (serverType) {
      case 'gitlab': return GitLabLogo
      case 'gitea':
      case 'forgejo':
        return GithubLogo
      default: return GithubLogo
    }
  }

  const {
    isLoading: isCheckingConn,
    isError: isErrorConnCheck,
    runAsync: runAsyncConnCheck,
    data: isConnected,
    setData: setConnState,
  } = useAsync<boolean>()

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const [showUnlinkModal, setShowUnlinkModal] = useState(false)

  const handleConnCheck = useCallback(() => {
    // For multi-server support, we need to determine which server to check
    // In current implementation, this just checks the configured server type
    runAsyncConnCheck(getJSON(`/user/github-sync/status`)).catch(err =>
      debugConsole.error(err?.data?.message || err?.message || err),
    )
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleConnCheck()
  }, [handleConnCheck])

  const handleUnlink = useCallback(() => {
    runAsyncUnlink(postJSON('/user/github-sync/unlink'))
      .then(() => setConnState(false))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
      .finally(() => setShowUnlinkModal(false))
  }, [runAsyncUnlink])

  // Get display name based on server type
  const getServerName = () => {
    switch (serverType) {
      case 'gitlab': return t('gitlab')
      case 'gitea': return t('gitea')
      case 'forgejo': return t('forgejo')
      default: return t('github')
    }
  }

  // Get sync description key based on server type
  const getSyncDescriptionKey = () => {
    switch (serverType) {
      case 'gitlab': return 'gitlab_sync_description'
      case 'gitea': return 'gitea_sync_description'
      case 'forgejo': return 'forgejo_sync_description'
      default: return 'github_sync_description'
    }
  }

  // Get unlink warning key based on server type
  const getUnlinkWarningKey = () => {
    switch (serverType) {
      case 'gitlab': return 'unlink_gitlab_warning'
      case 'gitea': return 'unlink_gitea_warning'
      case 'forgejo': return 'unlink_forgejo_warning'
      default: return 'unlink_github_warning'
    }
  }

  if (isCheckingConn) {
    const Logo = ServerLogo()
    return (
      <div className="settings-widget-container">
        <div>
          <Logo />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4>{getServerName()}</h4>
          </div>

          <p className="small">
            <span>{t('loading')}…</span>
          </p>
        </div>
      </div>
    )
  }

  const Logo = ServerLogo()

  return (
    <>
      <div className="settings-widget-container">
        <div>
          <Logo size={40} />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="github-sync">{getServerName()}</h4>
          </div>

          <p className="small">
            {t(getSyncDescriptionKey(), { appName })}
          </p>

          {isErrorConnCheck && (
            <OLNotification
              type="error"
              content={t('git_sync_error')}
            />
          )}

          {isErrorUnlink && (
            <OLNotification
              type="error"
              content={t('generic_something_went_wrong')}
            />
          )}
        </div>

        <div>
          {isConnected ? (
            <OLButton
              variant="danger-ghost"
              onClick={() => setShowUnlinkModal(true)}
              disabled={isUnlinking}
            >
              {isUnlinking ? t('unlinking') : t('unlink')}
            </OLButton>
          ) : isErrorConnCheck ? (
            <OLButton
              variant="secondary"
              onClick={handleConnCheck}
            >
              {t('reconnect')}
            </OLButton>
          ) : (
            <OLButton
              variant="secondary"
              href="/user/github-sync/oauth2"
            >
              {t('link')}
            </OLButton>
          )}
        </div>
      </div>

      <OLModal
        id="git-sync-modal"
        show={showUnlinkModal}
        onHide={() => setShowUnlinkModal(false)}
        backdrop="static"
      >
        <OLModalHeader>
          <OLModalTitle>
            {t('unlink_provider_account_title', {
              provider: getServerName(),
            })}
          </OLModalTitle>
        </OLModalHeader>

        <OLModalBody>
          <p>
            {t(getUnlinkWarningKey(), {
              provider: getServerName(),
            })}
          </p>
        </OLModalBody>

        <OLModalFooter>
          <OLButton
            variant="secondary"
            onClick={() => setShowUnlinkModal(false)}
          >
            {t('cancel')}
          </OLButton>

          <OLButton
            variant="danger-ghost"
            onClick={handleUnlink}
            disabled={isUnlinking}
          >
            {isUnlinking ? t('unlinking') : t('unlink')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}
