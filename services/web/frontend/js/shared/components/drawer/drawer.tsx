import { useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import MaterialIcon from '@/shared/components/material-icon'
import FocusTrap from '@/shared/components/focus-trap'

type DrawerProps = {
  isOpen: boolean
  /** Accessible name of the drawer (rendered as title and aria-label). */
  title: string
  onClose: () => void
  children: React.ReactNode
  /** id used for cypress/component tests */
  id?: string
}

/**
 * Full-screen drawer (mobile plan, Phase 2).
 *
 * On mobile, the rail is rendered as a full-screen overlay drawer (instead of
 * a persistent side column), and modals are rendered as full-height drawers.
 *
 * - `role="dialog"`, `aria-modal="true"`, `aria-label` for the drawer title
 * - Focus-trapped while open (re-uses the shared <FocusTrap/>)
 * - Always mounted; hidden via CSS (`display: none`) while closed so that the
 *   rail's tab content (file-tree scroll position, review comment drafts,
 *   module rail tab state) survives open/close (bug M3 — desktop keeps tab
 *   content mounted when the panel collapses; mobile previously unmounted
 *   it, losing scroll/focus/drafts)
 * - The closed drawer is marked `inert` so it cannot receive focus/clicks
 *   while hidden (React 18's types do not include the `inert` prop, so it is
 *   set imperatively via a ref)
 * - Closes on Esc and on the explicit close button (a click-outside backdrop
 *   would be intercepted by <FocusTrap/>, so we don't rely on it)
 *
 * See `frontend/stylesheets/mobile/layout.scss` for the z-index/scoping.
 */
export function Drawer({ isOpen, title, onClose, children, id }: DrawerProps) {
  const { t } = useTranslation()

  const drawerRef = useRef<HTMLDivElement>(null)

  // `inert` is not in the React 18 prop types, so it is applied imperatively.
  useEffect(() => {
    const el = drawerRef.current
    if (!el) return
    el.inert = !isOpen
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  return (
    <div
      ref={drawerRef}
      className={classNames('drawer', {
        'drawer-hidden': !isOpen,
      })}
      role="dialog"
      aria-modal={isOpen}
      aria-label={title}
    >
      <div className="drawer-container" id={id}>
        <FocusTrap active={isOpen}>
          <div className="drawer-inner">
            <header className="drawer-header">
              <button
                type="button"
                className="drawer-close"
                onClick={handleClose}
                aria-label={t('close')}
                data-testid="drawer-close"
              >
                <MaterialIcon type="close" />
              </button>
              <h2 className="drawer-title">{title}</h2>
            </header>
            <div className="drawer-content">{children}</div>
          </div>
        </FocusTrap>
      </div>
    </div>
  )
}

export default Drawer
