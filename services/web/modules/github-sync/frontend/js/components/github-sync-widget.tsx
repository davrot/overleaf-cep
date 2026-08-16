import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import GithubLogo from '@/shared/svgs/github-logo'
import GitServersList, { GitServer } from './git-servers-list'
import GitProviderModal from './git-provider-modal'

export const GitHubSyncWidget = function GitHubSyncWidget() {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  const {
    isLoading: isCheckingConn,
    runAsync: runAsyncConnCheck,
    data: status,
  } = useAsync<{ connected?: boolean; providers?: GitServer[] }>()

  const [showAddModal, setShowAddModal] = useState(false)
  const [listKey, setListKey] = useState(0)

  const statusData = status || {}
  const isConnected = !!statusData.connected || (statusData.providers?.length || 0) > 0

  const handleStatusCheck = useCallback(() => {
    runAsyncConnCheck(getJSON('/user/github-sync/status')).catch(err =>
      debugConsole.error(err?.data?.message || err?.message || err),
    )
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleStatusCheck()
  }, [handleStatusCheck])

  const handleAdded = (_server: GitServer) => {
    // Refresh the connection status (provider count) and remount the list
    setListKey(key => key + 1)
    handleStatusCheck()
  }

  return (
    <>
      <div className="settings-widget-container">
        <div>
          <GithubLogo />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="github-sync">{t('git_sync')}</h4>
          </div>

          <p className="small">
            {t('git_sync_widget_description', { appName })}
          </p>

          {isCheckingConn ? <p className="small">{t('loading')}…</p> : null}
          {isConnected ? (
            <p className="small text-success">
              {t('git_providers_linked')}
            </p>
          ) : null}

          <GitServersList key={listKey} />
        </div>

        <div className="settings-widget-actions">
          <OLButton variant="secondary" onClick={() => setShowAddModal(true)}>
            {t('add_new_provider')}
          </OLButton>
        </div>
      </div>

      {showAddModal && (
        <GitProviderModal
          show
          title={t('add_new_provider')}
          onSuccess={handleAdded}
          onHide={() => setShowAddModal(false)}
        />
      )}
    </>
  )
}

export default GitHubSyncWidget
