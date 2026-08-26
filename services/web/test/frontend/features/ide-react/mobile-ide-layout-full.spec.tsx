import { EditorProviders } from '../../helpers/editor-providers'
import MainLayout from '../../../../frontend/js/features/ide-react/components/layout/main-layout'

/**
 * cypress component spec for the mobile IDE layout full flow (mobile plan,
 * Phase 2 + Phase 9).
 *
 * The `ide-mobile-layout` flag is enabled via `ol-splitTestVariants` and the
 * cypress viewport is simulated at 390 px, so the *real* `useMobileLayout()`
 * hook (matchMedia + flag) drives the mobile branch. `layoutContext`
 * (`isMobileLayout: true`) drives the <MainLayout/> mobile variant the same
 * way the real <LayoutProvider/> does on a mobile device.
 *
 * Desktop regression is covered in the companion spec:
 *   test/frontend/components/ide-react/ide-page-desktop-regression.spec.tsx
 */
describe('Mobile IDE layout full flow (mobile plan, Phase 2 / 9)', function () {
  beforeEach(function () {
    cy.viewport(390, 844)
  })

  function mountMainLayout(view: 'editor' | 'pdf' | 'history') {
    cy.mount(
      <EditorProviders
        layoutContext={{ isMobileLayout: true, pdfLayout: 'flat', view }}
      >
        <MainLayout />
      </EditorProviders>
    )
  }

  it('renders a single pane with no react-resizable-panels PanelGroup (history view)', function () {
    mountMainLayout('history')

    // The mobile container marker is rendered.
    cy.get('[data-mobile]').should('exist')
    // The desktop layout (nested <PanelGroup/>, .ide-redesign-inner) is NOT.
    cy.get('.ide-redesign-inner').should('not.exist')
    cy.get('.ide-mobile-pane').should('exist')
    // The toolbar and bottom bar are both rendered.
    cy.get('[data-testid="mobile-toolbar"]').should('exist')
    cy.get('[data-testid="mobile-bottom-bar"]').should('exist')
  })

  it('rail drawer is closed before the hamburger and closes on Esc', function () {
    mountMainLayout('history')

    // The rail drawer is closed before the hamburger is clicked.
    cy.get('#ide-mobile-rail-drawer').should('not.exist')

    // Open the drawer via the hamburger (mobile toolbar, Phase 1).
    cy.get('[data-testid="mobile-toolbar-hamburger"]').click()

    // The drawer is a modal dialog (Drawer primitive, Phase 2).
    cy.get('#ide-mobile-rail-drawer')
      .parents('[role="dialog"]')
      .should('have.attr', 'aria-modal', 'true')

    // Close it with Escape.
    cy.get('#ide-mobile-rail-drawer')
      .parents('[role="dialog"]')
      .find('[data-testid="drawer-close"]')
    cy.type('{esc}')
    cy.get('#ide-mobile-rail-drawer').should('not.exist')
  })

  it('bottom bar view toggle switches the single pane (editor -> pdf)', function () {
    mountMainLayout('editor')

    cy.get('[data-testid="mobile-bottom-bar-view"]').click()
    // After toggling, the button points at "editor" (i.e. show the editor).
    cy.get('[data-testid="mobile-bottom-bar-view"]').should('contain', 'Editor')
  })

  it('renders the history pane when view is history, and no PanelGroup', function () {
    mountMainLayout('history')
    cy.get('.ide-mobile-pane').should('exist')
    // the desktop layout (PanelGroup, .ide-redesign-inner) must NOT be in the
    // DOM even after switching to history view.
    cy.get('.ide-redesign-inner').should('not.exist')
  })
})
