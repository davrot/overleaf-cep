import { describe, it, expect } from 'vitest'
import {
  pxToPt,
  A4_PT,
  pdfPageSize,
  fitContent,
} from '../../../frontend/js/util/diagram-export.ts'

describe('pxToPt', function () {
  it('converts CSS pixels to points at 96dpi (0.75 pt per px)', function () {
    expect(pxToPt(96)).toEqual(72)
    expect(pxToPt(400)).toEqual(300)
    expect(pxToPt(300)).toEqual(225)
    expect(pxToPt(1)).toBeCloseTo(0.75)
  })
})

describe('pdfPageSize', function () {
  it('uses the SVG width/height as the page size', function () {
    const p = pdfPageSize('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>')
    expect(p).toEqual({ w: 300, h: 225, fallback: false })
  })

  it('accepts px-suffixed dimensions', function () {
    const p = pdfPageSize('<svg width="200px" height="100px"></svg>')
    expect(p).toEqual({ w: 150, h: 75, fallback: false })
  })

  it('falls back to the viewBox for width/height', function () {
    const p = pdfPageSize('<svg viewBox="0 0 50 50"></svg>')
    expect(p).toEqual({ w: 37.5, h: 37.5, fallback: false })
  })

  it('returns the A4 fallback for SVGs without usable dimensions', function () {
    expect(pdfPageSize('<svg></svg>')).toEqual({
      w: A4_PT.w,
      h: A4_PT.h,
      fallback: true,
    })
    expect(pdfPageSize('<svg width="0" height="0"></svg>').fallback).toBe(true)
    expect(pdfPageSize('').fallback).toBe(true)
  })
})

describe('fitContent', function () {
  const PW = A4_PT.w
  const PH = A4_PT.h
  const M = 25

  it('fits landscape content to the page width, centred', function () {
    const box = fitContent(PW, PH, M, 4 / 3)
    expect(box.x).toEqual(M)
    expect(box.y).toEqual(M)
    expect(box.w).toBeCloseTo(PW - 2 * M)
    expect(box.h).toBeCloseTo((PW - 2 * M) / (4 / 3))
  })

  it('fits portrait content to the page height, centred', function () {
    // 2/3 < maxW/maxH (≈0.711) ⇒ height-constrained
    const box = fitContent(PW, PH, M, 2 / 3)
    expect(box.h).toBeCloseTo(PH - 2 * M)
    expect(box.w).toBeCloseTo((PH - 2 * M) * (2 / 3))
  })

  it('keeps width-constrained content for mild portrait ratios', function () {
    const box = fitContent(PW, PH, M, 3 / 4)
    expect(box.w).toBeCloseTo(PW - 2 * M)
    expect(box.h).toBeCloseTo((PW - 2 * M) / (3 / 4))
  })

  it('treats a missing ratio as 1:1', function () {
    const box = fitContent(PW, PH, M, null)
    expect(box.w).toBeCloseTo(box.h)
  })
})
