import { FC, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import useEventListener from '@/shared/hooks/use-event-listener'
import getMeta from '@/utils/meta'
import {
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import {
  mathAncestorNode,
  parseMathContainer,
} from '@/features/source-editor/utils/tree-operations/math'
import { descendantsOfNodeWithType } from '@/features/source-editor/utils/tree-operations/ancestors'
import { EquationEditorModal } from './equation-editor-modal'

type OpenDetail = {
  latex?: string
}

const equationEditorAvailable = getMeta('ol-latexEditorAvailable')

/**
 * Toolbar button (editor toolbar, end group) that opens the Equation
 * Editor window (draggable, minimizable, non-blocking — see
 * equation-editor-modal.tsx).
 *
 * Also opens when the math preview tooltip dispatches a
 * 'latex-editor:open' event, pre-loaded with that equation.
 *
 * CM access is via CodeMirrorViewContext (the toolbar renders inside
 * the provider), so import/insert always target the main editor view —
 * no DOM '.cm-content' guessing like the pre-transplant version had.
 */
const LatexEditorToolbarButton: FC = () => {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()

  const [open, setOpen] = useState(false)
  const [initialLatex, setInitialLatex] = useState<string | undefined>(
    undefined
  )

  const handleInsert = useCallback(
    (latex: string) => {
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: latex },
        selection: { anchor: from + latex.length },
      })
      view.focus()
    },
    [view]
  )

  const handleImport = useCallback((): string => {
    const state = view.state
    const main = state.selection.main
    if (!main.empty) {
      // A range is selected: import it (stripping inline-math delimiters)
      const selected = state.sliceDoc(main.from, main.to)
      return selected.replace(/^\$/, '').replace(/\$$/, '')
    }
    // Empty selection: import the equation under the cursor (same math
    // container extraction the math preview tooltip uses)
    const ancestorNode = mathAncestorNode(state, main.from)
    if (ancestorNode) {
      const [node] = descendantsOfNodeWithType(ancestorNode, 'Math', 'Math')
      if (node) {
        const mathContainer = parseMathContainer(state, node, ancestorNode)
        if (mathContainer) {
          return mathContainer.content
        }
      }
    }
    return ''
  }, [view])

  const handleOpen = useCallback(() => {
    setInitialLatex(undefined)
    setOpen(true)
  }, [])

  const handleOpenWithLatex = useCallback((event: Event) => {
    const detail = ((event as CustomEvent<OpenDetail>).detail ||
      {}) as OpenDetail
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
        <EquationEditorPortal
          onInsert={handleInsert}
          onImport={handleImport}
          onClose={handleClose}
          initialLatex={initialLatex}
        />
      )}
    </>
  )
}

/**
 * Portal wrapper that renders the editor window into document.body so
 * it stays above the toolbar/editor layers and its position:fixed
 * children (search dropdowns, virtual keyboard) are not clipped.
 */
const EquationEditorPortal: FC<{
  onInsert: (latex: string) => void
  onImport: () => string
  onClose: () => void
  initialLatex?: string
}> = ({ onInsert, onImport, onClose, initialLatex }) => {
  const [container] = useState(() => {
    let el = document.getElementById('latex-editor-modal-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'latex-editor-modal-root'
      document.body.appendChild(el)
    }
    return el
  })

  // Remove the (now empty) container on unmount
  useEffect(() => {
    return () => {
      const el = document.getElementById('latex-editor-modal-root')
      if (
        el &&
        el.parentElement === document.body &&
        el.querySelector('.latex-editor-modal') === null
      ) {
        el.remove()
      }
    }
  }, [])

  return createPortal(
    <EquationEditorModal
      onInsert={onInsert}
      onImport={onImport}
      onClose={onClose}
      initialLatex={initialLatex}
    />,
    container
  )
}

export default LatexEditorToolbarButton
