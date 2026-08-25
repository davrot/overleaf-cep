import { describe, it, expect } from 'vitest'
import { EMPTY_DIAGRAM, toModelXml } from '../../../frontend/js/util/drawio-model.ts'

describe('EMPTY_DIAGRAM', function () {
  it('is a valid mxGraphModel document with the mandatory root cells', function () {
    expect(EMPTY_DIAGRAM).toMatch(/^<mxGraphModel\b/)
    expect(EMPTY_DIAGRAM).toMatch(/<\/mxGraphModel>$/)
    expect(EMPTY_DIAGRAM).toMatch(/<mxCell id="0"\/>/)
    expect(EMPTY_DIAGRAM).toMatch(/<mxCell id="1" parent="0"\/>/)
  })
})

describe('toModelXml', function () {
  it('returns null for empty / whitespace / null content', function () {
    expect(toModelXml('')).toBeNull()
    expect(toModelXml('   \n  ')).toBeNull()
    expect(toModelXml(null)).toBeNull()
    expect(toModelXml(undefined)).toBeNull()
  })

  it('accepts a bare mxGraphModel document unchanged (trimmed)', function () {
    const model =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'
    expect(toModelXml(`  \n${model}\n  `)).toEqual(model.trim())
    expect(toModelXml(model)).toEqual(model)
  })

  it('accepts a bare GraphDataModel document', function () {
    const model =
      '<GraphDataModel><root><Cell id="0"/></root></GraphDataModel>'
    expect(toModelXml(model)).toEqual(model)
  })

  it('extracts the model from a classic <mxfile> wrapper', function () {
    const file = `<mxfile host="app.diagrams.net">
  <diagram name="Page-1" id="abc123">
    ${EMPTY_DIAGRAM}
  </diagram>
</mxfile>`
    const model = toModelXml(file)
    expect(model).not.toBeNull()
    expect(model).toContain('<mxGraphModel')
    expect(model).toBe(EMPTY_DIAGRAM.trim())
    expect(model).not.toContain('<mxfile')
  })

  it('rejects non-diagram content', function () {
    expect(toModelXml('%PDF-1.4 binary here')).toBeNull()
    expect(toModelXml('<mxfile><diagram>base64compressed</diagram></mxfile>')).toBeNull()
    expect(toModelXml('i am not xml at all')).toBeNull()
  })

  it('round-trips a realistic diagram through normalisation', function () {
    const diagram =
      '<mxGraphModel grid="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="v1" value="hello" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>' +
      '</root></mxGraphModel>'
    expect(toModelXml(diagram)).toEqual(diagram)
  })
})
