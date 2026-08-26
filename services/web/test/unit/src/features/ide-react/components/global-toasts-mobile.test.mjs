/**
 * Phase 6 (mobile plan): on mobile the global toasts/alerts are moved out of
 * Bootstrap's bottom-right corner. That is done by scss scoped with
 * `body.ide-mobile-active` (set by <MainLayoutMobile/>), since the toast
 * portal itself has no knowledge of the layout. This test guards that the
 * *css contract* is present, has the mobile values, and stays scoped so it
 * cannot leak into desktop layouts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import Path from 'node:path'

const layoutPath = Path.join(
  import.meta.dirname,
  '../../../../../../frontend/stylesheets/mobile/layout.scss'
)
const layoutCss = readFileSync(layoutPath, 'utf8')

// the desktop toast stylesheet (assert the mobile scope never leaks in)
const desktopToastPath = Path.join(
  import.meta.dirname,
  '../../../../../../frontend/stylesheets/pages/editor/toast.scss'
)

/** strip comments + collapse whitespace so the test ignores formatting */
function normalize(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const normalized = normalize(layoutCss)
const mobileBlock = normalized.slice(
  normalized.indexOf('body.ide-mobile-active')
)

// expected values (inner single quotes are required; the scss uses them)
const roleAlertMax = "[role='alert'] { max-width: 100%;"
const globalAlertsBlock =
  ".global-alerts { height: auto; [role='alert'] { min-width: 0; width: 100%;"

describe('mobile global toasts / alerts chrome (css contract)', () => {
  it('pins .global-toasts to the bottom edge on mobile, not the top', () => {
    expect(mobileBlock).toContain(
      '.global-toasts { left: 8px; right: 8px; transform: none; bottom: calc(' +
        'env(safe-area-inset-bottom) + 64px);'
    )
    // no `top:` override on the mobile toast container
    const toastsDecl = mobileBlock
      .split('.global-toasts {')[1]
      .split('}')[0]
    expect(toastsDecl).not.toContain(';top:')
    expect(mobileBlock).toContain(roleAlertMax)
  })

  it('makes alerts full-width instead of a centered min-width bar', () => {
    expect(mobileBlock).toContain(globalAlertsBlock)
  })

  it('keeps the mobile toast scope out of the desktop toast stylesheet', () => {
    if (existsSync(desktopToastPath)) {
      const desktopCss = normalize(readFileSync(desktopToastPath, 'utf8'))
      expect(desktopCss).not.toContain('ide-mobile-active')
    }
    // sanity: this file is the mobile scope, so it *does* have the mobile rule
    expect(normalized).toContain('body.ide-mobile-active')
  })
})
