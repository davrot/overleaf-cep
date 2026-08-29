/**
 * Manage Site — admin console (site-admin only).
 *
 * Sections (SiteSettings, stored in the `site_settings` Mongo document;
 * stored value wins over environment):
 *   - Templates    : gallery on/off + categories (on/off, name,
 *                    description, template count) — user-designed spec
 *   - Zotero       : connector on/off, client key, client secret
 *                    (masked in the UI, encrypted at rest)
 *   - External URLs: linked-URL import on/off, blocked CIDR list,
 *                    allowed-resources regex
 *   - Sign Up      : registration on/off, allowed email domains
 *
 * API: GET  /admin/site-settings
 *      PUT  /admin/site-settings/<section>   (per-section, validated)
 *
 * Page chrome: the /admin/user DS-nav layout (user decision 2026-08-28) —
 * same navbar, wrapper, title and content structure as the user-list page.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import Notification from '@/shared/components/notification'
import { Dropdown } from 'react-bootstrap'
import { User as UserIcon } from '@phosphor-icons/react'
import { AccountMenuItems } from '@/shared/components/navbar/account-menu-items'
import { getJSON, putJSON, postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import type { NavbarSessionUser } from '@/shared/components/types/navbar'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import CookieBanner from '@/shared/components/cookie-banner'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import overleafLogoDark from '@/shared/svgs/overleaf-a-ds-solution-mallard-dark.svg'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import useThemedPage from '@/shared/hooks/use-themed-page'

type TemplateCategory = {
  key: string
  enabled: boolean
  name: string
  description: string
  publishable: boolean
}

type SiteSettings = {
  templates: {
    enabled: boolean
    categories: TemplateCategory[]
    counts?: Record<string, number | null>
  }
  zotero: {
    enabled: boolean
    clientKey: string
    clientSecret: string
    clientSecretSet?: boolean
  }
  externalUrl: {
    enabled: boolean
    blockedNetworks: string[]
    allowedResourcesRegex: string
  }
  signup: { enabled: boolean; allowedEmailDomains: string[]; disabledRedirectUrl?: string }
}

type Section = 'templates' | 'zotero' | 'externalUrl' | 'signup'

const SECTIONS: { id: Section; labelKey: string }[] = [
  { id: 'templates', labelKey: 'adminSite.templates' },
  { id: 'zotero', labelKey: 'adminSite.zotero' },
  { id: 'externalUrl', labelKey: 'adminSite.externalUrls' },
  { id: 'signup', labelKey: 'adminSite.signUp' },
]

function useSectionSave(section: Section) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async (body: unknown) => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      // NOTE: pass the OBJECT — fetchJSON stringifies once
      // (double-stringifying here produced a 400 body-parser error).
      await putJSON(`/admin/site-settings/${section}`, {
        body,
      })
      setSaved(true)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const flash = (
    <div>
      {error && <Notification type="error" content={error} />}
      {saved && !error && <Notification type="success" content="✓ Saved" />}
    </div>
  )

  return { saving, error, saved, save, flash }
}


/**
 * Left sidebar for /admin/site — same shell as the /admin/user sidebar
 * (user decision 2026-08-28): section list on top, account/help + CE+
 * name at the bottom (mirrors user-list sidebar-ds-nav.tsx).
 */
