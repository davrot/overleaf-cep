import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import MaterialIcon from '@/shared/components/material-icon'
import FocusTrap from '@/shared/components/focus-trap'

type DrawerProps = {
  isOpen: boolean
  title?: string
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
 * - Closes on Esc and on the explicit close button (a click-outside backdrop
 *   would be intercepted by <FocusTrap/>, so we don't rely on it)
 *
 * See `frontend/stylesheets/mobile/layout.scss` for the z-index/scoping.
 */
export function Drawer({ isOpen, title, onClose, children, id }: DrawerProps) {
  const { t } = useTranslation()

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

  if (!isOpen) return null

  return (
    <div className={classNames('drawer')} role="dialog" aria-modal="true" aria-label={title}>
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
              {title ? (
                <h2 className="drawer-title">{title}</h2>
              ) : (
                <span className="visually-hidden">{title ?? t('close')}</span>
              )}
            </header>
            <div className="drawer-content">{children}</div>
          </div>
        </FocusTrap>
      </div>
    </div>
  )
}

export default Drawer
