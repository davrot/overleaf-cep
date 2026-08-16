import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { getJSON, postJSON, deleteJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'

export type GitServer = {
  id: string
  provider: string
  url: string
  username: string
}

type GitServersListProps = {
  showTest?: boolean
  showDelete?: boolean
  showLink?: boolean
  onLink?: (server: GitServer) => void
}

/**
 * Table of a user's registered git providers (provider, url, username)
 * with optional Test / Delete / Link actions per row.
 */
const GitServersList = ({
  showTest = true,
  showDelete = true,
  showLink = false,
  onLink,
}: GitServersListProps) => {
  const { t } = useTranslation()
  const [list, setList] = useState<GitServer[]>([])
  const [loading, setLoading] = useState(true)
  const [testResults, setTestResults] = useState<
    Record<string, { ok?: boolean; message?: string; testing?: boolean }>
  >({})

  const { isLoading: isDeleting, runAsync: runAsyncDelete } = useAsync<void>()

  const fetchServers = useCallback(() => {
    setLoading(true)
    return getJSON<GitServer[]>('/user/git-servers')
      .then(data => {
        setList(Array.isArray(data) ? data : [])
      })
      .catch(err => {
        setList([])
        debugConsole.error(err?.data?.message || err?.message || err)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

  const handleTest = (server: GitServer) => {
    setTestResults(prev => ({ ...prev, [server.id]: { testing: true } }))
    postJSON<{ ok?: boolean; message?: string }>(
      '/user/git-servers/test',
      { body: { provider: server.provider, url: server.url } }
    )
      .then(res => {
        setTestResults(prev => ({
          ...prev,
          [server.id]: {
            ok: !!res?.ok,
            message: res?.message || (res?.ok ? 'ok' : 'failed'),
          },
        }))
      })
      .catch(err => {
        setTestResults(prev => ({
          ...prev,
          [server.id]: { ok: false, message: err?.data?.message || 'failed' },
        }))
      })
  }

  const handleDelete = (server: GitServer) => {
    if (
      !window.confirm(
        t('confirm_delete_provider', { provider: server.provider, url: server.url })
      )
    ) {
      return
    }
    runAsyncDelete(deleteJSON(`/user/git-servers/${encodeURIComponent(server.id)}`))
      .then(() => {
        setList(prev => prev.filter(s => s.id !== server.id))
      })
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
      })
  }

  if (loading) {
    return <p className="small">{t('loading')}…</p>
  }

  if (list.length === 0) {
    return <p className="small text-muted">{t('no_git_providers_configured')}</p>
  }

  return (
    <table className="table table-sm">
      <caption className="visually-hidden">{t('git_sync_servers')}</caption>
      <thead className="visually-hidden">
        <tr>
          <th>{t('provider')}</th>
          <th>{t('server_url')}</th>
          <th>{t('username')}</th>
          <th>{t('actions')}</th>
        </tr>
      </thead>
      <tbody>
        {list.map(server => {
          const testResult = testResults[server.id]
          const hasActions = showTest || showDelete || showLink
          return (
            <tr key={server.id}>
              <td className="small">{t(server.provider)}</td>
              <td className="small breakable-url">{server.url}</td>
              <td className="small">{server.username || '–'}</td>
              {hasActions && (
                <td className="small text-right">
                  {showLink && (
                    <OLButton size="sm" variant="primary" onClick={() => onLink?.(server)}>
                      {t('link')}
                    </OLButton>
                  )}
                  {showTest && (
                    <>
                      {' '}
                      <OLButton
                        size="sm"
                        variant="secondary"
                        isLoading={!!testResult?.testing}
                        onClick={() => handleTest(server)}
                      >
                        {t('git_test_connection')}
                      </OLButton>
                      {' '}
                      {testResult && !testResult.testing && (
                        <span
                          className={`small ${testResult.ok ? 'text-success' : 'text-danger'}`}
                          title={testResult.message}
                        >
                          {testResult.ok ? '✓' : '✗'}
                        </span>
                      )}
                    </>
                  )}
                  {showDelete && (
                    <>
                      {' '}
                      <OLButton
                        size="sm"
                        variant="danger-ghost"
                        isLoading={isDeleting}
                        onClick={() => handleDelete(server)}
                      >
                        {t('delete')}
                      </OLButton>
                    </>
                  )}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default GitServersList
