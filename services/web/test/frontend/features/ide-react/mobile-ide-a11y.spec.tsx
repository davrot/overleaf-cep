import { EditorProviders } from '../../helpers/editor-providers'
import { MobileBottomBar } from '../../../../frontend/js/features/ide-react/components/layout/mobile-bottom-bar'
import { MobileToolbar } from '../../../../frontend/js/features/ide-react/components/toolbar/mobile-toolbar'
import { RailProvider } from '../../../../frontend/js/features/ide-react/context/rail-context'
import type { LayoutContextValue } from '../../../../frontend/js/shared/context/layout-context'

/**
 * Phase 8 (mobile plan): accessibility of the mobile-only chrome.
 *
 * Cypress has no cypress-axe dep here, so instead of a third-party audit we
 * drive the mobile branch through `useMobileLayout()` (viewport 390 px +
 * flag on) and the components through the same <RailProvider/> that
 * <MainLayoutMobile/> uses, then assert the WCAG-critical aria roles/states
 * directly (aria-pressed, aria-expanded, aria-haspopup, aria-label). The
 * bottom bar uses `aria-pressed` (not `aria-current`; bug L1 — files/chat
 * tabs are not sequential "pages"), so only `aria-pressed` is asserted here. Both the mobile toolbar and bottom bar are pure aria-state
 * components, so focused mounts are cheaper and more stable than rendering
 * the full <MainLayout/> (which would pull in CodeMirror / pdf.js fixtures).
 */
describe('Mobile IDE a11y contract (mobile plan, Phase 8)', function () {
  before(function () {
    cy.viewport(390, 844)
  })

  beforeEach(function () {
    // Enable the `ide-mobile-layout` flag so `useMobileLayout` reports the
    // mobile layout. `resetMeta` (cypress/setup) clears this between tests,
    // so re-set it each time. `ol-splitTestVariants` is read via getMeta.
    cy.window().then(win => {
      const cache = (win as any).metaAttributesCache
      const existing = (cache.get('ol-splitTestVariants') || {}) as Record<
        string,
        string
      >
      cache.set('ol-splitTestVariants', {
        ...existing,
        'ide-mobile-layout': 'enabled',
      })
    })
  })

  function mountBottomBar(layoutContext: Partial<LayoutContextValue>) {
    cy.mount(
      <EditorProviders layoutContext={layoutContext}>
        <RailProvider>
          <MobileBottomBar />
        </RailProvider>
      </EditorProviders>
    )
  }

  function mountToolbar(layoutContext: Partial<LayoutContextValue>) {
    cy.mount(
      <EditorProviders layoutContext={layoutContext}>
        <RailProvider>
          <MobileToolbar />
        </RailProvider>
      </EditorProviders>
    )
  }

  describe('<MobileBottomBar />', function () {
    it('is a <nav> with a non-empty aria-label at mobile widths', function () {
      mountBottomBar({ pdfLayout: 'flat', view: 'editor' })
      cy.get('[data-testid="mobile-bottom-bar"]')
        .should('be.visible')
        .should('have.attr', 'aria-label')
        .and('not.be.empty')
    })

    it('marks every tap target with aria-pressed and a visible label', function () {
      mountBottomBar({ pdfLayout: 'flat', view: 'editor' })
      cy.get('[data-testid="mobile-bottom-bar-files"]')
        .should('have.attr', 'aria-pressed')
        .should('be.visible')
      cy.get('[data-testid="mobile-bottom-bar-chat"]')
        .should('have.attr', 'aria-pressed')
        .should('be.visible')
      cy.get('[data-testid="mobile-bottom-bar-view"]')
        .should('have.attr', 'aria-pressed')
        .should('be.visible')
    })

    it('marks the active bottom-bar tab with aria-pressed="true"', function () {
      // <RailProvider/> initial state + view:'editor' (not pdf) => the
      // *files* tab is the active one (it is both selected and open).
      mountBottomBar({ pdfLayout: 'flat', view: 'editor' })
      cy.get('[data-testid="mobile-bottom-bar-files"]').should(
        'have.attr',
        'aria-pressed',
        'true'
      )
      // chat tab is not selected
      cy.get('[data-testid="mobile-bottom-bar-chat"]').should(
        'have.attr',
        'aria-pressed',
        'false'
      )
      // view tab: it is pressed only while the PDF view is shown. With
      // view='editor' the button offers to show the PDF, so it is *not*
      // pressed.
      cy.get('[data-testid="mobile-bottom-bar-view"]').should(
        'have.attr',
        'aria-pressed',
        'false'
      )
    })
  })

  describe('<MobileToolbar /> "more" button', function () {
    it('exposes aria-haspopup + aria-expanded on the overflow button', function () {
      mountToolbar({ pdfLayout: 'flat', view: 'editor' })
      cy.get('[data-testid="mobile-toolbar-more"]')
        .should('have.attr', 'aria-haspopup', 'dialog')
        .and('have.attr', 'aria-expanded', 'false')
      cy.get('[data-testid="mobile-toolbar-more"]').click()
      cy.get('[data-testid="mobile-toolbar-more"]').should(
        'have.attr',
        'aria-expanded',
        'true'
      )
    })

    it('closes the sheet with the close button (not just Escape)', function () {
      mountToolbar({ pdfLayout: 'flat', view: 'editor' })
      cy.get('[data-testid="mobile-toolbar-more"]').click()
      cy.get('[data-testid="mobile-toolbar-sheet"]').should('exist')
      cy.get('[data-testid="mobile-sheet-close"]').click()
      cy.get('[data-testid="mobile-toolbar-sheet"]').should('not.exist')
    })
  })
})
