/**
 * R9 §7.2 (2026-08-29): six admin-managed runtime tabs for the Manage
 * Site console — Sandboxed Compiles, Git Integration, GitHub Sync,
 * E-mail, Linked File Types, Pandoc.
 *
 * Each tab saves its own site-settings section (stored values WIN over
 * compose env from the next container cycle — the boot hydrator applies
 * them to every service, see modules/server-ce-scripts/scripts/
 * hydrate-site-settings-env.mjs and app/src/Features/SiteSettings/
 * EnvHydrator.mjs). Secrets are encrypted + masked exactly like the
 * Zotero/SSO tabs: empty on save keeps the stored value.
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import { useSave } from './sso-settings-tab'

type SectionValue = {
  enabled?: boolean
  [key: string]: unknown
}

function Text(
  { value, onChange, id, placeholder }: {
    value: string
    onChange: (v: string) => void
    id?: string
    placeholder?: string
  }) {
  return (
    <OLFormControl
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.currentTarget.value)}
    />
  )
}

// ------------------------------------------------------------------------
// Sandboxed Compiles
// ------------------------------------------------------------------------
type ImageRow = { image: string; name: string }

export function SandboxedCompilesTab (
  { initial }: { initial: SectionValue }
) {
  const { t } = useTranslation()
  const { flash, save } = useSave('sandboxed-compiles')
  const [enabled, setEnabled] = useState(Boolean(initial.enabled))
  const [hostDir, setHostDir] = useState(String(initial.hostDir ?? ''))
  const [socketPath, setSocketPath] = useState(String(initial.socketPath ?? ''))
  const [extraFlags, setExtraFlags] = useState(String(initial.extraFlags ?? ''))
  const [imageUser, setImageUser] = useState(String(initial.imageUser ?? ''))
  const [images, setImages] = useState<ImageRow[]>(
    Array.isArray(initial.images)
      ? initial.images.map(r => ({
        image: String(r?.image ?? ''),
        name: String(r?.name ?? '')
      }))
      : []
  )
  const [defaultImage, setDefaultImage] = useState(
    String(initial.defaultImage ?? '')
  )

  const setRow = (i: number, patch: Partial<ImageRow>) => {
    setImages(rows =>
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    )
  }

  const submit = () => {
    void save({
      enabled,
      dockerRunner: enabled, // enable group: one checkbox drives the four vars
      hostDir,
      socketPath,
      extraFlags,
      imageUser,
      images,
      defaultImage: defaultImage || (images[0] && images[0].image) || ''
    })
  }

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        {t('adminSite.scDesc')}
        {t('adminSite.scFixed')}
      </p>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={e => setEnabled(e.currentTarget.checked)}
        >
          {t('adminSite.scEnable')}
        </OLFormCheckbox>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="sc-hostdir">{t('adminSite.scHostDir')}</OLFormLabel>
        <Text
          value={hostDir}
          onChange={setHostDir}
          id="sc-hostdir"
          placeholder="/data/overleaf/compiles"
        />
        <p style={{ fontSize: 12 }}>
          {t('adminSite.scHostDirHint')}
        </p>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="sc-socket">{t('adminSite.scSocket')}</OLFormLabel>
        <Text
          value={socketPath}
          onChange={setSocketPath}
          id="sc-socket"
          placeholder="/var/run/docker.sock"
        />
        <p style={{ fontSize: 12 }}>
          {t('adminSite.scSocketHint')}
        </p>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="sc-flags">{t('adminSite.scFlags')}</OLFormLabel>
        <Text
          value={extraFlags}
          onChange={setExtraFlags}
          id="sc-flags"
          placeholder="-shell-escape"
        />
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="sc-user">{t('adminSite.scImageUser')}</OLFormLabel>
        <Text
          value={imageUser}
          onChange={setImageUser}
          id="sc-user"
          placeholder="www-data"
        />
      </OLFormGroup>


      <h3 style={{ margin: '16px 0 8px' }}>{t('adminSite.scImages')}</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>
              {t('adminSite.scImageCol')}
            </th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>
              {t('adminSite.scNameCol')}
            </th>
            <th style={{ width: '70px', padding: '4px 8px' }} />
            <th style={{ width: '90px', padding: '4px 8px' }}>
              {t('adminSite.scDefaultCol')}
            </th>
          </tr>
        </thead>
        <tbody>
          {images.map((row, i) => (
            <tr key={i}>
              <td style={{ padding: '4px 8px' }}>
                <OLFormControl
                  value={row.image}
                  onChange={e => setRow(i, { image: e.currentTarget.value })}
                />
              </td>
              <td style={{ padding: '4px 8px' }}>
                <OLFormControl
                  value={row.name}
                  onChange={e => setRow(i, { name: e.currentTarget.value })}
                />
              </td>
              <td style={{ textAlign: 'center', padding: '4px 8px' }}>
                <OLButton
                  variant="ghost"
                  size="sm"
                  disabled={images.length <= 1}
                  onClick={() =>
                    setImages(rows => rows.filter((_, j) => j !== i))
                  }
                >
                  {t('remove')}
                </OLButton>
              </td>
              <td style={{ textAlign: 'center', padding: '4px 8px' }}>
                <input
                  type="radio"
                  name="sc-default-image"
                  checked={
                    (defaultImage || (images[0] && images[0].image)) === row.image
                  }
                  onChange={() => setDefaultImage(row.image)}
                  aria-label={t('adminSite.scDefaultCol')}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '8px' }}>
        <OLButton
          variant="ghost"
          size="sm"
          onClick={() => setImages(rows => [...rows, { image: '', name: '' }])}
        >
          {t('adminSite.scAddRow')}
        </OLButton>
      </div>
      <p style={{ fontSize: 12, margin: '6px 0 0' }}>
        {t('adminSite.scImageUserHint')}
      </p>

      <TabFooter flash={flash} onSave={submit} saveLabel={t('save')} />
    </div>
  )
}

function TabFooter (
  { flash, onSave, saveLabel }: {
    flash: { saving: boolean; saved: boolean; error: string | null }
    onSave: () => void
    saveLabel: string
  }
) {
  return (
    <div style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
      <OLButton variant="primary" disabled={flash.saving} onClick={onSave}>
        {flash.saving ? '…' : saveLabel}
      </OLButton>
      {flash.saved && <span style={{ fontSize: 13 }}>Saved ✓</span>}
      {flash.error && (
        <span style={{ fontSize: 13, color: 'var(--red-50, #c00)' }}>
          {flash.error}
        </span>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------
// Git Integration
// ------------------------------------------------------------------------
export function GitIntegrationTab (
  { initial }: { initial: SectionValue }
) {
  const { t } = useTranslation()
  const { flash, save } = useSave('git-integration')
  const [enabled, setEnabled] = useState(Boolean(initial.enabled))
  const [host, setHost] = useState(String(initial.host ?? 'git-bridge'))
  const [port, setPort] = useState(String(initial.port ?? 8000))

  return (
    <div>
      <p style={{ fontSize: 13 }}>{t('adminSite.gitDesc')}</p>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={e => setEnabled(e.currentTarget.checked)}
        >
          {t('adminSite.gitEnable')}
        </OLFormCheckbox>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="git-host">{t('adminSite.gitHost')}</OLFormLabel>
        <Text value={host} onChange={setHost} id="git-host" placeholder="git-bridge" />
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="git-port">{t('adminSite.gitPort')}</OLFormLabel>
        <Text
          value={port}
          onChange={v => setPort(v.replace(/[^\d]/g, ''))}
          id="git-port"
          placeholder="8000"
        />
      </OLFormGroup>
      <p style={{ fontSize: 12, margin: '8px 0 0' }}>
        {t('adminSite.gitContainerNote')}
      </p>
      <TabFooter
        flash={flash}
        saveLabel={t('save')}
        onSave={() => void save({ enabled, host, port: Number(port) || 8000 })}
      />
    </div>
  )
}

// ------------------------------------------------------------------------
// GitHub Sync
// ------------------------------------------------------------------------
export function GithubSyncTab (
  { initial }: { initial: SectionValue }
) {
  const { t } = useTranslation()
  const { flash, save } = useSave('github-sync')
  const [enabled, setEnabled] = useState(Boolean(initial.enabled))
  const [clientID, setClientID] = useState(String(initial.clientID ?? ''))
  const [clientSecret, setClientSecret] = useState('')
  const [cipherFile, setCipherFile] = useState(String(initial.cipherFile ?? ''))
  const [cipherLabel, setCipherLabel] = useState(String(initial.cipherLabel ?? ''))
  const secretSet = Boolean(initial.clientSecretSet)

  return (
    <div>
      <p style={{ fontSize: 13 }}>{t('adminSite.ghDesc')}</p>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={e => setEnabled(e.currentTarget.checked)}
        >
          {t('adminSite.ghEnable')}
        </OLFormCheckbox>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="gh-id">{t('adminSite.ghClientId')}</OLFormLabel>
        <Text value={clientID} onChange={setClientID} id="gh-id" />
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="gh-secret">{t('adminSite.ghClientSecret')}</OLFormLabel>
        <input
          id="gh-secret"
          type="password"
          autoComplete="new-password"
          value={clientSecret}
          placeholder={secretSet ? '•••••• (configured — empty keeps it)' : ''}
          onChange={e => setClientSecret(e.currentTarget.value)}
        />
        <p style={{ fontSize: 12 }}>{t('adminSite.ssoSecretNote')}</p>
      </OLFormGroup>
      <details style={{ margin: '12px 0' }}>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>
          {t('adminSite.ghAdvanced')}
        </summary>
        <OLFormGroup>
          <OLFormLabel htmlFor="gh-cipherfile">{t('adminSite.ghCipherFile')}</OLFormLabel>
          <Text value={cipherFile} onChange={setCipherFile} id="gh-cipherfile" />
        </OLFormGroup>
        <OLFormGroup>
          <OLFormLabel htmlFor="gh-cipherlabel">{t('adminSite.ghCipherLabel')}</OLFormLabel>
          <Text value={cipherLabel} onChange={setCipherLabel} id="gh-cipherlabel" />
          <p style={{ fontSize: 12 }}>{t('adminSite.ghCipherHint')}</p>
        </OLFormGroup>
      </details>
      <p style={{ fontSize: 12 }}>
        {t('adminSite.ghCallback')}
        <code>
          https://psintern.neuro.uni-bremen.de/user/github-sync/oauth2/callback
        </code>
      </p>
      <p style={{ fontSize: 12, margin: '6px 0 0' }}>
        {t('adminSite.ghLimits')}
      </p>
      <TabFooter
        flash={flash}
        saveLabel={t('save')}
        onSave={() =>
          void save({
            enabled,
            clientID,
            clientSecret,
            cipherFile,
            cipherLabel
          })
        }
      />
    </div>
  )
}

// ------------------------------------------------------------------------
// E-mail
// ------------------------------------------------------------------------
export function EmailTab (
  { initial }: { initial: SectionValue }
) {
  const { t } = useTranslation()
  const { flash, save } = useSave('email')
  const [skipConfirmation, setSkipConfirmation] = useState(
    Boolean(initial.skipConfirmation)
  )
  const [driver, setDriver] = useState(String(initial.driver ?? 'smtp'))
  const [fromAddress, setFromAddress] = useState(String(initial.fromAddress ?? ''))
  const [replyTo, setReplyTo] = useState(String(initial.replyTo ?? ''))
  const [host, setHost] = useState(String(initial.host ?? ''))
  const [port, setPort] = useState(String(initial.port ?? 587))
  const [secure, setSecure] = useState(Boolean(initial.secure))
  const [ignoreTLS, setIgnoreTLS] = useState(Boolean(initial.ignoreTLS))
  const [name, setName] = useState(String(initial.name ?? ''))
  const [user, setUser] = useState(String(initial.user ?? ''))
  const [pass, setPass] = useState('')
  const [tlsRejectUnauth, setTlsRejectUnauth] = useState(
    Boolean(initial.tlsRejectUnauth)
  )
  const [accessKeyId, setAccessKeyId] = useState(String(initial.accessKeyId ?? ''))
  const [sesSecret, setSesSecret] = useState('')
  const [sesRegion, setSesRegion] = useState(String(initial.sesRegion ?? ''))
  const passSet = Boolean(initial.passSet)
  const sesSecretSet = Boolean(initial.sesSecretSet)

  return (
    <div>
      <p style={{ fontSize: 13 }}>{t('adminSite.emailDesc')}</p>
      <OLFormGroup>
        <OLFormCheckbox
          checked={skipConfirmation}
          onChange={e => setSkipConfirmation(e.currentTarget.checked)}
        >
          {t('adminSite.emailSkipConfirm')}
        </OLFormCheckbox>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="em-driver">{t('adminSite.emailDriver')}</OLFormLabel>
        <select
          id="em-driver"
          value={driver}
          onChange={e => setDriver(e.currentTarget.value)}
          style={{ padding: '6px 8px', maxWidth: '280px' }}
        >
          <option value="smtp">SMTP</option>
          <option value="ses">Amazon SES</option>
        </select>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="em-from">{t('adminSite.emailFrom')}</OLFormLabel>
        <Text value={fromAddress} onChange={setFromAddress} id="em-from" />
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="em-reply">{t('adminSite.emailReplyTo')}</OLFormLabel>
        <Text value={replyTo} onChange={setReplyTo} id="em-reply" />
      </OLFormGroup>
      {driver === 'smtp' ? (
        <>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-host">{t('adminSite.emailHost')}</OLFormLabel>
            <Text value={host} onChange={setHost} id="em-host" placeholder="smtp.example.com" />
          </OLFormGroup>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-port">{t('adminSite.emailPort')}</OLFormLabel>
            <Text
              value={port}
              onChange={v => setPort(v.replace(/[^\d]/g, ''))}
              id="em-port"
              placeholder="587"
            />
          </OLFormGroup>
          <OLFormGroup>
            <OLFormCheckbox
              checked={secure}
              onChange={e => setSecure(e.currentTarget.checked)}
            >
              {t('adminSite.emailSecure')}
            </OLFormCheckbox>
          </OLFormGroup>
          <OLFormGroup>
            <OLFormCheckbox
              checked={ignoreTLS}
              onChange={e => setIgnoreTLS(e.currentTarget.checked)}
            >
              {t('adminSite.emailIgnoreTLS')}
            </OLFormCheckbox>
          </OLFormGroup>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-name">{t('adminSite.emailName')}</OLFormLabel>
            <Text value={name} onChange={setName} id="em-name" />
          </OLFormGroup>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-user">{t('adminSite.emailUser')}</OLFormLabel>
            <Text value={user} onChange={setUser} id="em-user" />
          </OLFormGroup>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-pass">{t('adminSite.emailPass')}</OLFormLabel>
            <input
              id="em-pass"
              type="password"
              autoComplete="new-password"
              value={pass}
              placeholder={passSet ? '•••••• (configured — empty keeps it)' : ''}
              onChange={e => setPass(e.currentTarget.value)}
            />
            <p style={{ fontSize: 12 }}>{t('adminSite.ssoSecretNote')}</p>
          </OLFormGroup>
          <OLFormGroup>
            <OLFormCheckbox
              checked={tlsRejectUnauth}
              onChange={e => setTlsRejectUnauth(e.currentTarget.checked)}
            >
              {t('adminSite.emailTlsReject')}
            </OLFormCheckbox>
          </OLFormGroup>
        </>
      ) : (
        <>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-ak">{t('adminSite.emailSesAkId')}</OLFormLabel>
            <Text value={accessKeyId} onChange={setAccessKeyId} id="em-ak" />
          </OLFormGroup>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-sk">{t('adminSite.emailSesSecret')}</OLFormLabel>
            <input
              id="em-sk"
              type="password"
              autoComplete="new-password"
              value={sesSecret}
              placeholder={sesSecretSet ? '•••••• (configured — empty keeps it)' : ''}
              onChange={e => setSesSecret(e.currentTarget.value)}
            />
            <p style={{ fontSize: 12 }}>{t('adminSite.ssoSecretNote')}</p>
          </OLFormGroup>
          <OLFormGroup>
            <OLFormLabel htmlFor="em-region">{t('adminSite.emailSesRegion')}</OLFormLabel>
            <Text value={sesRegion} onChange={setSesRegion} id="em-region" />
          </OLFormGroup>
        </>
      )}
      <TabFooter
        flash={flash}
        saveLabel={t('save')}
        onSave={() =>
          void save({
            skipConfirmation,
            driver,
            fromAddress,
            replyTo,
            host,
            port: Number(port) || 587,
            secure,
            ignoreTLS,
            name,
            user,
            pass,
            tlsRejectUnauth,
            accessKeyId,
            sesSecret,
            sesRegion
          })
        }
      />
    </div>
  )
}

// ------------------------------------------------------------------------
// Linked File Types
// ------------------------------------------------------------------------
const LINKED_TYPES = [
  { key: 'project_file', locked: true, labelKey: 'adminSite.lftProjectFile' },
  { key: 'project_output_file', locked: true, labelKey: 'adminSite.lftProjectOutput' },
  { key: 'url', locked: false, labelKey: 'adminSite.lftUrl' },
  { key: 'zotero', locked: false, labelKey: 'adminSite.lftZotero' }
]

export function LinkedFileTypesTab (
  { initial }: { initial: SectionValue }
) {
  const { t } = useTranslation()
  const { flash, save } = useSave('linked-file-types')
  const initialTypes: string[] = Array.isArray(initial.enabledTypes)
    ? initial.enabledTypes
    : []
  const [types, setTypes] = useState<string[]>((
    ['project_file', 'project_output_file']
      .concat(initialTypes.filter(k => k !== 'project_file' && k !== 'project_output_file'))
  ))

  return (
    <div>
      <p style={{ fontSize: 13 }}>{t('adminSite.lftDesc')}</p>
      {LINKED_TYPES.map(row => {
        const checked = types.includes(row.key) || row.locked
        return (
          <OLFormGroup key={row.key} style={{ marginBottom: '8px' }}>
            <OLFormCheckbox
              checked={checked}
              disabled={row.locked}
              onChange={e => {
                const on = e.currentTarget.checked
                setTypes(cur =>
                  on
                    ? Array.from(new Set([...cur, row.key]))
                    : cur.filter(k => k !== row.key)
                )
              }}
            >
              {t(row.labelKey)}
              {row.locked ? ` (${t('adminSite.lftLocked')})` : ''}
            </OLFormCheckbox>
          </OLFormGroup>
        )
      })}
      <TabFooter
        flash={flash}
        saveLabel={t('save')}
        onSave={() =>
          void save({
            enabledTypes: [
              'project_file',
              'project_output_file',
              ...types.filter(k => k !== 'project_file' && k !== 'project_output_file')
            ]
          })
        }
      />
    </div>
  )
}

// ------------------------------------------------------------------------
// Pandoc
// ------------------------------------------------------------------------
export function PandocTab (
  { initial }: { initial: SectionValue }
) {
  const { t } = useTranslation()
  const { flash, save } = useSave('pandoc')
  const [enabled, setEnabled] = useState(Boolean(initial.enabled))
  const [image, setImage] = useState(
    String(initial.image ?? 'pandoc-ol:3.10.0.0')
  )

  return (
    <div>
      <p style={{ fontSize: 13 }}>{t('adminSite.pandocDesc')}</p>
      <OLFormGroup>
        <OLFormCheckbox
          checked={enabled}
          onChange={e => setEnabled(e.currentTarget.checked)}
        >
          {t('adminSite.pandocEnable')}
        </OLFormCheckbox>
      </OLFormGroup>
      <OLFormGroup>
        <OLFormLabel htmlFor="pd-image">{t('adminSite.pandocImage')}</OLFormLabel>
        <Text value={image} onChange={setImage} id="pd-image" placeholder="pandoc-ol:3.10.0.0" />
        <p style={{ fontSize: 12 }}>{t('adminSite.restartHint')}</p>
      </OLFormGroup>
      <p style={{ fontSize: 12, margin: '8px 0 0' }}>
        {t('adminSite.pandocBuildNote')}
      </p>
      <TabFooter
        flash={flash}
        saveLabel={t('save')}
        onSave={() => void save({ enabled, image })}
      />
    </div>
  )
}
