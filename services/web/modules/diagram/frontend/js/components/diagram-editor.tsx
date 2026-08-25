import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useLayoutContext } from '@/shared/context/layout-context'

import { stripBrandingComments, toSvgDocument } from '../util/diagram-model'
import {
  companionFileName,
  findParentFolderId,
  type TreeNode,
} from '../util/diagram-utils'
import { svgToPdfBlob, svgToPngBlob } from '../util/diagram-export'
import './diagram-editor.css'

const STATUS_TTL_MS = 4_000

/**
 * Drawing tools. `canvasMode` is the native @svgedit/svgcanvas mode the
 * tool activates (the canvas core implements the pointer interactions).
 */
const TOOL_MODES = [
  { key: 'select', canvasMode: 'select' },
  { key: 'rect', canvasMode: 'rect' },
  { key: 'ellipse', canvasMode: 'ellipse' },
  { key: 'line', canvasMode: 'line' },
  { key: 'circle', canvasMode: 'circle' },
  { key: 'pencil', canvasMode: 'fhpath' },
] as const
type ToolKey = (typeof TOOL_MODES)[number]['key']

/**
 * Narrow structural view of the SvgCanvas instance we use
 * (@svgedit/svgcanvas 7.4.x; MIT, see references/svg-diagram-svgcanvas-plan.md).
 */
type SvgCanvasLike = {
  getMode: () => string
  setMode: (mode: string) => void
  getZoom: () => number
  setZoom: (zoom: number) => void
  getStyle: () => Record<string, unknown>
  setSvgString: (xml: string, preventUndo?: boolean) => boolean
  getSvgString: () => string
  svgCanvasToString: () => string
  getSvgContent: () => Element
  addSVGElementsFromJson: (
    item: {
      element: string
      curStyles?: boolean
      attr?: Record<string, unknown>
      children?: unknown[]
    }
  ) => Element | null
  changeSelectedAttribute: (attr: string, value: string | number) => void
  changeSelectedAttributeNoUndo: (attr: string, value: string | number) => void
  deleteSelectedElements: () => void
  moveToTopSelectedElement: () => void
  moveToBottomSelectedElement: () => void
  clear: () => void
  undo: () => void
  redo: () => void
  createLayer?: (name: string) => Element
  selectOnly?: (elems: Element[]) => void
  undoMgr: {
    getUndoStackSize: () => number
    getRedoStackSize: () => number
  }
  bind: (event: string, callback: (...a: unknown[]) => void) => void
  unbind: (event?: string, callback?: (...a: unknown[]) => void) => void
}

type SvgCanvasCtor = new (
  container: HTMLElement,
  config?: Record<string, unknown>
) => SvgCanvasLike

/**
 * Diagram editor for `.svg` documents, rendered by Overleaf's
 * `sourceEditorComponents` hook in place of the plain text editor.
 *
 * Implementation: @svgedit/svgcanvas (MIT, zero dependencies) is bundled
 * into Overleaf's own JavaScript and drives its native canvas
 * (select / rectangle / ellipse / line / circle / freehand / text) — no
 * iframe, no external host, fully offline.
 *
 * The document source IS the SVG text: Save writes it back into the
 * Overleaf document (sync + version history), then re-creates companion
 * `name.png` (bitmap) and `name.pdf` (VECTOR, browser-side via
 * svg2pdf.js + jsPDF) for `\includegraphics{diagram}`.
 */
export default function DiagramEditorWrapper() {
  const { openDocName } = useEditorOpenDocContext()
  if (!openDocName || !openDocName.endsWith('.svg')) {
    return null
  }
  return <DiagramEditor />
}

