import { expect } from 'chai'
import { createElement, act } from 'react'
import { renderHook } from '@testing-library/react'

import { useMobileLayout } from '../../../../frontend/js/shared/hooks/use-mobile-layout'
import {
  SplitTestContext,
} from '../../../../frontend/js/shared/context/split-test-context'

/**
 * Unit test for `use-mobile-layout.ts` (mobile plan, Phase 0).
 *
 * The hook combines three inputs, all of which are under test control here:
 *   - the `ide-mobile-layout` feature flag (via `useFeatureFlag`, driven by
 *     the `SplitTestContext.Provider` wrapper)
 *   - `window.matchMedia('(max-width: 767.98px)')` → `isMobileLayout`
 *   - a `?mobileLayout=true` location param → `isDevMobileMode` (dev/QA)
 *
 * The *real* hook module is exercised with a controllable matchMedia stub.
 */

type MatchMediaListener = (event: MediaQueryListEvent) => void

interface MatchMediaStub {
  set: (matches: boolean) => void
  fireChange: () => void
}

describe('useMobileLayout (mobile plan, Phase 0)', function () {
  let stub: MatchMediaStub

  function installMatchMedia(initialMatches: boolean): MatchMediaStub {
    const state: { value: boolean; listeners: MatchMediaListener[] } = {
      value: initialMatches,
      listeners: [],
    }
    const mql: unknown = {
      media: '(max-width: 767.98px)',
      get matches() {
        return state.value
      },
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
      addEventListener: (type: string, listener: MatchMediaListener) => {
        if (type === 'change') {
          state.listeners.push(listener)
        }
      },
      removeEventListener: (type: string, listener: MatchMediaListener) => {
        if (type === 'change') {
          const i = state.listeners.indexOf(listener)
          if (i !== -1) {
            state.listeners.splice(i, 1)
          }
        }
      },
    }
    window.matchMedia = () => (mql as MediaQueryList)
    return {
      set(matches: boolean) {
        state.value = matches
      },
      fireChange() {
        const event: MediaQueryListEvent = {
          matches: state.value,
        } as MediaQueryListEvent
        state.listeners.forEach(listener => listener(event))
      },
    }
  }

  function renderHookWithFlag(
    flagEnabled: boolean,
    render: () => ReturnType<typeof useMobileLayout>
  ) {
    return renderHook(() => render(), {
      wrapper: (props) =>
        createElement(SplitTestContext.Provider, {
          value: {
            splitTestVariants: {
              'ide-mobile-layout': flagEnabled ? 'enabled' : 'disabled',
            },
            splitTestInfo: {},
          },
        }, props.children),
    })
  }

  beforeEach(function () {
    window.history.replaceState({}, '', '/')
    stub = installMatchMedia(false)
  })

  it('isMobileLayout is true at 375 px (matchMedia matches) when the flag is enabled', function () {
    stub.set(true)
    const { result } = renderHookWithFlag(true, () => useMobileLayout())
    expect(result.current.isMobileLayout).to.equal(true)
    expect(result.current.isEnabled).to.equal(true)
    expect(result.current.isDevMobileMode).to.equal(false)
  })

  it('isMobileLayout is false on a wide (desktop) viewport even with the flag enabled', function () {
    const { result } = renderHookWithFlag(true, () => useMobileLayout())
    expect(result.current.isMobileLayout).to.equal(false)
    expect(result.current.isEnabled).to.equal(false)
  })

  it('isMobileLayout is false when the flag is disabled even at mobile viewport', function () {
    stub.set(true)
    const { result } = renderHookWithFlag(false, () => useMobileLayout())
    expect(result.current.isMobileLayout).to.equal(false)
  })

  it('re-evaluates on matchMedia `change` (resize)', function () {
    const { result } = renderHookWithFlag(true, () => useMobileLayout())
    act(() => {
      stub.set(true)
      stub.fireChange()
    })
    expect(result.current.isMobileLayout).to.equal(true)
    act(() => {
      stub.set(false)
      stub.fireChange()
    })
    expect(result.current.isMobileLayout).to.equal(false)
  })

  it('isDevMobileMode enables the layout via ?mobileLayout=true (flag ON)', function () {
    window.history.replaceState({}, '', '/?mobileLayout=true')
    const { result } = renderHookWithFlag(true, () => useMobileLayout())
    expect(result.current.isDevMobileMode).to.equal(true)
    expect(result.current.isMobileLayout).to.equal(false)
    expect(result.current.isEnabled).to.equal(true)
  })

  it('isDevMobileMode is inert when the flag is disabled', function () {
    window.history.replaceState({}, '', '/?mobileLayout=true')
    const { result } = renderHookWithFlag(false, () => useMobileLayout())
    expect(result.current.isDevMobileMode).to.equal(false)
    expect(result.current.isEnabled).to.equal(false)
  })
})
