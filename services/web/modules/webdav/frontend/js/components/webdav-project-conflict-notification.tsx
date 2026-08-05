import { useCallback, useEffect, useState } from 'react'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { useProjectContext } from '@/shared/context/project-context'

type WebdavStatus = {
    lastConflict?: {
        projectId: string
        projectName?: string
        path?: string | null
    } | null
}

export default function WebdavProjectConflictNotification() {
    const { projectId, name } = useProjectContext()
    const [conflict, setConflict] = useState<WebdavStatus['lastConflict']>()
    const [working, setWorking] = useState(false)

    const refresh = useCallback(async () => {
        const status = await getJSON<WebdavStatus>('/user/webdav/status')
        const nextConflict = status.lastConflict
        setConflict(
            nextConflict?.projectId === projectId ? nextConflict : null
        )
    }, [projectId])

    useEffect(() => {
        refresh().catch(() => setConflict(null))
    }, [refresh])

    if (!conflict) return null

    const resolve = async (resolution: 'keep-local' | 'keep-remote') => {
        if (!conflict.path) return
        setWorking(true)
        try {
            await postJSON(`/project/${projectId}/webdav/conflict`, {
                body: { path: conflict.path, resolution },
            })
            await refresh()
        } finally {
            setWorking(false)
        }
    }

    return (
        <OLNotification
            type="warning"
            title={`WebDAV conflict: ${conflict.projectName || name}`}
            content={
                <>A remote change conflicts with the local version of <code>{conflict.path}</code>.</>
            }
            action={
                <>
                    <OLButton
                        variant="secondary"
                        disabled={working}
                        onClick={() => resolve('keep-remote')}
                    >
                        Keep remote
                    </OLButton>
                    <OLButton
                        variant="secondary"
                        disabled={working}
                        onClick={() => resolve('keep-local')}
                    >
                        Keep local
                    </OLButton>
                </>
            }
        />
    )
}