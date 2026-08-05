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

  const poll = async () => {
    setWorking(true)
    setError(undefined)
    try {
      await postJSON('/user/webdav/poll')
      await refresh()
    } catch (pollError: any) {
      logWebdavError('poll', pollError)
      setError(pollError?.data?.message || pollError?.message || t('generic_something_went_wrong'))
    } finally {
      setWorking(false)
    }
  }

  const disconnect = async () => {
    setWorking(true)
    setError(undefined)
    try {
      await postJSON('/user/webdav/disconnect')
      setStatus({ connected: false })
    } catch (disconnectError: any) {
      logWebdavError('disconnect', disconnectError)
      setError(disconnectError?.data?.message || disconnectError?.message || t('generic_something_went_wrong'))
    } finally {
      setWorking(false)
    }
  }

  const resolveConflict = async (resolution: 'keep-local' | 'keep-remote') => {
    if (!status?.lastConflict?.path || !status.lastConflict.projectId) return
    setWorking(true)
    setError(undefined)
    try {
      await postJSON(`/project/${status.lastConflict.projectId}/webdav/conflict`, {
        body: { path: status.lastConflict.path, resolution },
      })
      await refresh()
    } catch (conflictError: any) {
      logWebdavError(`resolve conflict (${resolution})`, conflictError)
      setError(conflictError?.data?.message || conflictError?.message || t('generic_something_went_wrong'))
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
          <p className="small">{t('loading')}…</p>
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
        {status?.lastConflict?.path && (
          <>
            <p className="small">
              Conflict path: <code>{status.lastConflict.path}</code>
            </p>
            <div className="d-flex gap-2 mb-2">
              <OLButton
                variant="secondary"
                onClick={() => resolveConflict('keep-remote')}
                disabled={working}
              >
                Keep remote
              </OLButton>
              <OLButton
                variant="secondary"
                onClick={() => resolveConflict('keep-local')}
                disabled={working}
              >
                Keep local
              </OLButton>
            </div>
          </>
        )}
        {status?.connected ? (
          <>
            <p className="small">
              Connected to <strong>{status.baseUrl}</strong>.
              {status.lastSyncAt && (
                <> Last synchronized {new Date(status.lastSyncAt).toLocaleString()}.</>
              )}
            </p>
            <div className="d-flex gap-2">
              <OLButton variant="secondary" onClick={poll} disabled={working}>
                {working ? t('loading') : 'Sync now'}
              </OLButton>
              <OLButton variant="danger-ghost" onClick={disconnect} disabled={working}>
                Disconnect
              </OLButton>
            </div>
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
