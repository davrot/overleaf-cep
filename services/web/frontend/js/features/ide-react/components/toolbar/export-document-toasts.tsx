import { GlobalToastGeneratorEntry } from '@/features/ide-react/components/global-toasts'
import { useTranslation } from 'react-i18next'

const ExportDocumentErrorToast = () => {
  const { t } = useTranslation()
  return <span>{t('export_document_error')}</span>
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
]

export default generators
