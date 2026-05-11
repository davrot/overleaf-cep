import { getJSON } from '@/infrastructure/fetch-json'
import { useLocation } from '@/shared/hooks/use-location'
import { debugConsole } from '@/utils/debugging'
import { useProjectContext } from '@/shared/context/project-context'
import { useCallback } from 'react'
import {
  hidePreparingExportToast,
  showExportDocumentError,
  showPreparingExportToast,
} from '../components/toolbar/export-document-toasts'

const SLOW_CONVERSION_THRESHOLD = 2000

export default function useConvertProject(type: 'docx' | 'markdown') {
  const { projectId } = useProjectContext()
  const location = useLocation()
  const triggerConversion = useCallback(async () => {
    let handle: string | undefined
    const toastTimer = setTimeout(() => {
      handle = showPreparingExportToast()
    }, SLOW_CONVERSION_THRESHOLD)
    const hidePreparingToast = () => {
      clearTimeout(toastTimer)
      if (handle) hidePreparingExportToast(handle)
    }
    try {
      const response = await getJSON(
        `/project/${projectId}/download/conversion/${type}?responseFormat=json`
      )
      hidePreparingToast()
      const { downloadUrl } = response
      if (downloadUrl) {
        const url = new URL(downloadUrl, window.location.origin)
        location.assign(url.toString())
      }
    } catch (error) {
      hidePreparingToast()
      showExportDocumentError()
      debugConsole.error(error)
    }
  }, [projectId, type, location])

  return triggerConversion
}
