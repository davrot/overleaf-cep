import { describe, it, expect } from 'vitest'
import {
  blankDiagram,
  stripBrandingComments,
  toSvgDocument,
} from '../../../frontend/js/util/diagram-model.ts'

describe('blankDiagram', function () {
  it('produces a standalone, well-formed empty SVG with dimensions', function () {
    const svg = blankDiagram()
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /)
    expect(svg).toMatch(/width="842" height="595"/)
    expect(svg).toMatch(/viewBox="0 0 842 595"><\/svg>$/)
    expect(svg.trim()).not.toContain('maxGraph')
  })

  it('honours explicit dimensions', function () {
    const svg = blankDiagram(100, 50)
    expect(svg).toContain('width="100" height="50"')
    expect(svg).toContain('viewBox="0 0 100 50"')
  })
})

describe('toSvgDocument', function () {
  it('returns null for empty / whitespace / null content', function () {
    expect(toSvgDocument('')).toBeNull()
    expect(toSvgDocument('   \n  ')).toBeNull()
    expect(toSvgDocument(null)).toBeNull()
    expect(toSvgDocument(undefined)).toBeNull()
  })

  it('accepts a bare <svg> document unchanged (trimmed)', function () {
    const doc = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'
    expect(toSvgDocument(`  \n${doc}\n  `)).toEqual(doc)
    expect(toSvgDocument(doc)).toEqual(doc)
  })

  it('accepts an <svg> document with content', function () {
    const doc =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#ffffff" stroke="#000000"/></svg>'
    expect(toSvgDocument(doc)).toEqual(doc)
  })

  it('returns null for non-SVG content (e.g. legacy model XML)', function () {
    expect(toSvgDocument('<mxGraphModel><root/></mxGraphModel>')).toBeNull()
    expect(toSvgDocument('plain text document')).toBeNull()
  })
})

describe('stripBrandingComments', function () {
  it('removes "Created with" tool comments', function () {
    const svg =
      '<svg><!-- Created with SVG-edit (www.svg-edit.org) --><rect/></svg>'
    expect(stripBrandingComments(svg)).toEqual('<svg><rect/></svg>')
  })

  it('leaves other comments and content untouched', function () {
    const svg = '<svg><!-- keep me --><title>x</title></svg>'
    expect(stripBrandingComments(svg)).toEqual(svg)
  })
})
