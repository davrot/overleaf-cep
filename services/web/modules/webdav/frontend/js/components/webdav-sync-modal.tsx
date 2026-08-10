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
import OLButton from '@/shared/components/ol/ol-button'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

type WebdavUserStatus = {
    connected: boolean
    baseUrl?: string
    rootPath?: string
    username?: string
}

// Optional status fields for projects
type ProjectWebdavStatus = WebdavUserStatus & { lastSyncAt?: string | null; mergeStatus?: string }

type ProjectInfo = {
    projectName?: string
}

const getProjectNameEndpoint = (projectId: string) => `/project/${projectId}/webdav/project-name`

function WebdavSyncModal({ show, handleHide, projectId, initialProjectName }: {
    show: boolean
    handleHide: () => void
    projectId: string
    initialProjectName?: string
}) {
    const { t } = useTranslation()
    const [modalStatus, setModalStatus] = useState<'loading' | 'disconnected' | 'notLinkedProject' | 'connected'>('loading')
    const [status, setStatus] = useState<ProjectWebdavStatus>()
    const [projectName, setProjectName] = useState<string>()
    const [working, setWorking] = useState(false)

    // Initialize: fetch user connection and project state on first load
    useEffect(() => {
        if (!show) return

        // Set initial project name from parent component
        if (initialProjectName) {
            setProjectName(initialProjectName)
        }

        // First check if user has WebDAV account linked at /user/webdav/status
        getJSON('/user/webdav/status')
            .then((userData: WebdavUserStatus) => {
                setStatus(userData)
                if (!userData.connected) {
                    setModalStatus('disconnected')
                    return
                }
                // Then fetch project state and name from correct endpoint
                getJSON('/project/' + projectId + '/webdav/state')
                    .then((data: ProjectWebdavStatus) => {
                        setStatus(data)
                        
                        if (!data.connected) {
                            // Project is not linked to WebDAV - set status and use initial project name
                            setModalStatus('notLinkedProject')
                            return
                        }
                        
                        // Project IS linked to WebDAV - try to get the project name from WebDAV endpoint
                        return getJSON(getProjectNameEndpoint(projectId))
                            .then((projName: ProjectInfo | string) => {
                                const projectName = typeof projName === 'string' ? projName : (projName?.projectName || initialProjectName || `project_${projectId}`)
                                setProjectName(projectName)
                                setModalStatus('connected')
                            })
                            .catch(() => {
                                // Fallback name if project-name endpoint fails
                                setProjectName(initialProjectName || `project_${projectId}`)
                                setModalStatus('connected')
                            })
                    })
                    .catch((err: any) => {
                        debugConsole.error(err?.message || err)
                        setStatus({ connected: false } as ProjectWebdavStatus)
                        setModalStatus('notLinkedProject')
                        // Use initial project name if fetch fails (from parent component)
                        if (!initialProjectName) {
                            setProjectName(`project_${projectId}`)
                        }
                    })
            })
            .catch((err: any) => {
                debugConsole.error(err?.message || err)
                setStatus({ connected: false } as WebdavUserStatus)
                setModalStatus('disconnected')
            })
    }, [show])

    // Unlink project from WebDAV
    const handleUnlinkProject = async () => {
        setWorking(true)
        try {
            await fetch(`/project/${projectId}/webdav/state`, { 
                method: 'DELETE',
                headers: {
                    'X-Csrf-Token': getMeta('ol-csrfToken'),
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin'
            })

            setStatus({ connected: false } as ProjectWebdavStatus)
            setModalStatus('notLinkedProject')
        } catch (err: any) {
            debugConsole.error(err?.message || err)
            // If 404, it means the project wasn't linked anyway
            if (err?.response?.status !== 404) {
                alert(t('failed_to_unlink_webdav', { fallback: 'Failed to unlink project from WebDAV: Unknown error' }))
            }
            setStatus({ connected: false } as ProjectWebdavStatus)
            setModalStatus('notLinkedProject')
        } finally {
            setWorking(false)
        }
    }

    // Link project to WebDAV
    const handleLinkProject = async () => {
        setWorking(true)
        try {
            // Get user's current WebDAV status (baseUrl, rootPath)
            const userData: WebdavUserStatus | null = await getJSON('/user/webdav/status')
            if (!userData?.connected) {
                throw new Error('WebDAV credentials not found. Please connect your account first.')
            }

            // Create project sync state with user's WebDAV configuration
            await postJSON(`/project/${projectId}/webdav/link`, {
                body: {
                    baseUrl: userData.baseUrl || '',
                    rootPath: userData.rootPath || '',
                    username: userData.username || ''
                }
            })

            // Refresh status after linking
            const updatedStatus = await getJSON('/project/' + projectId + '/webdav/state')
            setStatus(updatedStatus)
            setModalStatus('connected')
        } catch (err: any) {
            debugConsole.error(err?.message || err)
            alert(t('failed_to_link_webdav', { fallback: 'Failed to link project to WebDAV: Unknown error' }))
        } finally {
            setWorking(false)
        }
    }

    const handlePoll = () => {
        setWorking(true)
        postJSON('/project/' + projectId + '/webdav/pull')
            .then(() => {
                // Refresh status after pull
                getJSON('/project/' + projectId + '/webdav/state').then((data) => {
                    setStatus(data)
                    alert(t('webdav_pull_success', { fallback: 'Successfully imported from WebDAV' }))
                })
            })
            .catch((err: any) => {
                debugConsole.error(err?.message || err)
                alert(t('webdav_pull_failed', { fallback: 'Failed to import from WebDAV: ' }) + (err?.data?.message || err?.message || t('generic_something_went_wrong')))
            })
            .finally(() => setWorking(false))
    }

    const handlePush = () => {
        setWorking(true)
        postJSON('/project/' + projectId + '/webdav/push')
            .then(() => {
                // Refresh status after push
                getJSON('/project/' + projectId + '/webdav/state').then((data) => {
                    setStatus(data)
                    alert(t('webdav_push_success', { fallback: 'Successfully exported to WebDAV' }))
                })
            })
            .catch((err: any) => {
                debugConsole.error(err?.message || err)
                alert(t('webdav_push_failed', { fallback: 'Failed to export to WebDAV: ' }) + (err?.data?.message || err?.message || t('generic_something_went_wrong')))
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
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
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
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
                </OLModalHeader>
                <OLModalBody>
                    <p className="small">
                        {t('sync_with_a_webdav_server')}{' '}
                        <a href="/user/settings" target="_blank" rel="noreferrer">
                            {t('link_your_account')}
                        </a>
                    </p>
                </OLModalBody>
            </OLModal>
        )
    }

    // Project not linked to WebDAV but user account is connected
    const remoteFolderPath = status?.rootPath && projectName ? status.rootPath + '/' + projectName : null
    if (modalStatus === 'notLinkedProject') {
        return (
            <OLModal show={show} onHide={handleClose}>
                <OLModalHeader>
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
                </OLModalHeader>
                <OLModalBody>
                    {status?.baseUrl && (
                        <p className="small">
                            <strong>{t('connected_to')}:</strong> {status.baseUrl}
                        </p>
                    )}
                    {remoteFolderPath && (
                        <p className="small">
                            <strong>{t('webdav_root_path_label')}:</strong> {remoteFolderPath}
                        </p>
                    )}
                    <p className="small mt-2 mb-3">
                        {t('this_project_is_not_linked_to_webdav')}
                    </p>
                    {projectName && (
                        <div className="mb-3">
                            <strong>{t('project_name_label')} </strong> {projectName}
                        </div>
                    )}
                    <OLButton variant="secondary" onClick={() => handleLinkProject()} disabled={working}>
                        {working ? t('loading') : t('webdav_link_project_button')}
                    </OLButton>
                </OLModalBody>
            </OLModal>
        )
    }

    // Connected state (both user and project linked) - show sync options
    const connectedStatus = status as ProjectWebdavStatus & { lastSyncAt?: string | null }
    // remoteFolderPath is already declared earlier, we still need it here

    if (modalStatus === 'connected') {
        return (
            <OLModal show={show} onHide={handleClose}>
                <OLModalHeader>
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
                </OLModalHeader>

                <OLModalBody>
                    {status?.baseUrl && status.connected && (
                        <>
                            <p className="small">
                                <strong>{t('connected_to')}:</strong> {status.baseUrl}
                            </p>

                            {remoteFolderPath && (
                                <p className="small">
                                    <strong>{t('webdav_root_path_label')}:</strong> {remoteFolderPath}
                                </p>
                            )}

                            {connectedStatus.lastSyncAt && (
                                <p className="small">
                                    <strong>{t('last_synced')}:</strong>{' '}
                                    {new Date(connectedStatus.lastSyncAt).toLocaleString()}
                                </p>
                            )}

                            <div className="d-flex gap-2 mt-3 mb-3">
                                <OLButton variant="secondary" onClick={handlePoll} disabled={working}>
                                    {working ? t('loading') : t('webdav_import_from_webdav')}
                                </OLButton>
                                <OLButton variant="primary" onClick={handlePush} disabled={working}>
                                    {working ? t('loading') : t('webdav_export_to_webdav')}
                                </OLButton>
                            </div>

                            {/* Unlink button */}
                            <OLButton
                                variant="danger-ghost"
                                onClick={handleUnlinkProject}
                                disabled={working}
                            >
                                {t('webdav_unlink_button')}
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

export default WebdavSyncModal