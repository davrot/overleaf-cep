/*
 * Mobile viewport default: on mobile layouts, the PDF pane cannot be
 * side-by-side (there is only one pane on screen). The `pdf.layout`
 * localStorage entry written by a desktop session must be ignored on a
 * mobile load. See the mobile plan (MOBILE_PLAN.md), Phase 0.
 *
 * NOTE (hard constraint): desktop initialization must stay byte-for-byte
 * with pre-mobile code, i.e. the initial `pdfLayout` is ALWAYS
 * `'sideBySide'` (the storage key is only ever *written*, never *read*,
 * on desktop). This helper must therefore not make the layout
 * persistent either.
 *
 * This is a pure helper so it can be unit tested without mounting React.
 */

export const PDF_LAYOUT_STORAGE_KEY = 'pdf.layout'

/**
 * Initial `pdfLayout` for a given layout mode.
 * - Desktop: always 'sideBySide' (unchanged from before the mobile plan).
 * - Mobile: always 'flat' (single-pane; a persisted desktop
 *   'sideBySide'/'split' value is ignored).
 */
export function getEffectivePdfLayout(
  isMobileLayout: boolean
): 'sideBySide' | 'flat' {
  return isMobileLayout ? 'flat' : 'sideBySide'
}
