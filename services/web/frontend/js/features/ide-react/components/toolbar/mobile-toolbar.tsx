import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import MaterialIcon from '@/shared/components/material-icon'
import FocusTrap from '@/shared/components/focus-trap'
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
 * - The hamburger toggles the rail drawer: it opens the *currently
 *   selected* tab (file-tree / chat / …) and closes it again on the
 *   second tap. Esc and the drawer close button also close it.
 * - "more" opens a full-screen sheet with the remaining actions
 *   (share / history / online users / download) plus the full
 *   <ToolbarMenuBar/> (file / edit / insert / view / format / help) so
 *   every desktop action stays reachable on mobile. The sheet is
 *   focus-trapped and focus returns to the "more" button on close.
 *
 * This component REPLACES the desktop <Toolbar/> when `isMobileLayout`
 * is true (see toolbar.tsx). It owns the "more" sheet open/closed state.
 */
export function MobileToolbar() {
  const { t } = useTranslation()
  const { selectedTab, isOpen, openTab, setIsOpen } = useRailContext()
  const { cobranding, isRestrictedTokenMember } = useEditorContext()
  const { permissionsLevel } = useIdeReactContext()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

  const shouldDisplaySubmitButton =
    (permissionsLevel === 'owner' || permissionsLevel === 'readAndWrite') &&
    SubmitProjectButton

  // Close the sheet and return focus to the "more" trigger (a11y: the
  // sheet is an aria-modal dialog, focus must not be lost when the sheet
  // closes). Used by the close button *and* the Escape handler below.
  const handleSheetClose = () => {
    setMoreOpen(false)
    moreButtonRef.current?.focus()
  }

  // Close the "more" sheet on Escape (mirrors <Drawer/> behavior).
  useEffect(() => {
    if (!moreOpen) return
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleSheetClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [moreOpen])

  // The hamburger toggles the rail drawer (opens the *selected* tab, or
  // closes the drawer). Previously it always opened the file-tree tab,
  // so the drawer could not be closed from the toolbar and selecting the
  // chat tab was lost on the next tap (bug M1).
  const handleToggleRail = () => {
    if (isOpen) {
      setIsOpen(false)
    } else {
      openTab(selectedTab)
    }
  }

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
            onClick={handleToggleRail}
            aria-label={t('sidebar')}
            aria-expanded={isOpen}
            aria-controls="ide-mobile-rail-drawer"
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
            ref={moreButtonRef}
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
        <div
          className="ide-mobile-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t('more_options')}
          data-testid="mobile-toolbar-sheet"
        >
          <FocusTrap active={moreOpen}>
            <div className="ide-mobile-sheet-header">
              <button
                type="button"
                className="ide-mobile-sheet-close"
                onClick={handleSheetClose}
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
                  {/* Keep parity with the desktop toolbar: the history
                    button is hidden for restricted token members (they
                    can still reach history via the rail). */}
                  {!isRestrictedTokenMember && <ShowHistoryButton />}
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
          </FocusTrap>
        </div>
      )}
    </>
  )
}
