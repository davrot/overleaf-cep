import { useTranslation } from 'react-i18next'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import MaterialIcon from '@/shared/components/material-icon'
import classNames from 'classnames'

/**
 * Mobile bottom bar (mobile plan, Phase 0).
 *
 * Sticky bottom bar rendered by <MainLayoutMobile/>:
 *
 * - File tree (rail, file-tree tab)
 * - Chat (rail, chat tab)
 * - View: shows PDF view if the editor is showing, else shows editor
 *
 * It re-uses LayoutContext.view to toggle view, and it does not depend on
 * the rail being mounted (that's an additive component).
 */
export function MobileBottomBar() {
  const { t } = useTranslation()
  const { view, setView } = useLayoutContext()
  const { selectedTab, openTab, isOpen } = useRailContext()

  const handleViewToggle = () => {
    // "View" button on the bottom bar switches between PDF and editor.
    // In flat layout (mobile is always flat), we use view='pdf' or 'editor'.
    setView(view === 'pdf' ? 'editor' : 'pdf')
  }

  const handleFiles = () => {
    openTab('file-tree')
  }

  const handleChat = () => {
    openTab('chat')
  }

  return (
    <nav
      className="ide-mobile-bottom-bar"
      aria-label={t('project_actions')}
      data-testid="mobile-bottom-bar"
    >
      <button
        type="button"
        className={classNames('ide-mobile-bottom-bar-btn', {
          active: isOpen && selectedTab === 'file-tree',
        })}
        aria-pressed={isOpen && selectedTab === 'file-tree'}
        onClick={handleFiles}
        data-testid="mobile-bottom-bar-files"
      >
        <MaterialIcon type="description" />
        <span className="ide-mobile-bottom-bar-label">{t('file_tree')}</span>
      </button>
      <button
        type="button"
        className={classNames('ide-mobile-bottom-bar-btn', {
          active: isOpen && selectedTab === 'chat',
        })}
        aria-pressed={isOpen && selectedTab === 'chat'}
        onClick={handleChat}
        data-testid="mobile-bottom-bar-chat"
      >
        <MaterialIcon type="forum" />
        <span className="ide-mobile-bottom-bar-label">{t('chat')}</span>
      </button>
      <button
        type="button"
        className={classNames('ide-mobile-bottom-bar-btn', {
          active: view === 'pdf',
        })}
        aria-pressed={view === 'pdf'}
        onClick={handleViewToggle}
        data-testid="mobile-bottom-bar-view"
      >
        <MaterialIcon type={view === 'pdf' ? 'description' : 'picture_as_pdf'} />
        <span className="ide-mobile-bottom-bar-label">
          {view === 'pdf' ? t('editor') : t('pdf')}
        </span>
      </button>
    </nav>
  )
}
