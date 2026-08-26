import { useLayoutContext } from '../../../shared/context/layout-context'
import { useMobileLayout } from '@/shared/hooks/use-mobile-layout'
import PdfSynctexControls from './pdf-synctex-controls'

export function DefaultSynctexControl() {
  const { detachRole } = useLayoutContext()
  // Synctex (double-click sync) is meaningless without a side-by-side split
  // (mobile plan, Phase 4): do not render it in the mobile layout. Uses the
  // same `isEnabled` signal as <Toolbar/> and <MainLayout/> so the guard is
  // consistent. The `display: none` rule in `mobile/layout.scss` is
  // belt-and-suspenders.
  const { isEnabled } = useMobileLayout()
  if (isEnabled) {
    return null
  }
  if (!detachRole) {
    return <PdfSynctexControls />
  }
  return null
}

export function DetacherSynctexControl() {
  const { detachRole, detachIsLinked } = useLayoutContext()
  if (detachRole === 'detacher' && detachIsLinked) {
    return <PdfSynctexControls />
  }
  return null
}

export function DetachedSynctexControl() {
  const { detachRole, detachIsLinked } = useLayoutContext()
  if (detachRole === 'detached' && detachIsLinked) {
    return <PdfSynctexControls />
  }
  return null
}
