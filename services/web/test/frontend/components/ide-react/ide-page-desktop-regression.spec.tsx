import { EditorProviders } from '../../helpers/editor-providers'
import { Toolbar } from '../../../../frontend/js/features/ide-react/components/toolbar/toolbar'

/**
 * Desktop regression spec (mobile plan, Phase 9).
 *
 * When `isMobileLayout === false` (flag disabled / wide viewport) the IDE
 * must render the desktop toolbar with none of the mobile chrome. This guards
 * the additive mobile branch: it must be a no-op at `md` and above.
 */
describe('IDE desktop layout regression (mobile plan, Phase 9)', function () {
  // Simulated desktop width (above Bootstrap `md`, 992 px+).
  beforeEach(function () {
    cy.viewport(1200, 900)
  })

  it('does NOT render the mobile toolbar on a desktop viewport', function () {
    cy.mount(
      <EditorProviders layoutContext={{ pdfLayout: 'sideBySide', view: 'editor' }}>
        <Toolbar />
      </EditorProviders>
    )

    // Mobile chrome must be fully absent.
    cy.get('[data-testid="mobile-toolbar"]').should('not.exist')
    cy.get('[data-testid="mobile-toolbar-hamburger"]').should('not.exist')
    cy.get('[data-testid="mobile-toolbar-more"]').should('not.exist')
    cy.get('[data-testid="mobile-bottom-bar"]').should('not.exist')
    cy.get('.ide-mobile-bottom-bar').should('not.exist')

    // The desktop toolbar IS present (desktop branch is unchanged).
    cy.get('.ide-redesign-toolbar').should('exist')
    // Desktop-only control (never rendered by <MobileToolbar/>).
    cy.findByRole('button', { name: 'Layout options' }).should('exist')
  })

  it('does NOT render any data-mobile marker on a desktop viewport', function () {
    cy.mount(
      <EditorProviders layoutContext={{ pdfLayout: 'sideBySide', view: 'editor' }}>
        <Toolbar />
      </EditorProviders>
    )

    cy.get('[data-mobile]').should('not.exist')
  })
})
