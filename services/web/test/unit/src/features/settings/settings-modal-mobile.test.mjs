/**
 * Phase 6 (mobile plan): on mobile, modals (including the settings modal)
 * become full-height bottom sheets. Bootstrap modal + backdrop are portaled
 * to <body>, so the styling is scss scoped with `body.ide-mobile-active`
 * (set by <MainLayoutMobile/>). This test guards that the *css contract* is
 * present and correctly scoped (so it can't leak into desktop).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import Path from 'node:path'

const layoutPath = Path.join(
  import.meta.dirname,
  '../../../../../frontend/stylesheets/mobile/layout.scss'
)
const layoutCss = readFileSync(layoutPath, 'utf8')

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

describe('mobile modal (settings/bottom-sheet) chrome (css contract)', () => {
  it('turns .modal into a full-height sheet on mobile', () => {
    const modalDecl = mobileBlock
      .split('.modal {')[1]
      .split('.modal-dialog {')[0]
    expect(modalDecl).toContain('height: 100dvh')
    expect(modalDecl).toContain('overflow: hidden')
  })

  it('drops the max-width clamp so .modal-dialog spans the viewport', () => {
    const dialogDecl = mobileBlock
      .split('.modal-dialog {')[1]
      .split('}')[0]
    expect(dialogDecl).toContain('max-width: none')
    expect(dialogDecl).toContain('width: 100%')
  })

  it('lets .modal-body scroll while the footer pins to the bottom safe area', () => {
    const contentBlock = mobileBlock.split('.modal-content {')[1]
    // body scrolls
    expect(contentBlock).toContain('.modal-body { overflow: auto; flex: 1 1 auto')
    // footer clears the home indicator (safe-area)
    expect(contentBlock).toContain(
      '.modal-footer { padding-bottom: calc(env(safe-area-inset-bottom) + 0.75rem);'
    )
  })

  it('keeps the mobile modal scope in the mobile stylesheet only', () => {
    // the mobile rules live here
    expect(normalized).toContain('body.ide-mobile-active')
    // header is a touch target
    const contentBlock = mobileBlock.split('.modal-content {')[1]
    expect(contentBlock).toContain('.modal-header { min-height: 48px')
  })
})
