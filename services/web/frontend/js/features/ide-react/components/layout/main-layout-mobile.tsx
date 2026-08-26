import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { Toolbar } from '@/features/ide-react/components/toolbar/toolbar'
import EditorPanel from '@/features/ide-react/components/editor/editor-panel'
import PdfPreview from '@/features/pdf-preview/components/pdf-preview'
import HistoryContainer from '@/features/ide-react/components/history-container'
import { MobileBottomBar } from '@/features/ide-react/components/layout/mobile-bottom-bar'
import { RailLayout } from '@/features/ide-react/components/rail/rail'

/**
 * Mobile IDE layout (mobile plan, Phase 2).
 *
 * Single pane (no <react-resizable-panels>):
 *
 * - <Toolbar/> renders the mobile <MobileToolbar/> (see toolbar.tsx)
 * - the main pane swaps <EditorPanel/> / <PdfPreview/> / <HistoryContainer/>
 *   based on LayoutContext `view`
 * - <RailLayout/> renders the file-tree/chat rail as a full-screen drawer
 * - <MobileBottomBar/> is a sticky bottom bar (Files / Chat / PDF|Editor)
 *
 * Desktop rendering is unchanged: `MainLayout` only renders this component
 * when `isMobileLayout` is true.
 */
export default function MainLayoutMobile() {
  const { view, pdfLayout } = useLayoutContext()
  const { setIsOpen } = useRailContext()
  const { t } = useTranslation()

  // Close the rail drawer on first render on mobile (desktop sessions
  // persist `isOpen: true` via usePersistedState).
  useEffect(() => {
    setIsOpen(false)
  }, [setIsOpen])

  // Tag <body> so mobile chrome (toasts, modals, which are portaled to
  // <body>) can be scoped with CSS (see stylesheets/mobile/layout.scss).
  useEffect(() => {
    document.body.classList.add('ide-mobile-active')
    return () => {
      document.body.classList.remove('ide-mobile-active')
    }
  }, [])

  const showEditor = view === 'editor' || view === 'file' || view === null

  return (
    <div className="ide-redesign-main ide-redesign-main-mobile" data-mobile>
      <Toolbar />
      <div className="ide-redesign-body">
        <div
          className="ide-mobile-pane"
          aria-label={
            showEditor ? t('editor') : view === 'pdf' ? t('pdf_preview') : undefined
          }
        >
          {view === 'history' ? (
            <HistoryContainer />
          ) : view === 'pdf' && pdfLayout === 'flat' ? (
            <PdfPreview />
          ) : (
            <EditorPanel />
          )}
        </div>
        {/* On mobile, <RailLayout/> renders as a full-screen drawer (see rail.tsx). */}
        <RailLayout />
      </div>
      <MobileBottomBar />
    </div>
  )
}
