import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ShareProjectModalRow from '@/features/share-project-modal/components/share-project-modal-row'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLDropdownMenuItem from '@/shared/components/ol/ol-dropdown-menu-item'
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from '@/shared/components/dropdown/dropdown-menu'
import DropdownListItem from '@/shared/components/dropdown/dropdown-list-item'
import LinkSharing from '@/features/share-project-modal/components/link-sharing'
import { useEditorContext } from '@/shared/context/editor-context'
import { PermissionsLevel } from '@/features/ide-react/types/permissions'
import MemberPrivileges from '@/features/share-project-modal/components/member-privileges'
import RemoveSharingLinksModal from '@/features/share-project-modal/components/remove-sharing-links-modal'
import {
  ProjectAccessType,
  useShareProjectContext,
} from '@/features/share-project-modal/components/share-project-modal'

type ProjectAccessProps = {
  setIsInvitedPeopleScreen: React.Dispatch<React.SetStateAction<boolean>>
  invitedPeopleCount: number
}

export type PendingAccessType = Exclude<ProjectAccessType, 'linkSharing'>

function ProjectAccess({
  setIsInvitedPeopleScreen,
  invitedPeopleCount,
}: ProjectAccessProps) {
  const { t } = useTranslation()
  const [pendingAccess, setPendingAccess] = useState<PendingAccessType | null>(
    null
  )
  // TODO set initial state
  const [privileges, setPrivileges] =
    useState<Exclude<PermissionsLevel, 'owner'>>('readOnly')
  const { isProjectOwner } = useEditorContext()
  // TODO set company name
  const companyName = 'XYZ'

  const {
    monitorRequest,
    setSuccessActionMessage,
    projectAccess,
    setProjectAccess,
  } = useShareProjectContext()

  const handleAccessChange = (newAccess: PendingAccessType) => {
    setPendingAccess(null)

    monitorRequest(
      () =>
        // TODO: replace with real API call
        new Promise(resolve => setTimeout(resolve, 1000))
    ).then(() => {
      setProjectAccess(newAccess)
      setSuccessActionMessage(t('access_updated'))
    })
  }

  const onAccessSelect = (eventKey: ProjectAccessType) => {
    if (projectAccess === 'linkSharing' && eventKey !== 'linkSharing') {
      // Legacy link sharing: show confirmation first
      setPendingAccess(eventKey as PendingAccessType)
    } else {
      // Non-legacy: fire request directly
      handleAccessChange(eventKey as PendingAccessType)
    }
  }

  const onPrivilegesChange = (eventKey: Exclude<PermissionsLevel, 'owner'>) => {
    monitorRequest(
      () =>
        // TODO: replace with real API call
        new Promise(resolve => setTimeout(resolve, 1000))
    ).then(() => {
      setPrivileges(eventKey)
      setSuccessActionMessage(t('access_updated'))
    })
  }

  const getProjectAccessDropdownToggleText = () => {
    switch (projectAccess) {
      case 'linkSharing':
        return t('via_sharing_links_legacy')
      case 'onlyInvitedPeople':
        return t('only_invited_people')
      case 'anyoneInXyzWithTheLink':
        return t('anyone_in_x_with_the_link', { companyName })
      case 'anyoneWithTheLink':
        return t('anyone_with_the_link')
      default:
        return ''
    }
  }

  return (
    <>
      <h3 className="h4 fw-normal mt-3 mb-2 pt-1">{t('project_access')}</h3>
      <ShareProjectModalRow>
        <div className="d-inline-flex align-items-center h5 m-0 gap-2">
          <MaterialIcon type="group" unfilled />
          <div className="px-2 fw-normal">
            {t('x_people_invited', { count: invitedPeopleCount })}
          </div>
        </div>
        <OLButton
          variant="ghost"
          trailingIcon="chevron_right"
          onClick={() => setIsInvitedPeopleScreen(true)}
        >
          {t('manage_access')}
        </OLButton>
      </ShareProjectModalRow>
      {projectAccess && (
        <ShareProjectModalRow>
          <div className="d-inline-flex align-items-center h5 m-0">
            {projectAccess === 'linkSharing' && <MaterialIcon type="link" />}
            {projectAccess === 'onlyInvitedPeople' && (
              <MaterialIcon type="lock" unfilled />
            )}
            {projectAccess === 'anyoneInXyzWithTheLink' && (
              <MaterialIcon type="domain" unfilled />
            )}
            {projectAccess === 'anyoneWithTheLink' && (
              <MaterialIcon type="globe" unfilled />
            )}
            <Dropdown onSelect={onAccessSelect}>
              <DropdownToggle
                variant="ghost"
                className="d-flex align-items-center gap-2 no-default-caret"
              >
                {getProjectAccessDropdownToggleText()}
                <MaterialIcon type="keyboard_arrow_down" />
              </DropdownToggle>
              <DropdownMenu>
                {projectAccess === 'linkSharing' && (
                  <>
                    <DropdownListItem className="d-flex align-items-center">
                      <DropdownItem
                        as="button"
                        eventKey="linkSharing"
                        leadingIcon={<MaterialIcon type="link" />}
                        trailingIcon={
                          projectAccess === 'linkSharing' ? 'check' : undefined
                        }
                        active={projectAccess === 'linkSharing'}
                      >
                        {t('via_sharing_links_legacy')}
                      </DropdownItem>
                    </DropdownListItem>
                    <DropdownDivider />
                  </>
                )}
                <DropdownListItem className="d-flex align-items-center">
                  <DropdownItem
                    as="button"
                    eventKey="onlyInvitedPeople"
                    leadingIcon={<MaterialIcon type="lock" unfilled />}
                    trailingIcon={
                      projectAccess === 'onlyInvitedPeople'
                        ? 'check'
                        : undefined
                    }
                    active={projectAccess === 'onlyInvitedPeople'}
                  >
                    {t('only_invited_people')}
                  </DropdownItem>
                </DropdownListItem>
                <DropdownListItem className="d-flex align-items-center">
                  <DropdownItem
                    as="button"
                    eventKey="anyoneInXyzWithTheLink"
                    leadingIcon={<MaterialIcon type="domain" unfilled />}
                    trailingIcon={
                      projectAccess === 'anyoneInXyzWithTheLink'
                        ? 'check'
                        : undefined
                    }
                    active={projectAccess === 'anyoneInXyzWithTheLink'}
                  >
                    {t('anyone_in_x_with_the_link', { companyName })}
                  </DropdownItem>
                </DropdownListItem>
                <DropdownListItem className="d-flex align-items-center gap-2">
                  <DropdownItem
                    as="button"
                    eventKey="anyoneWithTheLink"
                    leadingIcon={<MaterialIcon type="globe" unfilled />}
                    trailingIcon={
                      projectAccess === 'anyoneWithTheLink'
                        ? 'check'
                        : undefined
                    }
                    active={projectAccess === 'anyoneWithTheLink'}
                  >
                    {t('anyone_with_the_link')}
                  </DropdownItem>
                  <OLTooltip
                    id="tooltip-anyone-with-link"
                    description={t('not_permitted_by_your_organization')}
                    overlayProps={{ placement: 'left' }}
                  >
                    <span style={{ cursor: 'default' }}>
                      <MaterialIcon
                        type="info"
                        unfilled
                        className="align-middle px-2"
                      />
                    </span>
                  </OLTooltip>
                </DropdownListItem>
              </DropdownMenu>
            </Dropdown>
            {pendingAccess && (
              <RemoveSharingLinksModal
                pendingAccess={pendingAccess}
                onCancel={() => setPendingAccess(null)}
                onConfirm={() => handleAccessChange(pendingAccess)}
              />
            )}
          </div>
          {projectAccess !== 'linkSharing' && (
            <Dropdown align="end" onSelect={onPrivilegesChange}>
              <DropdownToggle
                variant="ghost"
                className="d-flex align-items-center gap-2 no-default-caret"
              >
                <MemberPrivileges privileges={privileges} />
                <MaterialIcon type="keyboard_arrow_down" />
              </DropdownToggle>
              <DropdownMenu>
                <OLDropdownMenuItem
                  as="button"
                  eventKey="readAndWrite"
                  leadingIcon={<MaterialIcon type="edit" unfilled />}
                  active={privileges === 'readAndWrite'}
                  trailingIcon={
                    privileges === 'readAndWrite' ? 'check' : undefined
                  }
                >
                  {t('editor')}
                </OLDropdownMenuItem>
                <OLDropdownMenuItem
                  as="button"
                  eventKey="review"
                  leadingIcon={<MaterialIcon type="mode_comment" unfilled />}
                  active={privileges === 'review'}
                  trailingIcon={privileges === 'review' ? 'check' : undefined}
                >
                  {t('reviewer')}
                </OLDropdownMenuItem>
                <OLDropdownMenuItem
                  as="button"
                  eventKey="readOnly"
                  leadingIcon={<MaterialIcon type="visibility" unfilled />}
                  active={privileges === 'readOnly'}
                  trailingIcon={privileges === 'readOnly' ? 'check' : undefined}
                >
                  {t('viewer')}
                </OLDropdownMenuItem>
              </DropdownMenu>
            </Dropdown>
          )}
        </ShareProjectModalRow>
      )}

      {isProjectOwner && <LinkSharing />}
    </>
  )
}

export default ProjectAccess
