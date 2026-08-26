// @vitest-environment jsdom
import Path from 'node:path'

import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'

const store = vi.hoisted(() => ({ isEnabled: false, detachRole: undefined }))

vi.mock('../../../../../frontend/js/shared/context/layout-context', () => ({
  useLayoutContext: () => ({ detachRole: store.detachRole }),
}))

vi.mock(
  '../../../../../frontend/js/shared/hooks/use-mobile-layout',
  () => ({
    useMobileLayout: () => ({ isEnabled: store.isEnabled }),
  })
)

// Keep the test isolated from the synctex module's heavy import graph:
vi.mock(
  '../../../../../frontend/js/features/pdf-preview/components/pdf-synctex-controls',
  () => ({
    default: function MockPdfSynctexControls() {
      return createElement('span', { 'data-testid': 'mock-synctex' })
    },
  })
)

const {
  DefaultSynctexControl,
} = await import(
  Path.join(
    import.meta.dirname,
    '../../../../../frontend/js/features/pdf-preview/components/detach-synctex-control'
  )
)

/**
 * Phase 4 (mobile plan): synctex (double-click sync) is meaningless without
 * a side-by-side split, so `<DefaultSynctexControl/>` must not render it
 * when the mobile layout is active.
 */
describe('<DefaultSynctexControl /> (mobile plan, Phase 4)', () => {
  it('renders the synctex controls on desktop (detachRole unset)', () => {
    store.isEnabled = false
    store.detachRole = undefined
    const { container } = render(createElement(DefaultSynctexControl))
    expect(
      container.querySelector('[data-testid="mock-synctex"]')
    ).not.toBeNull()
  })

  it('does not render the synctex controls when detachRole is set', () => {
    store.isEnabled = false
    store.detachRole = 'detacher'
    const { container } = render(createElement(DefaultSynctexControl))
    expect(container.querySelector('[data-testid="mock-synctex"]')).toBeNull()
  })

  it('does not render the synctex controls when the mobile layout is active', () => {
    store.isEnabled = true
    store.detachRole = undefined
    const { container } = render(createElement(DefaultSynctexControl))
    expect(container.querySelector('[data-testid="mock-synctex"]')).toBeNull()
  })
})
