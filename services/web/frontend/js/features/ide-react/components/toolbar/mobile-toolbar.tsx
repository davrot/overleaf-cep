import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import MaterialIcon from '@/shared/components/material-icon'
import ShareProjectButton from './share-project-button'
import ShowHistoryButton from './show-history-button'
import { OnlineUsers } from './online-users'
import { DownloadProjectZip } from './download-project'
import { ToolbarMenuBar } from './menu-bar'
import { ToolbarProjectTitle } from './project-title'
import { useEditorContext } from '@/shared/context/editor-context'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import importOverleafModules from '../../../../../macros/import-overleaf-module.macro'

const [publishModalModules] = importOverleafModules('publishModal')
const SubmitProjectButton = publishModalModules?.import.NewPublishToolbarButton

/**
 * The mobile toolbar (mobile plan, Phase 1).
 *
 * Top row (always visible on mobile):
 *   [ hamburger ]  [ project name (truncated) ]  [ more ]
 *
 * "more" opens a bottom sheet with the remaining actions
 * (share / history / online users / download) plus the full
 * <ToolbarMenuBar/> (file / edit / insert / view / format / help) so every
 * desktop action stays reachable on mobile.
 *
 * This component REPLACES the desktop <Toolbar/> when `isMobileLayout` is
 * true (see toolbar.tsx). It owns the "more" sheet open/closed state.
 */
export function MobileToolbar() {
  const { t } = useTranslation()
  const { openTab } = useRailContext()
  const { cobranding } = useEditorContext()
  const { permissionsLevel } = useIdeReactContext()
  const [moreOpen, setMoreOpen] = useState(false)

  const shouldDisplaySubmitButton =
    (permissionsLevel === 'owner' || permissionsLevel === 'readAndWrite') &&
    SubmitProjectButton

  // Close the "more" bottom sheet on Escape (mirrors <Drawer/> behavior).
  useEffect(() => {
    if (!moreOpen) return
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [moreOpen])

  return (
    <>
      <nav
        className="ide-redesign-toolbar ide-redesign-toolbar-mobile"
        aria-label={t('project_actions')}
        data-testid="mobile-toolbar"
      >
        <div className="ide-redesign-toolbar-menu">
          <button
            type="button"
            className="ide-redesign-toolbar-button ide-mobile-toolbar-hamburger"
            onClick={() => openTab('file-tree')}
            aria-label={t('sidebar')}
            data-testid="mobile-toolbar-hamburger"
          >
            <MaterialIcon type="menu" />
          </button>
        </div>
        <div className="ide-redesign-toolbar-project-mobile">
          <ToolbarProjectTitle />
        </div>
        <div className="ide-redesign-toolbar-actions">
          <button
            type="button"
            className="ide-redesign-toolbar-button"
            onClick={() => setMoreOpen(true)}
            aria-label={t('more_options')}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            data-testid="mobile-toolbar-more"
          >
            <MaterialIcon type="more_vert" />
          </button>
        </div>
      </nav>

      {moreOpen && (
        <>
          <button
            type="button"
            className="ide-mobile-sheet-backdrop"
            aria-label={t('close')}
            onClick={() => setMoreOpen(false)}
            data-testid="mobile-sheet-backdrop"
          />
          <div
            className="ide-mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t('more_options')}
            data-testid="mobile-toolbar-sheet"
          >
            <div className="ide-mobile-sheet-header">
              <button
                type="button"
                className="ide-mobile-sheet-close"
                onClick={() => setMoreOpen(false)}
                data-testid="mobile-sheet-close"
              >
                <MaterialIcon type="close" />
                <span className="visually-hidden">{t('close')}</span>
              </button>
            </div>
            <div className="ide-mobile-sheet-content">
              <div className="ide-mobile-sheet-actions">
                <OnlineUsers />
                <div className="ide-mobile-sheet-action-row">
                  <ShareProjectButton />
                  <ShowHistoryButton />
                  {shouldDisplaySubmitButton && cobranding && (
                    <SubmitProjectButton cobranding={cobranding} />
                  )}
                  <DownloadProjectZip />
                </div>
              </div>
              <div className="ide-mobile-sheet-menus">
                <ToolbarMenuBar />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
