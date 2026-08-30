/**
 * SSO tabs of the Manage Site console (SSO multi-provider feature,
 * 2026-08-29).
 *
 * Three provider tabs — SSO SAML / SSO OIDC / SSO LDAP — each independently
 * enabled and configured in site settings (`sso-saml` / `sso-oidc` /
 * `sso-ldap`). The OVERLEAF_* env values remain the seed/fallback layer
 * (stored wins); secrets are stored encrypted and masked (placeholder shows
 * "configured" when a value exists); saving an empty secret keeps the stored
 * one.
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { putJSON } from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'

export type SsoSection = {
  enabled: boolean
  [key: string]: unknown
}

type Flash = { saving: boolean; saved: boolean; error: string | null }
const IDLE: Flash = { saving: false, saved: false, error: null }

export function useSave(section: string) {
  const [flash, setFlash] = useState<Flash>(IDLE)
  const save = async (body: unknown): Promise<boolean> => {
    setFlash({ saving: true, saved: false, error: null })
    try {
      // NOTE: pass the OBJECT — fetchJSON stringifies once.
      await putJSON(`/admin/site-settings/${section}`, { body })
      setFlash({ saving: false, saved: true, error: null })
      return true
    } catch (err) {
      const message =
        (err as { data?: { message?: string } })?.data?.message ||
        (err instanceof Error ? err.message : String(err))
      setFlash({ saving: false, saved: false, error: message })
      return false
    }
  }
  return { flash, save }
}

function FieldRow({
  label,
  htmlFor,
  children,
  hint,
}: {
  label?: string
  htmlFor?: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <OLFormGroup>
      {label && htmlFor && <OLFormLabel htmlFor={htmlFor}>{label}</OLFormLabel>}
      {children}
      {hint && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>{hint}</p>
      )}
    </OLFormGroup>
  )
}

function ProviderTab({
  description,
  flash,
  onSave,
  children,
}: {
  description: string
  flash: Flash
  onSave: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary, #666)' }}>
        {description}
      </p>
      {children}
      {flash.error && (
        <p role="alert" style={{ color: 'var(--danger, #b00020)', fontSize: '13px' }}>
          {flash.error}
        </p>
      )}
      {flash.saved && (
        <p style={{ color: 'var(--success, #0a7b3e)', fontSize: '13px' }}>
          {t('adminSite.settingsSaved')}
        </p>
      )}
      <OLButton variant="primary" disabled={flash.saving} onClick={onSave}>
        {flash.saving ? 'Saving…' : t('save')}
      </OLButton>
    </div>
  )
}

export function SamlSsoTab({ section }: { section: SsoSection }) {
  const { t } = useTranslation()
  const s = section || {}
  const { flash, save } = useSave('sso-saml')
  const [v, setV] = useState({
    enabled: Boolean(s.enabled),
    identityServiceName: String(s.identityServiceName || ''),
    issuer: String(s.issuer || ''),
    audience: String(s.audience || ''),
    entrypoint: String(s.entrypoint || ''),
    idpCert: '',
    wantAssertionsSigned: Boolean(s.wantAssertionsSigned),
    attUserId: String(s.attUserId || 'nameID'),
    attEmail: String(s.attEmail || 'nameID'),
    attFirstName: String(s.attFirstName || 'givenName'),
    attLastName: String(s.attLastName || 'lastName'),
  })

  return (
    <ProviderTab
      description={t('adminSite.ssoSamlDesc')}
      flash={flash}
      onSave={() =>
        void save({
          enabled: v.enabled,
          identityServiceName: v.identityServiceName,
          issuer: v.issuer,
          audience: v.audience,
          entrypoint: v.entrypoint,
          idpCert: v.idpCert,
          wantAssertionsSigned: v.wantAssertionsSigned,
          attUserId: v.attUserId,
          attEmail: v.attEmail,
          attFirstName: v.attFirstName,
          attLastName: v.attLastName,
        })
      }
    >
      <FieldRow htmlFor="sso-saml-enabled">
        <OLFormCheckbox
          id="sso-saml-enabled"
          checked={v.enabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, enabled: e.target.checked }))
          }
          label={t('adminSite.ssoEnable')}
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoDisplayName')} htmlFor="sso-saml-name">
        <OLFormControl
          id="sso-saml-name"
          type="text"
          value={v.identityServiceName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, identityServiceName: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoSamlIssuer')} htmlFor="sso-saml-issuer">
        <OLFormControl
          id="sso-saml-issuer"
          type="text"
          value={v.issuer}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, issuer: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoSamlEntries')} htmlFor="sso-saml-audience">
        <OLFormControl
          id="sso-saml-audience"
          type="text"
          placeholder={t('adminSite.ssoSamlAudience')}
          value={v.audience}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, audience: e.target.value }))
          }
        />
        <OLFormControl
          type="text"
          placeholder={t('adminSite.ssoSamlEntrypoint')}
          style={{ marginTop: '6px' }}
          value={v.entrypoint}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, entrypoint: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoSamlIdpCert')} htmlFor="sso-saml-cert" hint={t('adminSite.ssoSecretNote')}>
        <textarea
          id="sso-saml-cert"
          rows={4}
          className="form-control"
          placeholder={s.idpCertSet ? t('adminSite.secretConfigured') : '-----BEGIN CERTIFICATE-----'}
          value={v.idpCert}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setV(x => ({ ...x, idpCert: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoSamlAttrs')} htmlFor="sso-saml-attuser">
        <OLFormControl
          id="sso-saml-attuser"
          type="text"
          placeholder={t('adminSite.ssoSamlAttUser')}
          value={v.attUserId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, attUserId: e.target.value }))
          }
        />
        <OLFormControl
          type="text"
          placeholder={t('adminSite.ssoSamlAttAttrs')}
          style={{ marginTop: '6px' }}
          value={[
            v.attEmail,
            v.attFirstName,
            v.attLastName,
          ].join(' / ')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const [a, b, c] = e.target.value.split(' / ').map(x => x.trim())
            setV(x => ({ ...x, attEmail: a || 'nameID', attFirstName: b || 'givenName', attLastName: c || 'lastName' }))
          }}
        />
      </FieldRow>
      <FieldRow>
        <OLFormCheckbox
          checked={v.wantAssertionsSigned}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, wantAssertionsSigned: e.target.checked }))
          }
          label={t('adminSite.ssoSamlWantSigned')}
        />
      </FieldRow>
    </ProviderTab>
  )
}

export function OidcSsoTab({ section }: { section: SsoSection }) {
  const { t } = useTranslation()
  const o = section || {}
  const { flash, save } = useSave('sso-oidc')
  const [v, setV] = useState({
    enabled: Boolean(o.enabled),
    identityServiceName: String(o.identityServiceName || ''),
    issuer: String(o.issuer || ''),
    authorizationURL: String(o.authorizationURL || ''),
    tokenURL: String(o.tokenURL || ''),
    userInfoURL: String(o.userInfoURL || ''),
    clientID: String(o.clientID || ''),
    clientSecret: '',
    scope: String(o.scope || 'openid profile email'),
    allowedOIDCEmailDomains: ((o.allowedOIDCEmailDomains as string[]) || []).join(', '),
  })

  return (
    <ProviderTab
      description={t('adminSite.ssoOidcDesc')}
      flash={flash}
      onSave={() =>
        void save({
          enabled: v.enabled,
          identityServiceName: v.identityServiceName,
          issuer: v.issuer,
          authorizationURL: v.authorizationURL,
          tokenURL: v.tokenURL,
          userInfoURL: v.userInfoURL,
          clientID: v.clientID,
          clientSecret: v.clientSecret,
          scope: v.scope,
          allowedOIDCEmailDomains: v.allowedOIDCEmailDomains
            .split(/[,\s]+/)
            .map(x => x.trim())
            .filter(Boolean),
        })
      }
    >
      <FieldRow htmlFor="sso-oidc-enabled">
        <OLFormCheckbox
          id="sso-oidc-enabled"
          checked={v.enabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, enabled: e.target.checked }))
          }
          label={t('adminSite.ssoEnable')}
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoDisplayName')} htmlFor="sso-oidc-name">
        <OLFormControl
          id="sso-oidc-name"
          type="text"
          value={v.identityServiceName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, identityServiceName: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoOidcIssuer')} htmlFor="sso-oidc-issuer">
        <OLFormControl
          id="sso-oidc-issuer"
          type="text"
          placeholder="https://idp.example.com"
          value={v.issuer}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, issuer: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoOidcUrls')} htmlFor="sso-oidc-urls">
        <OLFormControl
          id="sso-oidc-urls"
          type="text"
          placeholder={t('adminSite.ssoOidcAuthUrl')}
          value={v.authorizationURL}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, authorizationURL: e.target.value }))
          }
        />
        <OLFormControl
          type="text"
          placeholder={t('adminSite.ssoOidcTokenUrl')}
          style={{ marginTop: '6px' }}
          value={v.tokenURL}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, tokenURL: e.target.value }))
          }
        />
        <OLFormControl
          type="text"
          placeholder={t('adminSite.ssoOidcUserInfoUrl')}
          style={{ marginTop: '6px' }}
          value={v.userInfoURL}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, userInfoURL: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoOidcClientId')} htmlFor="sso-oidc-clientid">
        <OLFormControl
          id="sso-oidc-clientid"
          type="text"
          value={v.clientID}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, clientID: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoOidcClientSecret')} htmlFor="sso-oidc-secret" hint={t('adminSite.ssoSecretNote')}>
        <OLFormControl
          id="sso-oidc-secret"
          type="password"
          autoComplete="new-password"
          placeholder={o.clientSecretSet ? t('adminSite.secretConfigured') : ''}
          value={v.clientSecret}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, clientSecret: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoOidcScope')} htmlFor="sso-oidc-scope">
        <OLFormControl
          id="sso-oidc-scope"
          type="text"
          value={v.scope}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, scope: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoOidcDomains')} htmlFor="sso-oidc-domains" hint={t('adminSite.ssoOidcDomainsHint')}>
        <OLFormControl
          id="sso-oidc-domains"
          type="text"
          placeholder="uni-bremen.de, example.org"
          value={v.allowedOIDCEmailDomains}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, allowedOIDCEmailDomains: e.target.value }))
          }
        />
      </FieldRow>
    </ProviderTab>
  )
}

export function LdapSsoTab({ section }: { section: SsoSection }) {
  const { t } = useTranslation()
  const l = section || {}
  const { flash, save } = useSave('sso-ldap')
  const [v, setV] = useState({
    enabled: Boolean(l.enabled),
    placeholder: String(l.placeholder || 'Username'),
    url: String(l.url || ''),
    searchBase: String(l.searchBase || ''),
    bindDN: String(l.bindDN || ''),
    bindCredentials: '',
    searchFilter: String(l.searchFilter || ''),
    searchScope: String(l.searchScope || 'sub'),
    starttls: Boolean(l.starttls),
    attEmail: String(l.attEmail || 'mail'),
  })

  return (
    <ProviderTab
      description={t('adminSite.ssoLdapDesc')}
      flash={flash}
      onSave={() =>
        void save({
          enabled: v.enabled,
          placeholder: v.placeholder,
          url: v.url,
          searchBase: v.searchBase,
          bindDN: v.bindDN,
          bindCredentials: v.bindCredentials,
          searchFilter: v.searchFilter,
          searchScope: v.searchScope,
          starttls: v.starttls,
          attEmail: v.attEmail,
        })
      }
    >
      <FieldRow htmlFor="sso-ldap-enabled">
        <OLFormCheckbox
          id="sso-ldap-enabled"
          checked={v.enabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, enabled: e.target.checked }))
          }
          label={t('adminSite.ssoEnable')}
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoLdapUrl')} htmlFor="sso-ldap-url">
        <OLFormControl
          id="sso-ldap-url"
          type="text"
          placeholder="ldap(s)://ldap.example.com:389"
          value={v.url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, url: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoLdapSearchBase')} htmlFor="sso-ldap-base">
        <OLFormControl
          id="sso-ldap-base"
          type="text"
          placeholder="dc=example,dc=com"
          value={v.searchBase}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, searchBase: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoLdapBindDn')} htmlFor="sso-ldap-binddn">
        <OLFormControl
          id="sso-ldap-binddn"
          type="text"
          value={v.bindDN}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, bindDN: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoLdapBindCred')} htmlFor="sso-ldap-bindcred" hint={t('adminSite.ssoSecretNote')}>
        <OLFormControl
          id="sso-ldap-bindcred"
          type="password"
          autoComplete="new-password"
          placeholder={l.bindCredentialsSet ? t('adminSite.secretConfigured') : ''}
          value={v.bindCredentials}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, bindCredentials: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow label={t('adminSite.ssoLdapFilter')} htmlFor="sso-ldap-filter">
        <OLFormControl
          id="sso-ldap-filter"
          type="text"
          placeholder="(objectClass=inetOrgPerson)"
          value={v.searchFilter}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, searchFilter: e.target.value }))
          }
        />
      </FieldRow>
      <FieldRow>
        <OLFormCheckbox
          checked={v.starttls}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setV(x => ({ ...x, starttls: e.target.checked }))
          }
          label={t('adminSite.ssoLdapStarttls')}
        />
      </FieldRow>
    </ProviderTab>
  )
}
