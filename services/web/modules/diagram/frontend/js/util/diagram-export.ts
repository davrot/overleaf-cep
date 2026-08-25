/**
 * Client-side export pipeline for the SVG diagram editor (modules/diagram).
 *
 * Everything happens in the browser — no server dependency, no network:
 *
 *   SVG  ──(canvas)────────> PNG bitmap
 *   SVG  ──(svg2pdf.js + jsPDF)──> VECTOR PDF for `\includegraphics`
 *
 * The SVG itself is the document source, so no intermediate serialisation
 * is needed (this used to be maxGraph's ImageExport; svgcanvas exports the
 * SVG string directly).
 */

function svgToImage(svgXml: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to rasterise the SVG diagram'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgXml)
  })
}

export function svgToPngBlob(
  svgXml: string,
  width: number,
  height: number
): Promise<Blob> {
  return svgToImage(svgXml).then(
    img =>
      new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(width))
        canvas.height = Math.max(1, Math.ceil(height))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 2D not available in this browser'))
          return
        }
        ctx.drawImage(img, 0, 0)
        canvas.toBlob(
          blob =>
            blob
              ? resolve(blob)
              : reject(new Error('PNG encoding failed')),
          'image/png'
        )
      })
  )
}

/** Vector PDF via svg2pdf.js + jsPDF (browser-only, fully offline). */
export async function svgToPdfBlob(svgText: string): Promise<Blob> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsPdfModule: any = await import('jspdf')
  const jsPDFCtor = jsPdfModule?.jsPDF ?? jsPdfModule?.default
  if (typeof jsPDFCtor !== 'function') {
    throw new Error('jsPDF is not available in this browser')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg2pdfModule: any = await import('svg2pdf.js')
  const svg2pdf = svg2pdfModule?.default ?? svg2pdfModule
  if (typeof svg2pdf !== 'function') {
    throw new Error('svg2pdf.js is not available in this browser')
  }
  const doc = new jsPDFCtor({ unit: 'pt', format: 'a4' })
  svg2pdf(doc)
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svgEl.innerHTML = svgText
  await doc.svg(svgEl, 0.5, 0.5, {
    resvg: { fitTo: ['width', 'height'] },
  })
  return doc.output('blob') as unknown as Blob
}
