import { expect } from 'chai'

import {
  getEffectivePdfLayout,
  PDF_LAYOUT_STORAGE_KEY,
} from '../../../../frontend/js/shared/utils/mobile-viewport'

describe('getEffectivePdfLayout (mobile plan, Phase 0)', function () {
  it("initializes 'sideBySide' on desktop (byte-for-byte with pre-mobile behavior)", function () {
    // Desktop initialization must not change (hard constraint in MOBILE_PLAN.md):
    // the initial pdfLayout is always 'sideBySide', and the persisted
    // `pdf.layout` entry is write-only on desktop.
    expect(getEffectivePdfLayout(false)).to.equal('sideBySide')
  })

  it("forces 'flat' when the mobile layout is active", function () {
    // On mobile the persisted desktop value (whatever it is) must be
    // ignored — mobile is always single-pane.
    expect(getEffectivePdfLayout(true)).to.equal('flat')
  })

  it('exported storage key matches the key written by layout-context', function () {
    // `setLayoutInLocalStorage` writes `pdf.layout` (as 'split'/'flat'); the
    // mobile helper must use the same key or localStorage silently breaks.
    expect(PDF_LAYOUT_STORAGE_KEY).to.equal('pdf.layout')
  })
})
