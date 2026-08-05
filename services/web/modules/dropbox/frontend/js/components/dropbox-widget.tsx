import { useEffect, useState } from 'react'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'

type DropboxStatus = {
    linked?: boolean
    displayName?: string | null
    lastCursor?: boolean
    lastSyncError?: { message?: string } | string | null
    conflicts?: Array<{
        projectId: string
        projectName: string
        filePath: string
    }>
}

export default function DropboxWidget() {
    const dropboxEnabled = getMeta('ol-ExposedSettings').dropboxEnabled

    const [status, setStatus] = useState<DropboxStatus>()
    const [loading, setLoading] = useState(true)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string>()

    const refresh = async () => {
        setLoading(true)
        try {
            setStatus(await getJSON<DropboxStatus>('/user/dropbox/status'))
        } catch {
            setError('Unable to retrieve Dropbox status.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!dropboxEnabled) return
        refresh()
    }, [dropboxEnabled])

    if (!dropboxEnabled) return null

    const poll = async () => {
        setWorking(true)
        setError(undefined)
        try {
            await postJSON('/user/dropbox/poll')
            await refresh()
        } catch {
            setError('Dropbox synchronization failed.')
        } finally {
            setWorking(false)
        }
    }

    const unlink = async () => {
        setWorking(true)
        setError(undefined)
        try {
            window.location.assign('/dropbox/unlink')
        } catch {
            setError('Unable to unlink Dropbox.')
            setWorking(false)
        }
    }

    const resolveConflict = async (
        conflict: NonNullable<DropboxStatus['conflicts']>[number],
        resolution: 'keep-local' | 'keep-remote'
    ) => {
        setWorking(true)
        setError(undefined)
        try {
            await postJSON(`/project/${conflict.projectId}/dropbox/resolve`, {
                body: { filePath: conflict.filePath, resolution },
            })
            await refresh()
        } catch {
            setError('Unable to resolve Dropbox conflict.')
        } finally {
            setWorking(false)
        }
    }

    if (loading) {
        return (
            <div className="settings-widget-container">
                <div className="d-none d-md-block" aria-hidden="true" />
                <div className="description-container">
                    <h4>Dropbox</h4>
                    <p className="small">Checking Dropbox status...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="settings-widget-container">
            <div className="d-none d-md-block" aria-hidden="true" />
            <div className="description-container">
                <div className="title-row">
                    <h4 id="dropbox">Dropbox</h4>
                </div>
                <p className="small">
                    Synchronize project files with the Apps/Overleaf folder in Dropbox.
                </p>
                {error && <OLNotification type="error" content={error} />}
                {status?.lastSyncError && (
                    <OLNotification
                        type="error"
                        content={typeof status.lastSyncError === 'string'
                            ? status.lastSyncError
                            : status.lastSyncError.message || 'Dropbox synchronization failed.'}
                    />
                )}
                {status?.linked ? (
                    <>
                        <p className="small">Your Dropbox account is linked.</p>
                        <div className="d-flex gap-2">
                            <OLButton variant="secondary" onClick={poll} disabled={working}>
                                {working ? 'Synchronizing...' : 'Sync now'}
                            </OLButton>
                            <OLButton variant="danger-ghost" onClick={unlink} disabled={working}>
                                Unlink
                            </OLButton>
                        </div>
                        {status.conflicts?.map(conflict => (
                            <div key={`${conflict.projectId}:${conflict.filePath}`} className="small mt-2">
                                <strong>{conflict.projectName}</strong>: {conflict.filePath}
                                <div className="d-flex gap-2 mt-1">
                                    <OLButton
                                        variant="secondary"
                                        onClick={() => resolveConflict(conflict, 'keep-remote')}
                                        disabled={working}
                                    >
                                        Keep remote
                                    </OLButton>
                                    <OLButton
                                        variant="secondary"
                                        onClick={() => resolveConflict(conflict, 'keep-local')}
                                        disabled={working}
                                    >
                                        Keep local
                                    </OLButton>
                                </div>
                            </div>
                        ))}
                    </>
                ) : (
                    <OLButton
                        variant="secondary"
                        href="/dropbox/beginAuth"
                        disabled={working}
                    >
                        Link Dropbox
                    </OLButton>
                )}
            </div>
        </div>
    )
}