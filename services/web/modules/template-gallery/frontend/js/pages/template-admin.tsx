import ReactDOM from 'react-dom/client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useThemedPage from '@/shared/hooks/use-themed-page'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import CookieBanner from '@/shared/components/cookie-banner'
import getMeta from '@/utils/meta'
import TemplateBundles from '../features/template-bundles/template-bundles'

function TemplateAdminChrome() {
  const { t } = useTranslation()
  useThemedPage()
  const navbarProps = getMeta('ol-navbar') || {}
  const footerProps = getMeta('ol-footer') || {}
  return (
    <div className="project-ds-nav-page website-redesign">
      <DefaultNavbar {...navbarProps} />
      <div className="project-list-wrapper">
        <div className="project-ds-nav-content-and-messages">
          <div className="project-ds-nav-content">
            <div className="project-ds-nav-main">
              <main id="main-content" className="content content-page">
                <div className="container">
                  <h1 className="h2" style={{ fontWeight: 700, marginBottom: '8px' }}>
                    {t('Manage template gallery')}
                  </h1>
                  <p className="gallery-summary" style={{ marginBottom: '16px' }}>
                    {t('Save templates as bundles, or import them from a file or a URL. Only users with the template gallery admin role see this page.')}
                  </p>
                  <TemplateBundles />
                </div>
              </main>
              <Footer {...footerProps} />
            </div>
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}

function TemplateAdminPage() {
  const { isReady, error } = useWaitForI18n()
  if (!isReady) {
    const el = document.getElementById('template-admin-root')
    if (el && !el.innerHTML) {
      el.innerHTML = '<div class="tap-debug">i18n not ready. error: ' + (error ? error.message : 'no-error-yet') + '</div>'
    }
    return null
  }
  return (
    <UserSettingsProvider>
      <TemplateAdminChrome />
    </UserSettingsProvider>
  )
}

const element = document.getElementById('template-admin-root')
if (element) {
  const root = ReactDOM.createRoot(element)
  root.render(<TemplateAdminPage />)
}
