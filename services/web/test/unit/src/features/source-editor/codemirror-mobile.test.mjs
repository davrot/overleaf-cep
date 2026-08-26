// @vitest-environment jsdom
import Path from 'node:path'

import { describe, it, expect } from 'vitest'

// Force a "mobile" UA so module-scope `isMobileDevice` (and `browser`'s
// module-scope `ios`) resolve to `true` for this test's module graph.
// (No vi.mock needed — the import graph resolves identically on load.)
Object.defineProperty(globalThis, 'navigator', {
  value: { ...navigator, userAgent: 'Safari Mobile/16.0' },
  writable: true,
})

const MODULE_PATH = Path.join(
  import.meta.dirname,
  '../../../../../frontend/js/features/source-editor/extensions/keymaps'
)

const { keymaps, mobileKeymaps, currentKeymaps } = await import(MODULE_PATH)

/**
 * Asserts the mobile vs desktop CodeMirror keymaps diverge (mobile plan,
 * Phase 3).
 *
 * `keymaps` is the desktop binding set. `mobileKeymaps` additionally drops
 * Alt-family bindings because on-screen keyboards trigger AltGr for them
 * (plan Phase 3, `extensions/keymaps.ts`). `currentKeymaps()` is gated on
 * the module-scope `isMobileDevice` (re-exported as `isTouchInput`), a
 * coarse, non-reactive input signal (plan §5).
 */
describe('CodeMirror currentKeymaps (mobile plan, Phase 3)', () => {
  it('returns the mobile keymap extension when isMobileDevice is true', () => {
    // The forced mobile UA makes `isMobileDevice()` return `true` at this
    // module's evaluation, so `currentKeymaps()` returns `mobileKeymaps`.
    expect(currentKeymaps()).toBe(mobileKeymaps)
  })

  it('mobile keymaps are distinct from desktop keymaps', () => {
    // The mobile variant has Alt-* bindings filtered out at module
    // evaluation time; they must be distinct StateEffect objects.
    expect(mobileKeymaps).not.toBe(keymaps)
  })
})
