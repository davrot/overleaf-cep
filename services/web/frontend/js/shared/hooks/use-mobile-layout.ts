/*
 * use-mobile-layout provides the source of truth for "mobile IDE" layout.
 *
 * - `isMobileLayout`: true when the viewport is below Bootstrap's `md`
 *   breakpoint (max-width: 767.98px) AND the `ide-mobile-layout` feature
 *   flag is enabled. Drives the mobile layout (single pane, drawer rail,
 *   bottom bar). It is a client-only signal: initialized from matchMedia so
 *   the first render is correct, updated on `change`.
 * - `isDevMobileMode`: true when a `?mobileLayout=true` query param is
 *   present AND the flag is enabled (dev/QA override, e.g. to force the
 *   mobile layout in cypress on a wide viewport).
 * - `isTouchInput`: true when the device uses touch input (regardless of
 *   viewport width). Drives touch-tuned input config (CodeMirror keymap,
 *   tap targets, context menu). Re-uses the existing `isMobileDevice()`.
 * - `isEnabled`: the flag the rest of the IDE branches on:
 *   `isMobileLayout || isDevMobileMode`.
 *
 * See MOBILE_PLAN.md, Phase 0.
 */

import { useEffect, useState } from 'react'
import { isMobileDevice } from '@/features/source-editor/utils/isMobileDevice'
import { useFeatureFlag } from '../context/split-test-context'

// Bootstrap `md` breakpoint (mobile = < 768 px), see MOBILE_PLAN.md §2.1.
export const MOBILE_LAYOUT_MATCH_MEDIA_QUERY = '(max-width: 767.98px)'
const IDE_MOBILE_LAYOUT_FLAG = 'ide-mobile-layout'

// The `?mobileLayout=true` param is a dev/QA override (guarded by the flag).
function getDevMobileMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const params = new URLSearchParams(window.location.search)
  return params.get('mobileLayout') === 'true'
}

// `isMobileDevice` is not SSR safe (it touches navigator); guard for SSR.
// Computed per call so it is re-evaluated on each hook render (it is a cheap
// `navigator`/`matchMedia` check) rather than frozen at module import time
// (bug M6).
function getIsTouchInput(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return isMobileDevice()
}

function getInitialMobileLayout(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.matchMedia(MOBILE_LAYOUT_MATCH_MEDIA_QUERY).matches
}

export function useMobileLayout() {
  const [isMobileLayoutViewport, setIsMobileLayoutViewport] = useState(
    getInitialMobileLayout
  )
  const [isDevMobileMode, setIsDevMobileMode] = useState(getDevMobileMode)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_LAYOUT_MATCH_MEDIA_QUERY)
    const update = () => {
      setIsMobileLayoutViewport(mql.matches)
      setIsDevMobileMode(getDevMobileMode())
    }
    update()
    mql.addEventListener('change', update)
    return () => {
      mql.removeEventListener('change', update)
    }
  }, [])

  const flagEnabled = useFeatureFlag(IDE_MOBILE_LAYOUT_FLAG)

  // The flag gates everything: when it is disabled the mobile layout is
  // dead code (desktop rendering is unchanged).
  const isTouchInput = getIsTouchInput()
  const isMobileLayout = flagEnabled && isMobileLayoutViewport
  const devMobileMode = flagEnabled && isDevMobileMode

  return {
    isMobileLayout,
    isTouchInput,
    isDevMobileMode: devMobileMode,
    isEnabled: isMobileLayout || devMobileMode,
  }
}
