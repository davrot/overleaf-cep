import { useTranslation } from 'react-i18next'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import getMeta from '@/utils/meta'

// R6 (2026-08-29): compact /templates header — the eyebrow + long summary
// wasted a full screen area; keep a tight, functional title.
export default function GalleryHeaderAll() {
  const { t } = useTranslation()
  const isTemplatesManager = Boolean(getMeta('ol-userIsTemplatesManager'))
  return (
    <div className="gallery-header gallery-header-compact">
      <OLRow>
        <OLCol md={12}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
            <h1 className="gallery-title" style={{ margin: 0 }}>{t('latex_templates')}</h1>
            {isTemplatesManager && (
              <a
                href="/templates/manage"
                style={{
                  color: 'var(--link-web, #0f5f93)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('Manage template gallery')}
              </a>
            )}
          </div>
        </OLCol>
      </OLRow>
    </div>
  )
}
