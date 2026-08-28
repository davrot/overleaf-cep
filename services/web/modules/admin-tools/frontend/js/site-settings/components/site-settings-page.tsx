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
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import Notification from '@/shared/components/notification'
import { getJSON, putJSON } from '@/infrastructure/fetch-json'

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
  signup: { enabled: boolean; allowedEmailDomains: string[] }
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
      await putJSON(`/admin/site-settings/${section}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
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

export default function SiteSettingsPage() {
  const { t } = useTranslation()
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

  if (loadError) {
    return (
      <div className="manage-site container" style={{ padding: '2rem 10%' }}>
        <h1>{t('manageSite')}</h1>
        <Notification type="error" content={loadError} />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="manage-site container" style={{ padding: '2rem 10%' }}>
        <h1>{t('manageSite')}</h1>
        <p>{t('loading')}</p>
      </div>
    )
  }

  return (
    <div className="manage-site container" style={{ padding: '2rem 10%' }}>
      <h1>{t('manageSite')}</h1>
      <p style={{ color: 'var(--text-secondary, #666)' }}>{t('adminSiteIntro')}</p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {SECTIONS.map(s => (
          <OLButton
            key={s.id}
            variant={active === s.id ? 'primary' : 'secondary'}
            onClick={() => setActive(s.id)}
          >
            {t(s.labelKey)}
          </OLButton>
        ))}
      </div>

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
    </div>
  )
}

// ---------------------------------------------------------------------------

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
              <OLFormLabel htmlFor={`tpl-desc-${editKey}`}>{translate('description')}</OLFormLabel>
              <textarea
                id={`tpl-desc-${editKey}`}
                className="ol-form-control"
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
        <OLFormLabel htmlFor="ext-net">{t('adminSite.blockedNetworks')}</OLFormLabel>
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
      <OLButton
        variant="primary"
        disabled={saving}
        isLoading={saving}
        loadingLabel={t("loading")}
        onClick={() => {
          void save({
            enabled,
            allowedEmailDomains: domains.split(/[,\s]+/).filter(Boolean),
          })
        }}
      >
        {t('saveChanges')}
      </OLButton>
      <div style={{ marginTop: '8px' }}>{flash}</div>
    </div>
  )
}
