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

  return (
    <>
      <Dropdown.Item as="li" disabled role="menuitem">
        {sessionUser.email}
      </Dropdown.Item>
      <NavDropdownDivider />
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
