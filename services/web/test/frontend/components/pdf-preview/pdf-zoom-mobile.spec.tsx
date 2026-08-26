import PdfJsViewer from '../../../../frontend/js/features/pdf-preview/components/pdf-js-viewer'
import { PdfPreviewProvider } from '../../../../frontend/js/features/pdf-preview/components/pdf-preview-provider'
import { EditorProviders } from '../../helpers/editor-providers'
import { mockScope } from './scope'

/**
 * Mobile PDF zoom tap (mobile plan, Phase 9 step 5 + Phase 4 gate).
 *
 * At `cy.viewport(390, 844)` the real `useMobileLayout()` hook is active and
 * we mount the genuine `<PdfJsViewer/>` against the compiled PDF fixture
 * (`cy.interceptCompile`). The zoom controls portal into a
 * `#toolbar-pdf-controls` anchor (normally inside the pdf pane; here created
 * in the app frame). The plan's remaining step is asserted: tapping +/−
 * works and the zoom indicator changes — and no detach is attempted
 * (no `window.open`).
 *
 * Desktop zoom behaviour is unchanged; this spec only runs at mobile width.
 */
describe('Mobile PDF zoom tap (mobile plan, Phase 9 / 4)', function () {
  beforeEach(function () {
    cy.viewport(390, 844)
    // The <PdfViewerControlsToolbar/> portals into a `#toolbar-pdf-controls`
    // anchor that lives inside the pdf pane. Create that anchor here (360 px
    // wide so the full +/− controls branch matches the mobile pane).
    const anchor = document.createElement('div')
    anchor.id = 'toolbar-pdf-controls'
    anchor.style.width = '360px'
    document.body.appendChild(anchor)
    cy.window().then(win => {
      (win as any).__mobileZoomAnchor = anchor
    })
  })

  afterEach(function () {
    cy.window().then(win => {
      (win as any).__mobileZoomAnchor?.remove()
      delete (win as any).__mobileZoomAnchor
    })
  })

  function mountViewer() {
    cy.interceptCompile()

    const scope = mockScope()

    cy.mount(
      <EditorProviders scope={scope}>
        <PdfPreviewProvider>
          <div className="pdf-viewer">
            <PdfJsViewer url="/build/123/output.pdf?clsiserverid=foo" />
          </div>
        </PdfPreviewProvider>
      </EditorProviders>
    )

    cy.waitForCompile({ pdf: true })
    // Wait for the portal-mounted zoom indicator to appear.
    cy.get('#pdf-zoom-dropdown')
  }

  it('tap-target +/− zoom works and the zoom indicator changes', function () {
    mountViewer()

    cy.get('#pdf-zoom-dropdown')
      .invoke('text')
      .then(initialText => {
        const initial = Number(initialText.replace('%', '').trim())
        // `.pdfjs-zoom-controls` lays out [zoom-out, zoom-in, zoom dropdown].
        // Tap "zoom in".
        cy.get('.pdfjs-zoom-controls .pdfjs-toolbar-buttons button')
          .eq(1)
          .click()
        cy.get('#pdf-zoom-dropdown')
          .invoke('text')
          .then(updatedText => {
            const updated = Number(updatedText.replace('%', '').trim())
            expect(updated).to.be.greaterThan(initial)
          })
      })
  })

  it('does not attempt a detach (no window.open) on zoom tap', function () {
    mountViewer()

    cy.stub(window, 'open').as('openWindow')
    // Tap zoom-in then zoom-out.
    cy.get('.pdfjs-zoom-controls .pdfjs-toolbar-buttons button')
      .eq(1)
      .click()
    cy.get('.pdfjs-zoom-controls .pdfjs-toolbar-buttons button')
      .eq(0)
      .click()

    cy.get('@openWindow').should('not.have.been.called')
  })
})
