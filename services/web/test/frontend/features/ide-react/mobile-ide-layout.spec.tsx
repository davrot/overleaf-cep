import { EditorProviders } from '../../helpers/editor-providers'
import { Toolbar } from '../../../../frontend/js/features/ide-react/components/toolbar/toolbar'
import { MobileBottomBar } from '../../../../frontend/js/features/ide-react/components/layout/mobile-bottom-bar'

/**
 * cypress component spec for the mobile IDE layout (mobile plan, Phase 9).
 *
 * The `ide-mobile-layout` flag is enabled via `ol-splitTestVariants` and the
 * cypress viewport is simulated at 390 px, so the *real*
 * `useMobileLayout()` hook (matchMedia + flag) drives the mobile branch —
 * not just the mocked LayoutContext value. Both sides are asserted:
 *   - the real hook drives <Toolbar/> (mobile toolbar is rendered)
 *   - the mocked LayoutContext value drives <MainLayout/> consumers
 *     (`MobileBottomBar` is an additive component mounted by
 *     `<MainLayoutMobile/>`; here it is mounted standalone so it stays
 *     isolated).
 *
 * Desktop regression is covered in the companion spec:
 *   test/frontend/components/ide-react/ide-page-desktop-regression.spec.tsx
 */
describe('Mobile IDE layout (mobile plan, Phase 9)', function () {
  beforeEach(function () {
    // Enable the flag so `useMobileLayout()` is active at any viewport.
    cy.window().then(win => {
      // @ts-ignore - metaAttributesCache is set up by cypress/support
      win.metaAttributesCache.set('ol-splitTestVariants', {
        'ide-mobile-layout': 'enabled',
      })
      // @ts-ignore
      win.metaAttributesCache.set('ol-splitTestInfo', {})
    })
    // Simulated iPhone 14 portrait (below Bootstrap `md`).
    cy.viewport(390, 844)
  })

  // eslint-disable-next-line no-undef
  it('Toolbar: renders the mobile toolbar (hamburger + project title + more) when isMobileLayout', function () {
    cy.mount(
      <EditorProviders layoutContext={{ isMobileLayout: true, pdfLayout: 'flat', view: 'editor' }}>
        <Toolbar />
        <MobileBottomBar />
      </EditorProviders>
    )

    cy.get('[data-testid="mobile-toolbar"]').should('exist')
    cy.get('[data-testid="mobile-toolbar-hamburger"]').should('exist')
    cy.get('[data-testid="mobile-toolbar-more"]').should('exist')
  })

  it('MobileBottomBar: renders Files / Chat / view toggle', function () {
    cy.mount(
      <EditorProviders layoutContext={{ isMobileLayout: true, pdfLayout: 'flat', view: 'editor' }}>
        <MobileBottomBar />
      </EditorProviders>
    )

    cy.get('[data-testid="mobile-bottom-bar"].nav, [data-testid="mobile-bottom-bar"]').should('exist')
    cy.get('[data-testid="mobile-bottom-bar-files"]').should('exist')
    cy.get('[data-testid="mobile-bottom-bar-chat"]').should('exist')
  })

  it('MobileBottomBar: toggles the view between editor and pdf', function () {
    cy.mount(
      <EditorProviders layoutContext={{ isMobileLayout: true, pdfLayout: 'flat', view: 'editor' }}>
        <MobileBottomBar />
      </EditorProviders>
    )

    cy.get('[data-testid="mobile-bottom-bar-view"]').click()
    // After toggling, the button points at "editor" (i.e. show the editor).
    cy.get('[data-testid="mobile-bottom-bar-view"]').should('contain', 'Editor')
  })
})