function ManageSidebar({
  active,
  onSelect,
}: {
  active: Section
  onSelect: (s: Section) => void
}) {
  const { t } = useTranslation()
  const sessionUser = (getMeta('ol-navbar') ?? {}) as {
    sessionUser?: NavbarSessionUser
  }
  return (
    <div className="user-list-sidebar-wrapper-react d-none d-md-flex manage-extensions-sidebar">
      <nav className="flex-grow flex-shrink" aria-label={t('manageExtensions')}>
        <div className="user-list-sidebar-scroll">
          <ul className="list-unstyled user-list-filters">
            <li className="dropdown-header">{t('manageExtensions')}</li>
            {SECTIONS.map(sec => (
              <li key={sec.id} className={active === sec.id ? 'active' : ''}>
                <button type="button" onClick={() => onSelect(sec.id)}>
                  {t(sec.labelKey)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="ds-nav-sidebar-lower">
        <nav
          className="d-flex flex-row gap-3 mb-2"
          aria-label="account help"
        >
          {sessionUser?.sessionUser ? (
            <Dropdown className="ds-nav-icon-dropdown" role="menu">
              <Dropdown.Toggle role="menuitem" aria-label={t('Account')}>
                <div>
                  <UserIcon size={24} />
                </div>
              </Dropdown.Toggle>
              <Dropdown.Menu
                as="ul"
                role="menu"
                align="end"
                popperConfig={{
                  modifiers: [{ name: 'offset', options: { offset: [-50, 5] } }],
                }}
              >
                <AccountMenuItems
                  sessionUser={sessionUser.sessionUser}
                  showSubscriptionLink={false}
                  showThemeToggle={true}
                  // keep the "Manage" accordion stable inside this menu
                />
              </Dropdown.Menu>
            </Dropdown>
          ) : null}
        </nav>
        <div className="ds-nav-ds-name" translate="no">
          <span>CE+</span>
        </div>
      </div>
    </div>
  )
}

export default function SiteSettingsPage() {
  const { t } = useTranslation()
  useThemedPage()
  const navbarProps = getMeta('ol-navbar')
  const footerProps = getMeta('ol-footer')
  const activeOverallTheme = useActiveOverallTheme()
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  const [active, setActive] = useState<Section>('templates')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    getJSON<SiteSettings>('/admin/site-settings')
      .then(data => {
        if (mounted) setSettings(data)
      })
      .catch(err => {
        if (mounted) setLoadError(err?.message || String(err))
      })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="user-ds-nav-page website-redesign red-nav-bar-for-admins manage-extensions-page">
      <DefaultNavbar
        {...(navbarProps || {})}
        overleafLogo={activeOverallTheme === 'dark' ? overleafLogoDark : overleafLogo}
        showCloseIcon
      />
      <div className="user-list-wrapper">
        <ManageSidebar active={active} onSelect={setActive} />
        <div className="user-ds-nav-content-and-messages">
          <div className="user-ds-nav-content">
            <div className="user-ds-nav-main">
              <main aria-labelledby="main-content">
                <div className="user-list-header-row">
                  <h1
                    id="main-content"
                    tabIndex={-1}
                    className="user-list-title text-truncate d-none d-md-block"
                  >
                    {t(SECTIONS.find(sec => sec.id === active)!.labelKey)}
                  </h1>
                </div>
                {loadError ? (
                  <Notification type="error" content={loadError} />
                ) : !settings ? (
                  <p>{t('loading')}</p>
                ) : (
                  <>
                    <p className="manage-extensions-intro">
                      {t('adminSiteIntro')}
                    </p>
      <div style={{ maxWidth: '900px' }}>
        {active === 'templates' && (
          <TemplatesTab
            key={`tpl-${settings.templates.enabled}`}
            initial={settings.templates}
            onApplied={(templates) =>
              setSettings(s => ({ ...s, templates: { ...templates, counts: s.templates.counts } }))
            }
          />
        )}
                      {active === 'zotero' && <ZoteroTab initial={settings.zotero} />}
                      {active === 'externalUrl' && <ExternalUrlTab initial={settings.externalUrl} />}
                      {active === 'signup' && <SignupTab initial={settings.signup} />}
                    </div>
                  </>
                )}
              </main>
            </div>
            <Footer {...(footerProps || {})} />
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * 3b (2026-08-28): template bundle save/import.
 * Bundle = zip with template.json + source.zip + output.pdf:
 *   - "Download bundle"     GET /template/:id/bundle
 *   - "Import bundle"       POST /template/bundle/import { data: base64, override }
 * Conflicts (same template name) prompt for an override re-import.
 */
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return window.btoa(binary)
}

function TemplateBundles() {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<
    { id: string; name: string; version: string; category: string }[] | null
  >(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refresh = () => {
    void getJSON<{ totalSize: number; templates: { id: string; name: string; version: string; category: string }[] }>(
      '/api/templates?category=all&by=lastUpdated&order=desc'
    )
      .then(d => setTemplates(d.templates || []))
      .catch(err => setLoadError(err?.data?.message || t('Could not load the template list')))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doImport = (b64: string, override: boolean) => {
    setBusy(true)
    setStatus(null)
    return postJSON('/template/bundle/import', { body: { data: b64, override } })
      .then(data => {
        const msg = data.created
          ? t('Bundle imported: template created', { name: data.name || '' })
          : t('Bundle imported: template replaced (v__version__)', { version: data.version })
        setStatus({ kind: 'ok', text: typeof msg === 'string' ? msg : msg })
        refresh()
      })
      .catch(err => {
        if (err?.response?.status === 409 && err?.data?.canOverride) {
          // eslint-disable-next-line no-alert
          const yes = window.confirm(
            `${err.data.message}\n\n${t('Import over the existing template?')}`
          )
          if (yes) return doImport(b64, true)
          setStatus({ kind: 'error', text: err.data.message || t('Import failed') })
        } else {
          setStatus({
            kind: 'error',
            text: err?.data?.message || err?.message || t('Import failed'),
          })
        }
      })
      .finally(() => setBusy(false))
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setStatus({ kind: 'error', text: t('Bundle too large (max ~9 MB)') })
      return
    }
    void file
      .arrayBuffer()
      .then(buf => doImport(bufToBase64(buf), false))
      .catch(err => setStatus({ kind: 'error', text: String(err?.message || err) }))
  }

  return (
    <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color, #eee)', paddingTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{t('Template bundles')}</h3>
      <p style={{ color: 'var(--text-secondary, #666)', fontSize: '13px' }}>
        {t(
          'A bundle is a zip of template.json + source.zip + output.pdf. Download one to save/backup a template, or import one to restore/re-publish it (same name = replace, unless you confirm an override).'
        )}
      </p>
      {loadError && (
        <Notification type="error" content={loadError} isDismissible onDismiss={() => setLoadError(null)} />
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color, #ddd)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('name')}</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('category')}</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>{t('version')}</th>
            <th style={{ padding: '6px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {(templates || []).map(tp => (
            <tr key={tp.id} style={{ borderBottom: '1px solid var(--border-color, #eee)' }}>
              <td style={{ padding: '6px 8px' }}>
                <a href={`/template/${tp.id}`}>{tp.name}</a>
              </td>
              <td style={{ padding: '6px 8px', fontSize: '13px' }}>{(tp.category || '').replace('/templates/', '')}</td>
              <td style={{ padding: '6px 8px', fontSize: '13px' }}>{tp.version}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                <OLButton variant="ghost" size="sm" as="a" href={`/template/${tp.id}/bundle`}>
                  {t('Download bundle')}
                </OLButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <OLButton variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {t('Import bundle…')}
        </OLButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/zip,.zip"
          style={{ display: 'none' }}
          onChange={onFile}
          data-testid="bundle-import-file"
        />
        {busy && <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Importing…')}</span>}
      </div>
      {status && (
        <div style={{ marginTop: '8px' }}>
          <Notification type={status.kind === 'ok' ? 'success' : 'warning'} content={status.text} isDismissible onDismiss={() => setStatus(null)} />
        </div>
      )}
    </div>
  )
}

function TemplatesTab({
  initial,
  onApplied,
}: {
  initial: SiteSettings['templates']
  onApplied: (t: SiteSettings['templates']) => void
}) {
  const { t: translate } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [categories, setCategories] = useState<TemplateCategory[]>(initial.categories)
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ name: string; description: string }>({
    name: '',
    description: '',
  })
  const { saving, save, flash } = useSectionSave('templates')

  const counts = initial.counts || {}
  const openEdit = (cat: TemplateCategory) => {
    setEditKey(cat.key)
    setEditDraft({ name: cat.name, description: cat.description || '' })
  }

  return (
    <div>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          label={translate('adminSite.templatesGallery')}
        />
      </OLFormGroup>
      <p style={{ color: 'var(--text-secondary, #666)', fontSize: '13px' }}>
        {translate('adminSite.templatesGalleryHelper')}
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color, #ddd)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>{translate('name')}</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>{translate('status')}</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }} title={translate('adminSite.publishableHelper')}>{translate('adminSite.publishable')}</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>{translate('templatesCount')}</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>{translate('description')}</th>
            <th style={{ padding: '6px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {categories.map(cat => (
            <tr key={cat.key} style={{ borderBottom: '1px solid var(--border-color, #eee)' }}>
              <td style={{ padding: '6px 8px' }}>
                <a href={`/templates/${cat.key}`}>{cat.name}</a>
              </td>
              <td style={{ padding: '6px 8px' }}>
                <OLFormCheckbox
                  aria-label={`${cat.name} enabled`}
                  checked={cat.enabled}
                  onChange={(e) =>
                    setCategories(cs =>
                      cs.map(c =>
                        c.key === cat.key
                          ? { ...c, enabled: (e.target as HTMLInputElement).checked }
                          : c
                      )
                    )
                  }
                />
              </td>
              <td style={{ padding: '6px 8px' }}>
                <OLFormCheckbox
                  aria-label={`${cat.name} publishable`}
                  checked={cat.publishable !== false}
                  onChange={(e) =>
                    setCategories(cs =>
                      cs.map(c =>
                        c.key === cat.key
                          ? { ...c, publishable: (e.target as HTMLInputElement).checked }
                          : c
                      )
                    )
                  }
                />
              </td>
              <td style={{ padding: '6px 8px', fontSize: '13px' }}>
                {counts[cat.key] === null || counts[cat.key] === undefined ? '—' : counts[cat.key]}
              </td>
              <td style={{ padding: '6px 8px', fontSize: '13px', maxWidth: '320px' }}>
                {cat.description || '—'}
              </td>
              <td style={{ padding: '6px 8px' }}>
                <OLButton variant="ghost" size="sm" onClick={() => openEdit(cat)}>
                  {translate('edit')}
                </OLButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <TemplateBundles />

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px' }}>
        <OLButton
          variant="primary"
          disabled={saving}
          isLoading={saving}
          loadingLabel={translate("loading")}
          onClick={() => {
            void save({ enabled, categories }).then(ok => {
              if (ok) onApplied({ enabled, categories })
            })
          }}
        >
          {translate('saveChanges')}
        </OLButton>
      </div>
      <div style={{ marginTop: '8px' }}>{flash}</div>

      {editKey && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{ background: '#fff', borderRadius: '8px', width: '480px', padding: '20px' }}
          >
            <h3 style={{ marginTop: 0 }}>
              {translate('adminSite.editCategory')} — {editKey}
            </h3>
            <OLFormGroup>
              <OLFormLabel htmlFor={`tpl-name-${editKey}`}>{translate('name')}</OLFormLabel>
              <OLFormControl
                id={`tpl-name-${editKey}`}
                type="text"
                value={editDraft.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setEditDraft(d => ({ ...d, name: e.target.value }))
                }
              />
            </OLFormGroup>
            <OLFormGroup>
              <OLFormLabel htmlFor={`tpl-desc-${editKey}`} className="d-block mb-2">{translate('description')}</OLFormLabel>
              <textarea
                id={`tpl-desc-${editKey}`}
                className="ol-form-control w-100"
                style={{ width: '100%' }}
                rows={3}
                value={editDraft.description}
                onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
              />
            </OLFormGroup>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <OLButton variant="secondary" onClick={() => setEditKey(null)}>
                {translate('cancel')}
              </OLButton>
              <OLButton
                variant="primary"
                onClick={() => {
                  setCategories(cs =>
                    cs.map(c => (c.key === editKey ? { ...c, ...editDraft } : c))
                  )
                  setEditKey(null)
                }}
              >
                {translate('adminSite.applyDraft')}
              </OLButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ZoteroTab({ initial }: { initial: SiteSettings['zotero'] }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [clientKey, setClientKey] = useState(initial.clientKey)
  const [clientSecret, setClientSecret] = useState('')
  const { saving, save, flash } = useSectionSave('zotero')

  return (
    <div>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          label={t('adminSite.zoteroEnabled')}
        />
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="zotero-key">{t('adminSite.zoteroClientKey')}</OLFormLabel>
        <OLFormControl
          id="zotero-key"
          type="text"
          value={clientKey}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientKey(e.target.value)}
        />
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="zotero-secret">{t('adminSite.zoteroClientSecret')}</OLFormLabel>
        <OLFormControl
          id="zotero-secret"
          type="password"
          autoComplete="new-password"
          placeholder={initial.clientSecretSet ? t('adminSite.secretConfigured') : ''}
          value={clientSecret}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientSecret(e.target.value)}
        />
        <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
          {t('adminSite.zoteroSecretNote')}
        </p>
      </OLFormGroup>
      <OLButton
        variant="primary"
        disabled={saving}
        isLoading={saving}
        loadingLabel={t("loading")}
        onClick={() => {
          void save({
            enabled,
            clientKey,
            clientSecret: clientSecret === '' ? '' : clientSecret,
          })
        }}
      >
        {t('saveChanges')}
      </OLButton>
      <div style={{ marginTop: '8px' }}>{flash}</div>
    </div>
  )
}

function ExternalUrlTab({ initial }: { initial: SiteSettings['externalUrl'] }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [net, setNet] = useState((initial.blockedNetworks || []).join('\n'))
  const [regex, setRegex] = useState(initial.allowedResourcesRegex || '')
  const { saving, save, flash } = useSectionSave('externalUrl')

  return (
    <div>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          label={t('adminSite.externalUrlEnabled')}
        />
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="ext-net" className="d-block mb-2">{t('adminSite.blockedNetworks')}</OLFormLabel>
        <textarea
          id="ext-net"
          className="ol-form-control"
          rows={6}
          placeholder={'10.0.0.0/8\n192.168.0.0/16'}
          value={net}
          onChange={e => setNet(e.target.value)}
        />
        <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
          {t('adminSite.blockedNetworksHelper')}
        </p>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="ext-regex">{t('adminSite.allowedResourcesRegex')}</OLFormLabel>
        <OLFormControl
          id="ext-regex"
          type="text"
          placeholder=".*\.uni-bremen\.de/.*"
          value={regex}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegex(e.target.value)}
        />
        <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
          {t('adminSite.allowedResourcesRegexHelper')}
        </p>
      </OLFormGroup>
      <OLButton
        variant="primary"
        disabled={saving}
        isLoading={saving}
        loadingLabel={t("loading")}
        onClick={() => {
          void save({
            enabled,
            blockedNetworks: net
              .split(/\r?\n+/)
              .map(s => s.trim())
              .filter(Boolean),
            allowedResourcesRegex: regex,
          })
        }}
      >
        {t('saveChanges')}
      </OLButton>
      <div style={{ marginTop: '8px' }}>{flash}</div>
    </div>
  )
}

function SignupTab({ initial }: { initial: SiteSettings['signup'] }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [domains, setDomains] = useState((initial.allowedEmailDomains || []).join(', '))
  const [disabledRedirect, setDisabledRedirect] = useState(
    (initial as { disabledRedirectUrl?: string }).disabledRedirectUrl || ''
  )
  const { saving, save, flash } = useSectionSave('signup')

  return (
    <div>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          label={t('adminSite.signUpEnabled')}
        />
        <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
          {t('adminSite.signUpHelper')}
        </p>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="signup-domains">{t('adminSite.allowedEmailDomains')}</OLFormLabel>
        <OLFormControl
          id="signup-domains"
          type="text"
          placeholder="example.org, example.edu"
          value={domains}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomains(e.target.value)}
        />
        <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
          {t('adminSite.allowedEmailDomainsHelper')}
        </p>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="signup-redirect">{t('adminSite.disabledRedirectUrl')}</OLFormLabel>
        <OLFormControl
          id="signup-redirect"
          type="text"
          placeholder="/login, https://example.org/join …"
          value={disabledRedirect}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDisabledRedirect(e.target.value)}
        />
        <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
          {t('adminSite.disabledRedirectUrlHelper')}
        </p>
      </OLFormGroup>
      <OLButton
        variant="primary"
        disabled={saving}
        isLoading={saving}
        loadingLabel={t("loading")}
        onClick={() => {
          void save({
            enabled,
            allowedEmailDomains: domains.split(/[,\s]+/).filter(Boolean),
            disabledRedirectUrl: disabledRedirect.trim(),
          })
        }}
      >
        {t('saveChanges')}
      </OLButton>
      <div style={{ marginTop: '8px' }}>{flash}</div>
    </div>
  )
}
