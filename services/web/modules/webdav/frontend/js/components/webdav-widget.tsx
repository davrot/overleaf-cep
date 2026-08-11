import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

type WebdavStatus = {
  connected: boolean
  baseUrl?: string
  rootPath?: string
  lastSyncAt?: string | null
  lastSyncError?: string | null
  lastConflict?: {
    projectId: string
    path?: string | null
    detectedAt: string
  } | null
}

type WebdavForm = {
  baseUrl: string
  username: string
  password: string
  rootPath: string
}

function logWebdavError(operation: string, error: any) {
  const serverMessage =
    typeof error?.data?.message === 'string'
      ? error.data.message
      : error?.data?.message?.text
  debugConsole.error(`[WebDAV] ${operation} failed`, {
    message: serverMessage || error?.message,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    method: error?.options?.method,
    url: error?.url,
  })
}

function formatLastSync(lastSyncAt: string) {
  const elapsedSeconds = Math.round(
    (Date.now() - new Date(lastSyncAt).getTime()) / 1000
  )
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ] as const
  const [unit, unitSeconds] = units.find(([, seconds]) => Math.abs(elapsedSeconds) >= seconds) || units.at(-1)
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    -Math.round(elapsedSeconds / unitSeconds),
    unit
  )
}

export default function WebdavWidget() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<WebdavStatus>()
  const [form, setForm] = useState<WebdavForm>({
    baseUrl: '',
    username: '',
    password: '',
    rootPath: '/Overleaf',
  })
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = async () => {
    setLoading(true)
    try {
      const nextStatus = await getJSON<WebdavStatus>('/user/webdav/status')
      setStatus(nextStatus)
      if (nextStatus.lastSyncError) {
        debugConsole.error('[WebDAV] server reported a sync error', {
          message: nextStatus.lastSyncError,
          conflict: nextStatus.lastConflict || undefined,
          lastSyncAt: nextStatus.lastSyncAt || undefined,
        })
      }
      if (nextStatus.connected) {
        setForm(current => ({
          ...current,
          baseUrl: nextStatus.baseUrl || current.baseUrl,
          rootPath: nextStatus.rootPath || current.rootPath,
        }))
      }
    } catch (refreshError) {
      logWebdavError('status refresh', refreshError)
      setError(t('generic_something_went_wrong'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const updateField = (field: keyof WebdavForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }))
  }

  // Poll is no longer available in user settings - sync via project pages
  // Note: resolve conflict is handled directly from the webdav-sync-modal

  const disconnect = async () => {
    setWorking(true)
    setError(undefined)
    try {
      await postJSON('/user/webdav/disconnect')
      setStatus({ connected: false })
      setForm(current => ({
        ...current,
        baseUrl: '',
        username: '',
        password: '',
        rootPath: '/Overleaf',
      }))
    } catch (disconnectError: any) {
      logWebdavError('disconnect', disconnectError)
      setError(disconnectError?.data?.message || disconnectError?.message || t('generic_something_went_wrong'))
    } finally {
      setWorking(false)
    }
  }

  const connect = async () => {
    setWorking(true)
    setError(undefined)
    try {
      await postJSON('/user/webdav/connect', { body: form })
      await refresh()
    } catch (connectError: any) {
      logWebdavError('connect', connectError)
      setError(connectError?.data?.message || connectError?.message || t('generic_something_went_wrong'))
    } finally {
      setWorking(false)
    }
  }

  if (loading) {
    return (
      <div className="settings-widget-container">
        <div className="d-none d-md-block" aria-hidden="true" />
        <div className="description-container">
          <h4>WebDAV</h4>
          <p className="small">{t('loading')}...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-widget-container">
      <div className="d-none d-md-block" aria-hidden="true" />
      <div className="description-container">
        <div className="title-row">
          <h4 id="webdav">WebDAV</h4>
        </div>
        <p className="small">
          Connect a WebDAV or Nextcloud account to synchronize project files.
        </p>
        {error && <OLNotification type="error" content={error} />}
        {status?.lastSyncError && (
          <OLNotification type="error" content={status.lastSyncError} />
        )}
        {status?.connected ? (
          <>
            <p className="small">
              Connected to <strong>{status.baseUrl}</strong>.
              {status.lastSyncAt && (
                <> Last synchronized {formatLastSync(status.lastSyncAt)} ({new Date(status.lastSyncAt).toLocaleString()}).</>
              )}
            </p>
            {/* Sync buttons moved to project pages */}
            <p className="small text-muted mb-2">
              To sync files, open a project and click the WebDAV icon in the integrations panel.
            </p>
            <OLButton
              variant="danger-ghost"
              onClick={disconnect}
              disabled={working}
            >
              Disconnect
            </OLButton>
          </>
        ) : (
          <>
            <label className="form-label" htmlFor="webdav-base-url">Server URL</label>
            <input
              id="webdav-base-url"
              className="form-control mb-2"
              value={form.baseUrl}
              onChange={event => updateField('baseUrl', event.target.value)}
              placeholder="https://cloud.example/remote.php/dav/files/user"
              type="url"
              required
            />
            <label className="form-label" htmlFor="webdav-username">Username</label>
            <input
              id="webdav-username"
              className="form-control mb-2"
              value={form.username}
              onChange={event => updateField('username', event.target.value)}
              autoComplete="username"
              required
            />
            <label className="form-label" htmlFor="webdav-password">Password or app password</label>
            <input
              id="webdav-password"
              className="form-control mb-2"
              value={form.password}
              onChange={event => updateField('password', event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
            <label className="form-label" htmlFor="webdav-root-path">Remote root folder</label>
            <input
              id="webdav-root-path"
              className="form-control mb-2"
              value={form.rootPath}
              onChange={event => updateField('rootPath', event.target.value)}
              required
            />
            <OLButton
              variant="secondary"
              onClick={connect}
              disabled={working || !form.baseUrl || !form.username || !form.password}
            >
              {working ? t('loading') : 'Connect'}
            </OLButton>
          </>
        )}
      </div>
    </div>
  )
}