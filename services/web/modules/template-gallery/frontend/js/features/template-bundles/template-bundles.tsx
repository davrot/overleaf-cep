/**
 * R6 (2026-08-29): shared "template bundles" UI — used both on the
 * site-admin console (/admin/site → Templates) and, for users with the
 * template gallery admin role, on the /templates page.
 *
 * Features:
 *  - list of all templates with per-template "Download bundle"
 *    (GET /template/:id/bundle — template.json + source.zip + output.pdf)
 *  - import a bundle from file (POST /template/bundle/import)
 *  - import a bundle from URL  (POST /template/bundle/import-url —
 *    SSRF-guarded by the External URLs site policy)
 *  - rich feedback on rejection: the server returns a structured `issues`
 *    list (422) that is rendered item by item so the importer can fix
 *    the bundle (R6 item 5: "test the imported bundle carefully before
 *    adding ... give the user rich feedback such that they can fix it")
 *  - same-name conflict → 409 with confirm-to-override (existing flow)
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'

type TemplateRow = { id: string; name: string; version: string; category: string }
type Status =
  | { kind: 'ok' | 'error'; text: string }
  | { kind: 'issues'; issues: string[] }
  | null

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return window.btoa(binary)
}

function issuesFrom(err: unknown): string[] | null {
  const data = (err as { data?: { issues?: string[] } })?.data
  if (data && Array.isArray(data.issues) && data.issues.length > 0) {
    return data.issues
  }
  return null
}

export default function TemplateBundles({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refresh = () => {
    void getJSON<{ totalSize: number; templates: TemplateRow[] }>(
      '/api/templates/admin-list'
    )
      .then(d => setTemplates(d.templates || []))
      .catch(err => setLoadError(err?.data?.message || t('Could not load the template list')))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showFailure = (err: unknown) => {
    const issues = issuesFrom(err)
    if (issues) {
      setStatus({ kind: 'issues', issues })
      return
    }
    const e = err as {
      response?: { status?: number }
      data?: { message?: string; canOverride?: boolean }
      message?: string
    }
    const message = e?.data?.message || e?.message || t('Import failed')
    setStatus({ kind: 'error', text: message })
  }
  void showFailure

  const doImport = (b64: string, override: boolean) => {
    setBusy(true)
    setStatus(null)
    return postJSON('/template/bundle/import', { body: { data: b64, override } })
      .then(data => {
        const msg = data.created
          ? t('Bundle imported: template created', { name: data.name || '' })
          : t('Bundle imported: template replaced (v__version__)', { version: data.version })
        setStatus({ kind: 'ok', text: typeof msg === 'string' ? msg : String(msg) })
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
          showFailure(err)
        }
      })
      .finally(() => setBusy(false))
  }

  const doImportUrl = (rawUrl: string, override: boolean) => {
    setBusy(true)
    setStatus(null)
    return postJSON('/template/bundle/import-url', { body: { url: rawUrl, override } })
      .then(data => {
        const msg = data.created
          ? t('Bundle imported: template created', { name: data.name || '' })
          : t('Bundle imported: template replaced (v__version__)', { version: data.version })
        setStatus({ kind: 'ok', text: typeof msg === 'string' ? msg : String(msg) })
        setUrl('')
        refresh()
      })
      .catch(err => {
        if (err?.response?.status === 409 && err?.data?.canOverride) {
          // eslint-disable-next-line no-alert
          const yes = window.confirm(
            `${err.data.message}\n\n${t('Import over the existing template?')}`
          )
          if (yes) return doImportUrl(rawUrl, true)
          setStatus({ kind: 'error', text: err.data.message || t('Import failed') })
        } else {
          showFailure(err)
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
    <div
      style={{
        marginTop: compact ? 12 : 24,
        borderTop: '1px solid var(--border-color, #eee)',
        paddingTop: '16px',
      }}
    >
      <h3 style={{ marginTop: 0 }}>{t('Template bundles')}</h3>
      <p style={{ color: 'var(--text-secondary, #666)', fontSize: '13px' }}>
        {t(
          'A bundle is a zip of template.json + source.zip + output.pdf. Download one to save/backup a template, or import one (from a file or a URL) to restore/re-publish it (same name = replace, unless you confirm an override).'
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
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
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
        <OLButton
          variant="secondary"
          disabled={busy || url.trim() === ''}
          onClick={() => doImportUrl(url.trim(), false)}
          data-testid="bundle-import-url"
        >
          {t('Import from URL…')}
        </OLButton>
        <input
          type="url"
          placeholder={t('https://…/template.bundle.zip')}
          value={url}
          onChange={e => setUrl(e.target.value)}
          style={{
            flex: '1 1 260px',
            minWidth: '220px',
            padding: '6px 10px',
            border: '1px solid var(--border-color, #ccc)',
            borderRadius: '6px',
            background: 'var(--bg-default, #fff)',
            color: 'inherit',
          }}
          data-testid="bundle-import-url-input"
        />
        {busy && <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Importing…')}</span>}
      </div>
      {status && status.kind === 'issues' && (
        <div style={{ marginTop: '8px' }}>
          <Notification type="error" content={t('Bundle rejected — fix the following and try again:')} />
          <ul
            style={{
              margin: '8px 0 0 20px',
              padding: 0,
              fontSize: '13px',
              color: 'var(--text-error, #b00)',
            }}
          >
            {status.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {status && status.kind !== 'issues' && (
        <div style={{ marginTop: '8px' }}>
          <Notification
            type={status.kind === 'ok' ? 'success' : 'warning'}
            content={status.text}
            isDismissible
            onDismiss={() => setStatus(null)}
          />
        </div>
      )}
    </div>
  )
}