function DiagramEditor() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<SvgCanvasLike | null>(null)

  const { getCurrentDocValue } = useEditorManagerContext()
  const { currentDocumentId, openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { focusMode, setFocusMode } = useLayoutContext()

  const [tool, setTool] = useState<ToolKey>('select')
  const [importError, setImportError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [zoomPct, setZoomPct] = useState(100)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [fillColor, setFillColor] = useState('#ffffff')
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState('2')
  const [status, setStatus] = useState<{
    text: string
    kind: 'success' | 'error'
  } | null>(null)
  const [, setUiTick] = useState(0)

  const bump = useCallback(() => setUiTick(x => x + 1), [])

  // ---- document read/write (stable across renders) -----------------------
  const replaceDocRef = useRef<(xml: string) => void>(() => {})
  useEffect(() => {
    replaceDocRef.current = (xml: string) => {
      if (!cmView) return
      try {
        cmView.dispatch({
          changes: { from: 0, to: cmView.state.doc.length, insert: xml },
        })
      } catch (e) {
        // The CodeMirror view may already be gone (doc closed); ignore.
      }
    }
  }, [cmView])

  const treeRef = useRef<{
    currentDocumentId: string | null
    openDocName: string | null
    fileTreeData: TreeNode | null
  }>({ currentDocumentId: null, openDocName: null, fileTreeData: null })
  useEffect(() => {
    treeRef.current = {
      currentDocumentId,
      openDocName,
      fileTreeData: (fileTreeData as unknown as TreeNode) ?? null,
    }
  }, [currentDocumentId, openDocName, fileTreeData])

  const getDocValueRef = useRef<() => string | null | undefined>(() => null)
  useEffect(() => {
    getDocValueRef.current = () => getCurrentDocValue()
  }, [getCurrentDocValue])

  // ---- focus mode: a canvas is unusable in a narrow split pane -----------
  const hadFocusModeRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (hadFocusModeRef.current === null) {
      hadFocusModeRef.current = focusMode
      setFocusMode(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(
    () => () => {
      if (hadFocusModeRef.current === false) {
        setFocusMode(false)
        hadFocusModeRef.current = null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setFocusMode]
  )

  // ---- status pill ---------------------------------------------------------
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusSeqRef = useRef(0)
  const showStatus = useCallback((text: string, kind: 'success' | 'error') => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    const seq = ++statusSeqRef.current
    setStatus({ text, kind })
    statusTimerRef.current = setTimeout(() => {
      if (statusSeqRef.current === seq) setStatus(null)
    }, STATUS_TTL_MS)
  }, [])
  useEffect(
    () => () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    },
    []
  )

  // ---- uploads -------------------------------------------------------------
  const uploadBlob = useCallback(
    async (
      blob: Blob,
      fileName: string,
      folderId: string | null,
      contentType?: string
    ) => {
      const formData = new FormData()
      const uploadBlobTarget =
        contentType && blob.type !== contentType
          ? new Blob([blob], { type: contentType })
          : blob
      formData.append('qqfile', uploadBlobTarget, fileName)
      formData.append('name', fileName)
      const csrfToken = (getMeta('ol-csrfToken') as string) || ''
      const res = await fetch(
        `/project/${projectId}/upload?folder_id=${encodeURIComponent(
          folderId || ''
        )}`,
        {
          method: 'POST',
          headers: { 'X-CSRF-TOKEN': csrfToken },
          body: formData,
        }
      )
      if (!res.ok) {
        throw new Error(`Upload failed: ${res.status}`)
      }
    },
    [projectId]
  )

  const folderIdForDoc = useCallback(() => {
    const { currentDocumentId, fileTreeData: tree } = treeRef.current
    if (currentDocumentId && tree) {
      return findParentFolderId(tree, currentDocumentId) || tree._id || ''
    }
    return tree?._id || ''
  }, [])

  // ---- canvas (created once) -----------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let sizePoll: ReturnType<typeof setInterval> | null = null
    let zoomPoll: ReturnType<typeof setInterval> | null = null
    let bound: SvgCanvasLike | null = null

    const importDoc = (canv: SvgCanvasLike) => {
      const doc = toSvgDocument(getDocValueRef.current())
      if (!doc) {
        return // blank canvas (new file)
      }
      try {
        canv.setSvgString(doc, true) // preventUndo: loading is not an edit
        setImportError(false)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('diagram: could not import current document as SVG', err)
        setImportError(true)
      }
    }

    const fitToContent = (canv: SvgCanvasLike, host: HTMLElement) => {
      try {
        const content = canv.getSvgContent()
        const bb = (
          content as unknown as SVGGraphicsElement
        ).getBBox?.()
        if (
          !bb ||
          !bb.width ||
          !bb.height ||
          !host.clientWidth ||
          !host.clientHeight
        ) {
          canv.setZoom(1)
          setZoomPct(100)
          return
        }
        const zoom = Math.min(
          2,
          Math.max(
            0.1,
            Math.min(
              (host.clientWidth * 0.9) / bb.width,
              (host.clientHeight * 0.9) / bb.height
            )
          )
        )
        if (Number.isFinite(zoom) && zoom > 0) {
          canv.setZoom(zoom)
          setZoomPct(Math.round(zoom * 100))
        }
      } catch {
        canv.setZoom(1)
        setZoomPct(100)
      }
    }

    // The canvas core's mouseDown bails early when #svgcontent has no <g>
    // child (it uses the first group's ScreenCTM for coordinates) — a fresh
    // canvas has NO layer, so nothing would ever be drawable. Ensure an
    // initial layer exists (SVG-Edit's app layer does this).
    const ensureLayer = (canv: SvgCanvasLike) => {
      try {
        const content = canv.getSvgContent()
        if (content && !content.querySelector('g')) {
          if (typeof canv.createLayer === 'function') {
            canv.createLayer('Layer 1')
          } else {
            const svgdoc = document
            const g = svgdoc.createElementNS('http://www.w3.org/2000/svg', 'g')
            g.setAttribute('class', 'layer')
            const title = svgdoc.createElementNS('http://www.w3.org/2000/svg', 'title')
            title.textContent = 'Layer 1'
            g.appendChild(title)
            content.appendChild(g)
          }
        }
      } catch (e) {
        // non-fatal: interactions still work once any shape exists
      }
    }

    const onZoom = () => {
      const canv = canvasRef.current
      if (canv) setZoomPct(Math.round(canv.getZoom() * 100))
    }

    const start = (canv: SvgCanvasLike) => {
      if (disposed || bound) return
      bound = canv
      importDoc(canv)
      ensureLayer(canv)
      fitToContent(canv, container)
      const changed = () => {
        setCanUndo(canv.undoMgr.getUndoStackSize() > 0)
        setCanRedo(canv.undoMgr.getRedoStackSize() > 0)
        onZoom()
        bump()
      }
      canv.bind('changed', changed)
      canv.bind('zoomChanged', changed)
      canv.bind('selectedChanged', changed)
      canv.bind('canvasUpdated', changed)
      // Wheel zoom (capture phase, before the core's own handler — the
      // core path references an app-only #zoom input and is unguarded).
      const onWheel = (e: WheelEvent) => {
        const c = canvasRef.current
        if (!c) return
        e.preventDefault()
        e.stopPropagation()
        const dir = e.deltaY < 0 ? 1.1 : 1 / 1.1
        let z = c.getZoom() * dir
        if (!Number.isFinite(z) || z <= 0) z = 1
        z = Math.min(8, Math.max(0.125, z))
        c.setZoom(z)
        setZoomPct(Math.round(z * 100))
      }
      container.addEventListener('wheel', onWheel, { capture: true, passive: false })
    }

    const boot = async (): Promise<void> => {
      // Lazy so @svgedit/svgcanvas ships as its own webpack chunk.
      const mod = (await import('@svgedit/svgcanvas')) as unknown
      const Ctor = (mod as { default: SvgCanvasCtor }).default
      if (disposed) return
      // The canvas needs the container to have real pixels before we can
      // pick a sane initial size (same pattern as the image editor).
      const waitForSize = (): Promise<void> =>
        new Promise(resolve => {
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            resolve()
            return
          }
          const started = Date.now()
          sizePoll = setInterval(() => {
            if (
              (container.clientWidth > 0 && container.clientHeight > 0) ||
              Date.now() - started > 3_000
            ) {
              if (sizePoll) clearInterval(sizePoll)
              resolve()
            }
          }, 50)
        })
      await waitForSize()
      if (disposed) return
      const initialW = Math.max(640, container.clientWidth || 960)
      const initialH = Math.max(480, container.clientHeight || 720)
      const canv = new Ctor(container, {
        dimensions: [initialW, initialH],
        imgPath: '',
        initFill: { color: 'ffffff', opacity: 1 },
        initStroke: { color: '000000', opacity: 1, width: 2 },
        initOpacity: 1,
        selectNew: true,
        text: {
          font_size: 16,
          font_family: 'Helvetica, Arial, sans-serif',
          stroke_width: 0,
        },
      })
      canvasRef.current = canv
      start(canv)
      // The canvas renders synchronously in the container; poll briefly in
      // case the library does any async DOM work before first paint.
      zoomPoll = setInterval(() => {
        if (document.contains(container)) onZoom()
      }, 400)
    }

    boot().catch(err => {
      // eslint-disable-next-line no-console
      console.error('diagram: failed to initialise the canvas', err)
    })

    return () => {
      disposed = true
      if (sizePoll) clearInterval(sizePoll)
      if (zoomPoll) clearInterval(zoomPoll)
      if (bound) {
        try {
          bound.unbind()
        } catch (e) {
          // already detached
        }
      }
      container.replaceChildren()
    }
  }, [bump])

  // ---- tools / editing -----------------------------------------------------
  const applyTool = useCallback((key: ToolKey) => {
    setTool(key)
    const canv = canvasRef.current
    if (!canv) return
    const def = TOOL_MODES.find(mm => mm.key === key)
    if (def) canv.setMode(def.canvasMode)
  }, [])

  const setPaint = useCallback(
    (
      opts: { fill?: string; stroke?: string; width?: string }
    ) => {
      const { fill, stroke, width } = opts
      const nextFill = fill ?? fillColor
      const nextStroke = stroke ?? strokeColor
      const nextWidth = width ?? strokeWidth
      if (fill !== undefined) setFillColor(fill)
      if (stroke !== undefined) setStrokeColor(stroke)
      if (width !== undefined) setStrokeWidth(width)
      const canv = canvasRef.current
      if (!canv) return
      // New elements draw with the current paint (canvas "curShape").
      const style = canv.getStyle()
      style.fill = `#${nextFill.replace(/^#/, '')}`
      style.stroke = `#${nextStroke.replace(/^#/, '')}`
      style.stroke_width = Number(nextWidth) || 1
      // … and the (existing) selection is recoloured too, undoably.
      const targets = [
        ['fill', nextFill],
        ['stroke', nextStroke],
        ['stroke-width', nextWidth],
      ] as const
      targets.forEach(([attr, value]) => {
        try {
          canv.changeSelectedAttribute(attr, value)
        } catch (e) {
          // no selection — ignored (next elements still use the paint)
        }
      })
    },
    [fillColor, strokeColor, strokeWidth]
  )

  const textPosRef = useRef(0)

  const addText = useCallback(() => {
    const canv = canvasRef.current
    if (!canv) return
    const value = window.prompt(t('diagram_text_prompt'), 'Text')
    if (value === null || value.length === 0) return
    const x = 40 + ((textPosRef.current % 6) + 1) * 14
    const y = 40 + ((textPosRef.current % 6) + 1) * 22
    textPosRef.current += 1
    try {
      const el = canv.addSVGElementsFromJson({
        element: 'text',
        attr: {
          x,
          y,
          // Text must be visible by default: use the OUTLINE (ink) colour,
          // not the shape fill (which may be white).
          fill: strokeColor || '#000000',
          'font-size': 16,
          'font-family': 'Helvetica, Arial, sans-serif',
        },
        children: [value], // string = SVG text node
      })
      canv.setMode('select')
      if (el && typeof canv.selectOnly === 'function') {
        try {
          canv.selectOnly([el as unknown as Element])
        } catch (e2) {
          // selection is cosmetic
        }
      }
      bump()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('diagram: adding text failed', err)
      showStatus(t('diagram_action_failed'), 'error')
    }
  }, [bump, showStatus, strokeColor, t])

  const zoomBy = useCallback((factor: number) => {
    const canv = canvasRef.current
    if (!canv) return
    const next = Math.min(4, Math.max(0.125, canv.getZoom() * factor))
    canv.setZoom(next)
    setZoomPct(Math.round(next * 100))
  }, [])

  const clearCanvas = useCallback(() => {
    const canv = canvasRef.current
    if (!canv) return
    if (!window.confirm(t('diagram_clear_confirm'))) return
    canv.clear()
    showStatus(t('diagram_canvas_cleared'), 'success')
  }, [showStatus, t])

  // ---- keyboard (window-level; inputs/CM/other editors are guarded) -------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const canv = canvasRef.current
      if (!canv) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (canv.getMode() !== 'select') return
        e.preventDefault()
        canv.deleteSelectedElements()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) canv.redo()
        else canv.undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        canv.redo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ---- save (SVG source) + companions (PNG + vector PDF) ------------------
  const saveAndExport = useCallback(async () => {
    const canv = canvasRef.current
    if (!canv) return
    try {
      // Force sane geometry before serialising (the core's raw setZoom is
      // unguarded; a NaN zoom yields <svg width="NaN"> exports).
      try {
        const z = canv.getZoom()
        if (!Number.isFinite(z) || z <= 0) canv.setZoom(1)
        const content = canv.getSvgContent()
        if (content) {
          const w = Number(content.getAttribute('width'))
          const h = Number(content.getAttribute('height'))
          if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
            const nw = Math.max(200, containerRef.current?.clientWidth || 960)
            const nh = Math.max(200, containerRef.current?.clientHeight || 600)
            content.setAttribute('width', String(nw))
            content.setAttribute('height', String(nh))
            content.setAttribute('viewBox', `0 0 ${nw} ${nh}`)
          }
        }
      } catch (e) {
        // ignore — export uses whatever dimensions remain
      }
      let svg: string
      try {
        svg = stripBrandingComments(canv.svgCanvasToString())
      } catch (err) {
        svg = stripBrandingComments(canv.getSvgString())
      }
      replaceDocRef.current(svg)
      bump()
      showStatus(t('diagram_doc_saved'), 'success')

      // Companion renderings (skip for an empty canvas; the user would just
      // get a blank image over a working one).
      const content = canv.getSvgContent()
      const children =
        content instanceof Element ? content.children.length : 0
      if (children === 0) {
        return
      }

      setExporting(true)
      let pngWidth = 842
      let pngHeight = 595
      try {
        const bb = (content as unknown as SVGGraphicsElement).getBBox?.()
        if (bb && bb.width && bb.height) {
          pngWidth = Math.ceil(bb.width) * 2
          pngHeight = Math.ceil(bb.height) * 2
        }
      } catch (e) {
        // default resolution
      }

      const docName = treeRef.current.openDocName || 'diagram.svg'
      const folderId = folderIdForDoc()

      await (async () => {
        const png = await svgToPngBlob(svg, pngWidth, pngHeight)
        await uploadBlob(png, companionFileName(docName, 'png'), folderId)
      })()
      try {
        const pdf = await svgToPdfBlob(svg)
        await uploadBlob(
          pdf,
          companionFileName(docName, 'pdf'),
          folderId,
          'application/pdf'
        )
      } catch (err) {
        // Keep a usable companion so nothing is lost.
        // eslint-disable-next-line no-console
        console.warn('diagram: SVG → PDF conversion failed; uploading SVG', err)
        await uploadBlob(
          new Blob([svg], { type: 'image/svg+xml' }),
          companionFileName(docName, 'svg'),
          folderId,
          'image/svg+xml'
        )
      }
      showStatus(t('diagram_exports_complete'), 'success')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('diagram: save/export failed', err)
      showStatus(t('diagram_export_failed'), 'error')
    } finally {
      setExporting(false)
    }
  }, [bump, folderIdForDoc, showStatus, t, uploadBlob])

  // ---- render ----------------------------------------------------------------
  const toolBtn = (key: ToolKey, label: string, title: string) => (
    <button
      type="button"
      key={key}
      className={'dg-item' + (tool === key ? ' active' : '')}
      title={title}
      onPointerDown={e => {
        e.preventDefault()
        applyTool(key)
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="dg-root">
      <div className="dg-toolbar">
        <div className="dg-group">{toolBtn('select', '▸', t('diagram_tool_select'))}</div>
        <div className="dg-group">
          {toolBtn('rect', '▭', t('diagram_tool_rect'))}
          {toolBtn('ellipse', '◯', t('diagram_tool_ellipse'))}
          {toolBtn('line', '∕', t('diagram_tool_line'))}
          {toolBtn('circle', '●', t('diagram_tool_circle'))}
          {toolBtn('pencil', '✎', t('diagram_tool_pencil'))}
        </div>
        <div className="dg-group">
          <button
            type="button"
            className="dg-item"
            title={t('diagram_add_text')}
            onPointerDown={e => {
              e.preventDefault()
              addText()
            }}
          >
            T
          </button>
          <button
            type="button"
            className="dg-item"
            disabled={!canUndo}
            title={t('undo')}
            onPointerDown={e => {
              e.preventDefault()
              canvasRef.current?.undo()
            }}
          >
            ↶
          </button>
          <button
            type="button"
            className="dg-item"
            disabled={!canRedo}
            title={t('redo')}
            onPointerDown={e => {
              e.preventDefault()
              canvasRef.current?.redo()
            }}
          >
            ↷
          </button>
        </div>
        <div className="dg-group">
          <button
            type="button"
            className="dg-item"
            title={t('diagram_to_front')}
            onPointerDown={e => {
              e.preventDefault()
              canvasRef.current?.moveToTopSelectedElement()
            }}
          >
            ⇪
          </button>
          <button
            type="button"
            className="dg-item"
            title={t('diagram_to_back')}
            onPointerDown={e => {
              e.preventDefault()
              canvasRef.current?.moveToBottomSelectedElement()
            }}
          >
            ⇩
          </button>
          <button
            type="button"
            className="dg-item dg-danger"
            title={t('diagram_delete')}
            onPointerDown={e => {
              e.preventDefault()
              canvasRef.current?.deleteSelectedElements()
            }}
          >
            ✕
          </button>
        </div>
        <div className="dg-group">
          <button
            type="button"
            className="dg-item"
            title={t('diagram_zoom_out')}
            onPointerDown={e => {
              e.preventDefault()
              zoomBy(1 / 1.25)
            }}
          >
            −
          </button>
          <span className="dg-zoom">{zoomPct}%</span>
          <button
            type="button"
            className="dg-item"
            title={t('diagram_zoom_in')}
            onPointerDown={e => {
              e.preventDefault()
              zoomBy(1.25)
            }}
          >
            +
          </button>
        </div>
        <div className="dg-group">
          <button
            type="button"
            className="dg-item"
            title={t('diagram_clear')}
            onPointerDown={e => {
              e.preventDefault()
              clearCanvas()
            }}
          >
            {t('diagram_clear')}
          </button>
        </div>
      </div>

      <div className="dg-toolbar dg-toolbar-row2">
        <div className="dg-group">
          <label className="dg-label">
            {t('diagram_fill')}
            <input
              type="color"
              value={fillColor}
              onChange={e => setPaint({ fill: e.target.value })}
            />
          </label>
          <label className="dg-label">
            {t('diagram_stroke')}
            <input
              type="color"
              value={strokeColor}
              onChange={e => setPaint({ stroke: e.target.value })}
            />
          </label>
          <label className="dg-label">
            {t('diagram_line_width')}
            <select
              value={strokeWidth}
              onChange={e => setPaint({ width: e.target.value })}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="6">6</option>
              <option value="8">8</option>
            </select>
          </label>
        </div>
        <div className="dg-spacer" />
        <label className="dg-label">
          <input
            type="checkbox"
            disabled
            checked
            title={t('diagram_export_hint')}
          />
          {t('diagram_companions')}
        </label>
        <button
          type="button"
          className="dg-save"
          disabled={exporting}
          onClick={saveAndExport}
        >
          {exporting ? t('diagram_exporting') : t('save')}
        </button>
      </div>

      <div className="dg-canvaswrap">
        {importError && (
          <div className="dg-banner">
            {t('diagram_import_failed')}
          </div>
        )}
        <div ref={containerRef} className="dg-canvas" />
      </div>

      <div className="dg-footer">
        <span className="dg-hint">{t('diagram_source_hint')}</span>
        {status && (
          <span className={`dg-status ${status.kind}`}>{status.text}</span>
        )}
      </div>
    </div>
  )
}
