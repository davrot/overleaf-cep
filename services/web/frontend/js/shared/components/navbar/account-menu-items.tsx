import { useEffect, useRef, useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import type { NavbarLinkItemData, NavbarSessionUser } from '@/shared/components/types/navbar'
import DropdownListItem from '@/shared/components/dropdown/dropdown-list-item'
import NavDropdownDivider from './nav-dropdown-divider'
import NavDropdownLinkItem from './nav-dropdown-link-item'
import { useDsNavStyle } from '@/features/project-list/components/use-is-ds-nav'
import { CaretLeft, SignOut } from '@phosphor-icons/react'
import ThemeToggle from '@/features/project-list/components/sidebar/theme-toggle'

/**
 * "Manage" sub-dropdown (user design 2026-08-28): a folder that flies out
 * to the left (the account menu sits at the right edge) containing the
 * site-management links. Implemented as a state-driven flyout because a
 * react-bootstrap <Dropdown> nested inside this Dropdown.Menu is swallowed
 * by the parent's root-close handling (broken, user-reported).
 *
 * Naming: the historical Admin Panel (/admin) keeps the name "Manage Site";
 * the site-settings console (/admin/site) is "Manage Extensions".
 */
function ManageSubmenu({ canManageProjects }: { canManageProjects: boolean }) {
  const ref = useRef<HTMLLIElement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const items = [
    { href: '/admin', label: 'Manage Site' },
    { href: '/admin/site', label: 'Manage Extensions' },
    { href: '/admin/user', label: 'Manage Users' },
  ]
  if (canManageProjects) items.push({ href: '/admin/project', label: 'Manage Projects' })

  return (
    <li
      ref={ref}
      role="none"
      className="manage-submenu-item"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        role="menuitem"
        className="dropdown-item manage-submenu-toggle d-flex align-items-center justify-content-between"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span>Manage</span>
        <CaretLeft size={14} weight="bold" opacity={open ? 1 : 0.6} />
      </button>
      {open ? (
        <ul role="menu" className="dropdown-menu manage-submenu-menu show">
          {items.map(item => (
            <li key={item.href} role="none">
              <a href={item.href} role="menuitem" className="dropdown-item">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * Nav-extra links (SaaS layout: Library, Templates — see
 * settings.defaults.js nav.header_extras → ol-navbar meta `items`).
 * The account menu (sidebar lower section) shows the same items the top
 * navbar shows, using the same visibility rules as default-navbar.tsx.
 */
function useNavExtraItems(sessionUser: NavbarSessionUser | undefined) {
  const items = getMeta('ol-navbar')?.items ?? []
  const suppressNavContentLinks =
    getMeta('ol-navbar')?.suppressNavContentLinks ?? false
  return items.filter((item): item is NavbarLinkItemData => {
    if (!('url' in item)) return false
    if (item.only_when_logged_in && item.only_when_logged_out) return false
    if (item.only_when_logged_in && !sessionUser) return false
    if (item.only_when_logged_out && sessionUser) return false
    if (item.only_content_pages) return !suppressNavContentLinks
    return true
  })
}

export function AccountMenuItems({
  sessionUser,
  showSubscriptionLink,
  showThemeToggle = false,
}: {
  sessionUser: NavbarSessionUser
  showSubscriptionLink: boolean
  showThemeToggle?: boolean
}) {
  const { t } = useTranslation()
  const logOutFormId = 'logOutForm'
  const dsNavStyle = useDsNavStyle()
  const hasOverallThemes = Boolean(getMeta('ol-overallThemes'))
  const navExtraItems = useNavExtraItems(sessionUser)
  // Admin section parity with the top navbar's Admin dropdown
  // (admin-menu.tsx): same items, same flag-based visibility rules.
  const nav = (getMeta('ol-navbar') ?? {}) as {
    canDisplayAdminMenu?: boolean
    canDisplayProjectUrlLookup?: boolean
    canDisplayAdminRedirect?: boolean
    canDisplaySplitTestMenu?: boolean
    canDisplaySurveyMenu?: boolean
    canDisplayScriptLogMenu?: boolean
    adminUrl?: string
  }

  return (
    <>
      <Dropdown.Item as="li" disabled role="menuitem">
        {sessionUser.email}
      </Dropdown.Item>
      <NavDropdownDivider />
      <NavDropdownLinkItem href="/project">{t('projects')}</NavDropdownLinkItem>
      {navExtraItems.map((item, index) => (
        <NavDropdownLinkItem key={index} href={item.url}>
          {item.translatedText || item.text}
        </NavDropdownLinkItem>
      ))}
      <NavDropdownLinkItem href="/user/settings">
        {t('account_settings')}
      </NavDropdownLinkItem>
      {showSubscriptionLink ? (
        <NavDropdownLinkItem href="/user/subscription">
          {t('subscription')}
        </NavDropdownLinkItem>
      ) : null}
      {(nav.canDisplayAdminMenu || nav.canDisplayProjectUrlLookup || nav.canDisplayAdminRedirect || nav.canDisplaySplitTestMenu || nav.canDisplaySurveyMenu || nav.canDisplayScriptLogMenu) && (
        <>
          <NavDropdownDivider />
          {(nav.canDisplayAdminMenu || nav.canDisplayProjectUrlLookup) ? (
            <ManageSubmenu canManageProjects={Boolean(nav.canDisplayProjectUrlLookup)} />
          ) : null}
          {nav.canDisplayAdminRedirect && nav.adminUrl ? (
            <NavDropdownLinkItem href={nav.adminUrl}>
              Switch to Admin
            </NavDropdownLinkItem>
          ) : null}
          {nav.canDisplaySplitTestMenu ? (
            <NavDropdownLinkItem href="/admin/split-test">
              Manage Feature Flags
            </NavDropdownLinkItem>
          ) : null}
          {nav.canDisplaySurveyMenu ? (
            <NavDropdownLinkItem href="/admin/survey">
              Manage Surveys
            </NavDropdownLinkItem>
          ) : null}
          {nav.canDisplayScriptLogMenu ? (
            <NavDropdownLinkItem href="/admin/script-logs">
              View Script Logs
            </NavDropdownLinkItem>
          ) : null}
        </>
      )}
      {showThemeToggle && hasOverallThemes && (
        <DropdownListItem>
          <ThemeToggle />
        </DropdownListItem>
      )}

      <NavDropdownDivider />
      <DropdownListItem>
        {
          // The button is outside the form but still belongs to it via the
          // form attribute. The reason to do this is that if the button is
          // inside the form, screen readers will not count it in the total
          // number of menu items
        }
        <Dropdown.Item
          as="button"
          type="submit"
          form={logOutFormId}
          role="menuitem"
          className="d-flex align-items-center justify-content-between"
        >
          <span>{t('log_out')}</span>
          {dsNavStyle && <SignOut size={16} />}
        </Dropdown.Item>
        <form id={logOutFormId} method="POST" action="/logout">
          <input type="hidden" name="_csrf" value={getMeta('ol-csrfToken')} />
        </form>
      </DropdownListItem>
    </>
  )
}
