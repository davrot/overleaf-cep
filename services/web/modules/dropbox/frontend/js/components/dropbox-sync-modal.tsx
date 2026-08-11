import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

type DropboxUserStatus = {
  connected: boolean
  path?: string
}

// Optional status fields for projects
type ProjectDropboxStatus = DropboxUserStatus & { lastSyncAt?: string | null; mergeStatus?: string }

type ProjectInfo = {
  projectName?: string
}

function DropboxSyncModal({
  show,
  handleHide,
  projectId,
  initialProjectName,
}: {
  show: boolean
  handleHide: () => void
  projectId: string
  initialProjectName?: string
}) {
  const { t } = useTranslation()
  const [modalStatus, setModalStatus] =
    useState<'loading' | 'disconnected' | 'notLinkedProject' | 'connected'>('loading')
  const [status, setStatus] = useState<ProjectDropboxStatus>()
  const [projectName, setProjectName] = useState<string>()
  const [working, setWorking] = useState(false)

  // Initialize: fetch user connection and project state on first load
  useEffect(() => {
    if (!show) return

    // Set initial project name from parent component
    if (initialProjectName) {
      setProjectName(initialProjectName)
    }

    // First check if user has Dropbox account linked at /user/dropbox/status
    getJSON('/user/dropbox/status')
      .then((userData: DropboxUserStatus) => {
        setStatus(userData)
        if (!userData.connected) {
          setModalStatus('disconnected')
          return
        }
        // Then fetch project state and name from correct endpoint
        getJSON('/project/' + projectId + '/dropbox/state')
          .then((data: ProjectDropboxStatus) => {
            setStatus(data)

            if (!data.connected) {
              // Project is not linked to Dropbox - set status and use initial project name
              setModalStatus('notLinkedProject')
              return
            }

            // Project IS linked to Dropbox
            setProjectName(initialProjectName || `project_${projectId}`)
            setModalStatus('connected')
          })
          .catch((err: any) => {
            debugConsole.error(err?.message || err)
            setStatus({ connected: false } as ProjectDropboxStatus)
            setModalStatus('notLinkedProject')
            if (!initialProjectName) {
              setProjectName(`project_${projectId}`)
            }
          })
      })
      .catch((err: any) => {
        debugConsole.error(err?.message || err)
        setStatus({ connected: false } as DropboxUserStatus)
        setModalStatus('disconnected')
      })
  }, [show])

  // Unlink project from Dropbox
  const handleUnlinkProject = async () => {
    setWorking(true)
    try {
      await fetch(`/project/${projectId}/dropbox/state`, {
        method: 'DELETE',
        headers: {
          'X-Csrf-Token': getMeta('ol-csrfToken'),
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
      })

      setStatus({ connected: false } as ProjectDropboxStatus)
      setModalStatus('notLinkedProject')
    } catch (err: any) {
      debugConsole.error(err?.message || err)
      if (err?.response?.status !== 404) {
        alert(t('failed_to_unlink_dropbox', { fallback: 'Failed to unlink project from Dropbox: Unknown error' }))
      }
      setStatus({ connected: false } as ProjectDropboxStatus)
      setModalStatus('notLinkedProject')
    } finally {
      setWorking(false)
    }
  }

  // Link project to Dropbox
  const handleLinkProject = async () => {
    setWorking(true)
    try {
      // Get user's current Dropbox status (path)
      const userData: DropboxUserStatus | null = await getJSON('/user/dropbox/status')
      if (!userData?.connected) {
        throw new Error('Dropbox credentials not found. Please connect your account first.')
      }

      // Create project sync state with user's Dropbox configuration
      await postJSON(`/project/${projectId}/dropbox/link`, {
        body: {
          path: userData.path || '/Overleaf/Dropbox',
        },
      })

      // Refresh status after linking
      const updatedStatus = await getJSON('/project/' + projectId + '/dropbox/state')
      setStatus(updatedStatus)
      setModalStatus('connected')
    } catch (err: any) {
      debugConsole.error(err?.message || err)
      alert(t('failed_to_link_dropbox', { fallback: 'Failed to link project to Dropbox: Unknown error' }))
    } finally {
      setWorking(false)
    }
  }

  const handlePull = () => {
    setWorking(true)
    postJSON('/project/' + projectId + '/dropbox/pull')
      .then(() => {
        // Refresh status after pull
        getJSON('/project/' + projectId + '/dropbox/state').then((data) => {
          setStatus(data as ProjectDropboxStatus)
          alert(t('dropbox_pull_success', { fallback: 'Successfully imported from Dropbox' }))
        })
      })
      .catch((err: any) => {
        debugConsole.error(err?.message || err)
        alert(
          t('dropbox_pull_failed', {
            fallback: 'Failed to import from Dropbox: ',
          }) + (err?.data?.message || err?.message || t('generic_something_went_wrong'))
        )
      })
      .finally(() => setWorking(false))
  }

  const handlePush = () => {
    setWorking(true)
    postJSON('/project/' + projectId + '/dropbox/push')
      .then(() => {
        // Refresh status after push
        getJSON('/project/' + projectId + '/dropbox/state').then((data) => {
          setStatus(data as ProjectDropboxStatus)
          alert(t('dropbox_push_success', { fallback: 'Successfully exported to Dropbox' }))
        })
      })
      .catch((err: any) => {
        debugConsole.error(err?.message || err)
        alert(
          t('dropbox_push_failed', {
            fallback: 'Failed to export to Dropbox: ',
          }) + (err?.data?.message || err?.message || t('generic_something_went_wrong'))
        )
      })
      .finally(() => setWorking(false))
  }

  const handleClose = () => {
    handleHide()
    setModalStatus('loading')
    setStatus(undefined)
  }

  if (modalStatus === 'loading') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OL-modalTitle>{t('dropbox')}</OL-modalTitle>
        </OLModalHeader>
        <OLModalBody>
          <p>{t('loading')}...</p>
        </OLModalBody>
      </OLModal>
    )
  }

  // If user account not linked, show "link your account" message
  if (modalStatus === 'disconnected') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OL-modalTitle>{t('dropbox')}</OL-modalTitle>
        </OLModalHeader>
        <OLModalBody>
          <p className="small">
            {t('sync_with_dropbox_server')}{' '}
            <a href="/user/settings" target="_blank" rel="noreferrer">
              {t('link_your_account')}
            </a>
          </p>
        </OLModalBody>
      </OLModal>
    )
  }

  // Project not linked to Dropbox but user account is connected
  if (modalStatus === 'notLinkedProject') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OL-modalTitle>{t('dropbox')}</OL-modalTitle>
        </OLModalHeader>
        <OLModalBody>
          {status?.path && (
            <p className="small">
              <strong>{t('connected_to')}:</strong> Dropbox
            </p>
          )}
          <p className="small mt-2 mb-3">{t('this_project_is_not_linked_to_dropbox')}</p>
          {projectName && (
            <div className="mb-3">
              <strong>{t('project_name_label')} </strong> {projectName}
            </div>
          )}
          <OLButton
            variant="secondary"
            onClick={() => handleLinkProject()}
            disabled={working}
          >
            {working ? t('loading') : t('dropbox_link_project_button')}
          </OLButton>
        </OLModalBody>
      </OLModal>
    )
  }

  // Connected state (both user and project linked) - show sync options
  const connectedStatus = status as ProjectDropboxStatus & {
    lastSyncAt?: string | null
  }

  if (modalStatus === 'connected') {
    return (
      <OLModal show={show} onHide={handleClose}>
        <OLModalHeader>
          <OL-modalTitle>{t('dropbox')}</OL-modalTitle>
        </OLModalHeader>

        <OLModalBody>
          {status?.path && status.connected && (
            <>
              <p className="small">
                <strong>{t('connected_to')}:</strong> Dropbox
              </p>

              <p className="small">
                <strong>{t('dropbox_path_label')}:</strong> {status.path}
              </p>

              {connectedStatus.lastSyncAt && (
                <p className="small">
                  <strong>{t('last_synced')}:</strong> {new Date(connectedStatus.lastSyncAt).toLocaleString()}
                </p>
              )}

              <div className="d-flex gap-2 mt-3 mb-3">
                <OLButton variant="secondary" onClick={handlePull} disabled={working}>
                  {working ? t('loading') : t('dropbox_import_from_dropbox')}
                </OLButton>
                <OLButton variant="primary" onClick={handlePush} disabled={working}>
                  {working ? t('loading') : t('dropbox_export_to_dropbox')}
                </OLButton>
              </div>

              {/* Unlink button */}
              <OLButton
                variant="danger-ghost"
                onClick={handleUnlinkProject}
                disabled={working}
              >
                {t('dropbox_unlink_button')}
              </OLButton>
            </>
          )}
        </OLModalBody>

        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleClose}>
            {t('close')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    )
  }

  // Fallback for any other state
  return null
}

export default DropboxSyncModal
