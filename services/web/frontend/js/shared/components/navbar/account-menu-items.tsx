import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import type { NavbarLinkItemData, NavbarSessionUser } from '@/shared/components/types/navbar'
import DropdownListItem from '@/shared/components/dropdown/dropdown-list-item'
import NavDropdownDivider from './nav-dropdown-divider'
import NavDropdownLinkItem from './nav-dropdown-link-item'
import { useDsNavStyle } from '@/features/project-list/components/use-is-ds-nav'
import { SignOut } from '@phosphor-icons/react'
import ThemeToggle from '@/features/project-list/components/sidebar/theme-toggle'

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
            <>
              {/* Site-management links grouped under a "Manage" label
                  (user feedback 2026-08-28). Kept as flat items — a nested
                  <Dropdown> inside the react-bootstrap Dropdown.Menu is
                  swallowed by the menu's root-close handler. */}
              <Dropdown.Item as="li" disabled role="menuitem" className="small text-secondary">
                Manage
              </Dropdown.Item>
              {nav.canDisplayAdminMenu ? (
                <NavDropdownLinkItem href="/admin/site">
                  Manage Site
                </NavDropdownLinkItem>
              ) : null}
              {nav.canDisplayAdminMenu ? (
                <NavDropdownLinkItem href="/admin/user">
                  Manage Users
                </NavDropdownLinkItem>
              ) : null}
              {nav.canDisplayProjectUrlLookup ? (
                <NavDropdownLinkItem href="/admin/project">
                  Manage Projects
                </NavDropdownLinkItem>
              ) : null}
            </>
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
