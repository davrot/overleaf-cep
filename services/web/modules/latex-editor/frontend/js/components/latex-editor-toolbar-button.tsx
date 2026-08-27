import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import useEventListener from '@/shared/hooks/use-event-listener'
import getMeta from '@/utils/meta'
import { EquationEditorModal } from './equation-editor-modal'

type OpenDetail = {
  latex?: string
}

const equationEditorAvailable = getMeta('ol-latexEditorAvailable')

/**
 * Toolbar button (editor toolbar, end group) that opens the Equation Editor
 * modal. Also opens when the math preview tooltip dispatches a
 * 'latex-editor:open' event, pre-loaded with that equation.
 */
const LatexEditorToolbarButton: FC = () => {
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)
  const [initialLatex, setInitialLatex] = useState<string | undefined>(
    undefined
  )

  const handleOpen = useCallback(() => {
    setInitialLatex(undefined)
    setOpen(true)
  }, [])

  const handleOpenWithLatex = useCallback((event: Event) => {
    const detail = ((event as CustomEvent<OpenDetail>).detail || {}) as OpenDetail
    setInitialLatex(detail.latex || undefined)
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setInitialLatex(undefined)
  }, [])

  // "Open in Equation Editor" from the math preview tooltip options menu
  useEventListener('latex-editor:open', (event: Event) =>
    handleOpenWithLatex(event)
  )

  if (!equationEditorAvailable) {
    return null
  }

  return (
    <>
      <OLButton
        variant="secondary"
        size="sm"
        onClick={handleOpen}
        aria-label={t('equation_editor')}
      >
        <MaterialIcon
          type="functions"
          unfilled
          accessibilityLabel={t('equation_editor')}
        />
      </OLButton>
      {open && (
        <EquationEditorModal initialLatex={initialLatex} onClose={handleClose} />
      )}
    </>
  )
}

export default LatexEditorToolbarButton
