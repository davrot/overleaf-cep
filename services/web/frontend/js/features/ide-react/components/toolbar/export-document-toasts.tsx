import { GlobalToastGeneratorEntry } from '@/features/ide-react/components/global-toasts'
import { Trans, useTranslation } from 'react-i18next'

const PreparingExportToast = () => {
  const { t } = useTranslation()
  return <span>{t('preparing_for_export')}</span>
}

const ExportDocumentErrorToast = () => {
  const { t } = useTranslation()
  return (
    <>
      <p>
        <b>{t('we_couldnt_export_this_document')}</b>
      </p>
      <Trans
        i18nKey="the_document_contains_formatting_we_werent_able_to_convert_contact_support_if_you_need_help"
        components={[
          // eslint-disable-next-line react/jsx-key, jsx-a11y/anchor-has-content
          <a href="/contact" target="_BLANK" rel="noopener noreferrer" />,
        ]}
      />
    </>
  )
}

const generators: GlobalToastGeneratorEntry[] = [
  {
    key: 'export-document:error',
    generator: () => ({
      content: <ExportDocumentErrorToast />,
      type: 'error',
      autoHide: true,
      delay: 5000,
      isDismissible: true,
    }),
  },
  {
    key: 'export-document:preparing',
    generator: () => ({
      content: <PreparingExportToast />,
      type: 'info',
      autoHide: false,
      isDismissible: true,
    }),
  },
]

export default generators

export const showExportDocumentError = () => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'export-document:error' },
    })
  )
}

export const showPreparingExportToast = () => {
  const handle = `export-document-preparing-${Date.now()}`
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'export-document:preparing', handle },
    })
  )
  return handle
}

export const hidePreparingExportToast = (handle: string) => {
  window.dispatchEvent(
    new CustomEvent('ide:dismiss-toast', {
      detail: { key: 'export-document:preparing', handle },
    })
  )
}
