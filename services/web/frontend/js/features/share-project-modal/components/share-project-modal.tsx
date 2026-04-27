import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import ShareProjectModalContent from './share-project-modal-content'
import { useProjectContext } from '@/shared/context/project-context'
import { useSplitTestContext } from '@/shared/context/split-test-context'
import { sendMB } from '@/infrastructure/event-tracking'
import { useEditorContext } from '@/shared/context/editor-context'
import customLocalStorage from '@/infrastructure/local-storage'

export type ProjectAccessType =
  | 'linkSharing'
  | 'onlyInvitedPeople'
  | 'anyoneInXyzWithTheLink'
  | 'anyoneWithTheLink'

export type ShareProjectContextValue = {
  monitorRequest: <T extends Promise<unknown>>(request: () => T) => T
  inFlight: boolean
  setInFlight: React.Dispatch<
    React.SetStateAction<ShareProjectContextValue['inFlight']>
  >
  error: string | undefined
  setError: React.Dispatch<
    React.SetStateAction<ShareProjectContextValue['error']>
  >
  successActionMessage: string | undefined
  setSuccessActionMessage: React.Dispatch<
    React.SetStateAction<string | undefined>
  >
  projectAccess: ProjectAccessType | undefined
  setProjectAccess: React.Dispatch<
    React.SetStateAction<ProjectAccessType | undefined>
  >
}

const SHOW_MODAL_COOLDOWN_PERIOD = 24 * 60 * 60 * 1000 // 24 hours

const ShareProjectContext = createContext<ShareProjectContextValue | undefined>(
  undefined
)

export function useShareProjectContext() {
  const context = useContext(ShareProjectContext)

  if (!context) {
    throw new Error(
      'useShareProjectContext is only available inside ShareProjectProvider'
    )
  }

  return context
}

type ShareProjectModalProps = {
  handleHide: () => void
  show: boolean
  handleOpen: () => void
  animation?: boolean
}

const ShareProjectModal = React.memo(function ShareProjectModal({
  handleHide,
  show,
  handleOpen,
  animation = true,
}: ShareProjectModalProps) {
  const [inFlight, setInFlight] =
    useState<ShareProjectContextValue['inFlight']>(false)
  const [error, setError] = useState<ShareProjectContextValue['error']>()
  const [projectAccess, setProjectAccess] = useState<
    ProjectAccessType | undefined
  >()
  const [successActionMessage, setSuccessActionMessage] = useState<
    string | undefined
  >()

  const { project, projectId } = useProjectContext()
  const { isProjectOwner } = useEditorContext()
  const { publicAccessLevel } = project || {}

  // TODO: handle initial state for projectAccess
  useEffect(() => {
    if (!projectAccess) {
      if (publicAccessLevel === 'tokenBased') {
        // consider a legacy link sharing is enabled
        setProjectAccess('linkSharing')
      } else {
        setProjectAccess('onlyInvitedPeople')
      }
    }
  }, [projectAccess, publicAccessLevel])

  const { splitTestVariants } = useSplitTestContext()

  // show the new share modal if project owner
  // is over collaborator limit or has pending editors (once every 24 hours)
  useEffect(() => {
    const hasExceededCollaboratorLimit = () => {
      if (!isProjectOwner || !project || !project.features) {
        return false
      }

      if (project.features.collaborators === -1) {
        return false
      }
      return (
        project.members.filter(member =>
          ['readAndWrite', 'review'].includes(member.privileges)
        ).length > (project.features.collaborators ?? 1) ||
        project.members.some(
          member => member.pendingEditor || member.pendingReviewer
        )
      )
    }

    if (hasExceededCollaboratorLimit()) {
      const localStorageKey = `last-shown-share-modal.${projectId}`
      const lastShownShareModalTime =
        customLocalStorage.getItem(localStorageKey)
      if (
        !lastShownShareModalTime ||
        lastShownShareModalTime + SHOW_MODAL_COOLDOWN_PERIOD < Date.now()
      ) {
        handleOpen()
        customLocalStorage.setItem(localStorageKey, Date.now())
      }
    }
  }, [project, isProjectOwner, handleOpen, projectId])

  // send tracking event when the modal is opened
  useEffect(() => {
    if (show) {
      sendMB('share-modal-opened', {
        splitTestVariant: splitTestVariants['null-test-share-modal'],
        project_id: projectId,
      })
    }
  }, [splitTestVariants, projectId, show])

  // reset error when the modal is opened
  useEffect(() => {
    if (show) {
      setError(undefined)
    }
  }, [show])

  // close the modal if not in flight
  const cancel = useCallback(() => {
    if (!inFlight) {
      handleHide()
      setSuccessActionMessage(undefined)
    }
  }, [handleHide, inFlight])

  // update `error` and `inFlight` while sending a request
  const monitorRequest = useCallback((request: () => any) => {
    setError(undefined)
    setInFlight(true)

    const promise = request()

    promise.catch((error: { data?: Record<string, string> }) => {
      setError(
        error.data?.errorReason ||
          error.data?.error ||
          'generic_something_went_wrong'
      )
    })

    promise.finally(() => {
      setInFlight(false)
    })

    return promise
  }, [])

  if (!project) {
    return null
  }

  return (
    <ShareProjectContext.Provider
      value={{
        monitorRequest,
        inFlight,
        setInFlight,
        error,
        setError,
        successActionMessage,
        setSuccessActionMessage,
        projectAccess,
        setProjectAccess,
      }}
    >
      <ShareProjectModalContent
        animation={animation}
        cancel={cancel}
        error={error}
        inFlight={inFlight}
        show={show}
        projectName={project.name}
      />
    </ShareProjectContext.Provider>
  )
})

export default ShareProjectModal
