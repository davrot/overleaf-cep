import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Graph,
  InternalEvent,
  ModelXmlSerializer,
  Point,
  Rectangle,
  RubberBandHandler,
  UndoManager,
  constants,
  getDefaultPlugins,
} from '@maxgraph/core'
import type { Cell as MaxCell } from '@maxgraph/core'
import '@maxgraph/core/css/common.css'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import { EMPTY_DIAGRAM, toModelXml } from '../util/drawio-model'
import {
  companionFileName,
  findParentFolderId,
  type TreeNode,
} from '../util/drawio-utils'
import {
  graphToSvg,
  svgToPdfBlob,
  svgToPngBlob,
} from '../util/drawio-export'
import './drawio-editor.css'

const STATUS_TTL_MS = 4_000

type Armed =
  | { kind: 'select' }
  | { kind: 'pencil' }
  | { kind: 'edge'; style: Record<string, unknown>; label: string }

interface Status {
  text: string
  kind: 'success' | 'error'
}

interface ShapeDef {
  id: string
  labelKey: string
  style: Record<string, unknown>
  size: [number, number]
  value?: string
}

// Palette definitions mirroring the classic mxGraph grapheditor example
// (General group + Connectors group). Shapes use the styles from the
// grapheditor's default stylesheet: white fill, black stroke, fontSize 12.
const SHAPE_DEFAULT: Record<string, unknown> = {
  fillColor: '#ffffff',
  strokeColor: '#000000',
  fontSize: 12,
}

const GENERAL_SHAPES: ShapeDef[] = [
  {
    id: 'rectangle',
    labelKey: 'drawio_shape_rectangle',
    style: { ...SHAPE_DEFAULT },
    size: [160, 90],
  },
  {
    id: 'ellipse',
    labelKey: 'drawio_shape_ellipse',
    style: { ...SHAPE_DEFAULT, shape: 'ellipse' },
    size: [160, 90],
  },
  {
    id: 'rhombus',
    labelKey: 'drawio_shape_rhombus',
    style: { ...SHAPE_DEFAULT, shape: 'rhombus' },
    size: [160, 90],
  },
  {
    id: 'cylinder',
    labelKey: 'drawio_shape_cylinder',
    style: { ...SHAPE_DEFAULT, shape: 'cylinder' },
    size: [150, 90],
  },
  {
    id: 'triangle',
    labelKey: 'drawio_shape_triangle',
    style: { ...SHAPE_DEFAULT, shape: 'triangle' },
    size: [150, 90],
  },
  {
    id: 'cloud',
    labelKey: 'drawio_shape_cloud',
    style: { ...SHAPE_DEFAULT, shape: 'cloud' },
    size: [160, 100],
  },
  {
    id: 'actor',
    labelKey: 'drawio_shape_actor',
    style: { ...SHAPE_DEFAULT, shape: 'actor' },
    size: [60, 120],
  },
  {
    id: 'text',
    labelKey: 'drawio_shape_text',
    style: {
      ...SHAPE_DEFAULT,
      shape: 'label',
      fillColor: 'none',
      strokeColor: 'none',
      align: 'left',
      verticalAlign: 'top',
    },
    size: [160, 40],
    value: 'Text',
  },
]

const CONNECTOR_DEFS = [
  {
    id: 'edge-straight',
    labelKey: 'drawio_conn_straight',
    style: { ...SHAPE_DEFAULT, endArrow: 'none' },
  },
  {
    id: 'edge-arrow',
    labelKey: 'drawio_conn_arrow',
    style: { ...SHAPE_DEFAULT, endArrow: 'classic' },
  },
  {
    id: 'edge-elbow',
    labelKey: 'drawio_conn_elbow',
    style: { ...SHAPE_DEFAULT, edgeStyle: 'elbowEdgeStyle', endArrow: 'classic' },
  },
  {
    id: 'edge-orth',
    labelKey: 'drawio_conn_orth',
    style: {
      ...SHAPE_DEFAULT,
      edgeStyle: 'orthogonalEdgeStyle',
      endArrow: 'classic',
    },
  },
]

// 28x20 previews for the sidebar palette.
const ICON_PROPS = {
  width: 28,
  height: 20,
  viewBox: '0 0 28 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
}

const SHAPE_ICONS: Record<string, JSX.Element> = {
  rectangle: <rect x="3" y="4" width="22" height="12" />,
  ellipse: <ellipse cx="14" cy="10" rx="10" ry="6.5" />,
  rhombus: <polygon points="14,2 25,10 14,18 3,10" />,
  cylinder: (
    <>
      <ellipse cx="14" cy="5.5" rx="8" ry="2.8" />
      <path d="M6 5.5 V14.5 A8 2.8 0 0 0 22 14.5 V5.5" />
    </>
  ),
  triangle: <polygon points="14,3 25,17 3,17" />,
  cloud: (
    <path d="M7 14 a4 4 0 0 1 1-7.8 a5 5 0 0 1 9.6-1 a4.2 4.2 0 0 1 3.4 8.8 Z" />
  ),
  actor: (
    <>
      <circle cx="14" cy="5" r="2.6" />
      <path d="M14 8 V14 M14 14 L9 19 M14 14 L19 19 M8.5 10.5 H19.5" />
    </>
  ),
  text: <text x="6" y="15" fontSize="14" fill="currentColor" stroke="none">A</text>,
  'edge-straight': (
    <>
      <circle cx="3" cy="10" r="1.6" />
      <line x1="5" y1="10" x2="23" y2="10" />
      <circle cx="25" cy="10" r="1.6" />
    </>
  ),
  'edge-arrow': (
    <>
      <line x1="3" y1="10" x2="24" y2="10" />
      <polygon points="25,10 20,7 20,13" fill="currentColor" stroke="none" />
    </>
  ),
  'edge-elbow': (
    <>
      <polyline points="3,4 21,4 21,16" />
      <polygon points="25,16 21,13 21,19" fill="currentColor" stroke="none" />
    </>
  ),
  'edge-orth': (
    <>
      <polyline points="3,16 9,16 9,4 21,4" />
      <polygon points="25,4 21,1 21,7" fill="currentColor" stroke="none" />
    </>
  ),
  pencil: (
    <>
      <path d="M18 2 l6 6 -12 12 -7 1 1-7 Z" />
      <path d="M16 4 l6 6" />
    </>
  ),
  select: (
    <polygon points="4,2 4,17 9,12.5 12,19 15,17.5 12,11 18,11" />
  ),
}

/**
 * Diagram editor shown as a `sourceEditorComponents` module for `.drawio`
 * documents. UI layout mirrors the classic mxGraph grapheditor example
 * (top toolbar, left shape palette, canvas, status bar) — see
 * `javascript/examples/grapheditor/www` in jgraph/mxgraph.
 *
 * Implementation notes:
 * - Rendering/editing runs on maxGraph (`@maxgraph/core`, Apache-2.0, the
 *   mxGraph successor that powers draw.io), bundled into Overleaf's own
 *   JavaScript — no iframe, no external host, fully offline.
 * - The document itself is plain model XML (the editable source); Save
 *   writes it back into the Overleaf document (sync + version history) and
 *   (re)creates companion `name.png` / `name.pdf` (vector, browser-side
 *   SVG → svg2pdf.js + jsPDF) for `\includegraphics`.
 */
export default function DrawioEditorWrapper() {
  const { openDocName } = useEditorOpenDocContext()
  if (!openDocName || !openDocName.endsWith('.drawio')) {
    return null
  }
  return <DrawioEditor />
}

function DrawioEditor() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const undoRef = useRef<UndoManager | null>(null)
  const edgeSourceRef = useRef<MaxCell | null>(null)

  const { getCurrentDocValue } = useEditorManagerContext()
  const { currentDocumentId, openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { focusMode, setFocusMode } = useLayoutContext()

  const [armed, setArmed] = useState<Armed>({ kind: 'select' })
  const [importError, setImportError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [gridOn, setGridOn] = useState(true)
  const [scalePct, setScalePct] = useState(100)
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [, setUiTick] = useState(0)
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [fillColor, setFillColor] = useState('#ffffff')
  const [strokeWidth, setStrokeWidth] = useState('2')

  const armedRef = useRef(armed)
  useEffect(() => {
    armedRef.current = armed
  }, [armed])
  const strokePropsRef = useRef({ strokeColor, fillColor, strokeWidth })
  useEffect(() => {
    strokePropsRef.current = { strokeColor, fillColor, strokeWidth }
  }, [strokeColor, fillColor, strokeWidth])

  const bump = useCallback(() => setUiTick(x => x + 1), [])

  // ---- document read/write (stable across renders) -----------------------
  const loadedRef = useRef('')
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

  // ---- focus mode: a canvas is unusable in a narrow split pane -----------
  const focusModeWasRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (!focusMode && focusModeWasRef.current === null) {
      focusModeWasRef.current = focusMode
      setFocusMode(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(
    () => () => {
      if (focusModeWasRef.current === false) {
        setFocusMode(false)
        focusModeWasRef.current = null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setFocusMode]
  )

  // ---- status pill ---------------------------------------------------------
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusSeqRef = useRef(0)
  const showStatus = useCallback((text: string, kind: Status['kind']) => {
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

  // ---- graph creation (once) ----------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const graph = new Graph(container, undefined, [
      ...getDefaultPlugins(),
      RubberBandHandler,
    ])
    graphRef.current = graph
    graph.setHtmlLabels(true)
    graph.setPanning(true)
    graph.setGridEnabled(true)
    graph.setGridSize(10)
    // Landscape A4 page sheet (like the grapheditor example).
    graph.pageFormat = new Rectangle(
      0,
      0,
      constants.PAGE_FORMAT_A4_LANDSCAPE[0],
      constants.PAGE_FORMAT_A4_LANDSCAPE[1]
    )

    // Undo/redo (wired as documented by maxGraph).
    const undoManager = new UndoManager()
    const onUndoEvent = (
      sender: unknown,
      evt: { getProperty?: (k: string) => unknown }
    ) => {
      const edit =
        evt && typeof evt.getProperty === 'function'
          ? evt.getProperty('edit')
          : null
      if (edit) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(undoManager as any).undoableEditHappened(edit)
      }
    }
    graph
      .getDataModel()
      .addListener(InternalEvent.UNDO, onUndoEvent as never)
    graph.getView().addListener(InternalEvent.UNDO, onUndoEvent as never)
    undoRef.current = undoManager

    // Live zoom % for the status bar.
    const onScale = () => {
      const s = graph.getView().getScale()
      setScalePct(Math.round(s * 100))
    }
    graph.getView().addListener(InternalEvent.SCALE, onScale as never)
    graph
      .getView()
      .addListener(InternalEvent.SCALE_AND_TRANSLATE, onScale as never)

    // Two-click edge creation: with a connector armed in the palette,
    // click the source cell, then the target cell.
    const onMouseUp = (
      sender: unknown,
      me: { state?: { cell?: MaxCell | null } | null }
    ) => {
      const cur = armedRef.current
      if (cur.kind !== 'edge') return
      const cell = me?.state && me.state.cell ? me.state.cell : null
      if (!cell || !graph.isEnabled()) return
      if (!edgeSourceRef.current) {
        edgeSourceRef.current = cell
        graph.setSelectionCell(cell)
        showStatus(t('drawio_edge_second'), 'success')
        return
      }
      if (cell !== edgeSourceRef.current) {
        graph.insertEdge({
          parent: graph.getDefaultParent(),
          source: edgeSourceRef.current,
          target: cell,
          value: '',
          style: cur.style,
        })
        bump()
      }
      edgeSourceRef.current = null
      setArmed({ kind: 'select' })
    }
    graph.addMouseListener({
      mouseDown: () => {},
      mouseMove: () => {},
      mouseUp: onMouseUp,
    })

    // Import the current document content.
    const docText = (getCurrentDocValue() as string | undefined) ?? ''
    loadedRef.current = docText
    const modelXml = toModelXml(docText) ?? EMPTY_DIAGRAM
    let importOk = true
    try {
      new ModelXmlSerializer(graph.getDataModel()).import(modelXml)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('drawio: could not import diagram XML', err)
      importOk = false
    }
    if (!importOk || (docText.trim() !== '' && modelXml === EMPTY_DIAGRAM)) {
      setImportError(true)
    }

    // Fit once the pane actually has a size.
    let raf = 0
    const fitOnce = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      const fit = graph.getPlugin('fit') as unknown as
        | { fitCenter?: (opts?: { margin?: number }) => unknown }
        | null
        | undefined
      fit?.fitCenter?.({ margin: 12 })
    }
    raf = requestAnimationFrame(fitOnce)

    // Cursor coordinates for the status bar (throttled updates).
    let lastCoords = 0
    const onMove = (e: MouseEvent) => {
      const now = Date.now()
      if (now - lastCoords < 60) return
      lastCoords = now
      const pt = graph.getPointForEvent(e)
      setCoords({ x: Math.round(pt.x), y: Math.round(pt.y) })
    }
    container.addEventListener('mousemove', onMove)

    return () => {
      cancelAnimationFrame(raf)
      container.removeEventListener('mousemove', onMove)
      // Flush: commit the current model so that closing the editor
      // without pressing Save does not lose the last edits.
      if (importOk) {
        try {
          const xml = new ModelXmlSerializer(graph.getDataModel()).export()
          if (xml !== loadedRef.current) {
            replaceDocRef.current(xml)
            loadedRef.current = xml
          }
        } catch (err) {
          // The CodeMirror view may already be gone (doc closed); ignore.
        }
      }
      graph.destroy()
      graphRef.current = null
      undoRef.current = null
      edgeSourceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- pencil (freehand) — active while the Freehand tool is armed --------
  useEffect(() => {
    const graph = graphRef.current
    const container = containerRef.current
    if (!graph || !container || armed.kind !== 'pencil') return

    // Capture the raw pointer path: the graph's own mouse handling is
    // suspended while a stroke is in progress.
    let stroke: { cell: MaxCell; points: Point[] } | null = null
    graph.setEnabled(false)
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      const pt = graph.getPointForEvent(e)
      const props = strokePropsRef.current
      const cell = graph.insertEdge({
        parent: graph.getDefaultParent(),
        value: '',
        style: {
          endArrow: 'none',
          strokeColor: props.strokeColor,
          strokeWidth: Number(props.strokeWidth) || 2,
        },
      })
      const geo = cell.getGeometry()
      if (geo) {
        geo.points = [pt]
        graph.refresh()
      }
      stroke = { cell, points: [pt] }
    }
    const move = (e: PointerEvent) => {
      if (!stroke) return
      e.preventDefault()
      stroke.points.push(graph.getPointForEvent(e))
      const geo = stroke.cell.getGeometry()
      if (geo) {
        geo.points = stroke.points
        graph.refresh()
      }
    }
    const up = () => {
      if (!stroke) return
      if (stroke.points.length < 2) {
        graph.removeCells([stroke.cell])
      }
      stroke = null
      graph.setEnabled(true)
      bump()
    }
    container.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      container.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (stroke) {
        if (stroke.points.length < 2) {
          graph.removeCells([stroke.cell])
        }
        graph.setEnabled(true)
      }
    }
  }, [armed.kind, bump])

  // ---- palette / toolbar actions ------------------------------------------
  const nextInsertPosition = useCallback((): [number, number] => {
    const graph = graphRef.current
    if (!graph) return [60, 60]
    const b = graph.getGraphBounds()
    if (!b || b.width === 0 || b.height === 0) return [60, 60]
    return [b.x + b.width + 40, b.y + 40]
  }, [])

  const insertShape = useCallback(
    (def: ShapeDef, at?: [number, number]) => {
      const graph = graphRef.current
      if (!graph) return
      const pos = at ?? nextInsertPosition()
      const props = strokePropsRef.current
      const style: Record<string, unknown> = { ...def.style }
      if (def.id === 'text') {
        style.fillColor = 'none'
        style.strokeColor = 'none'
      } else {
        style.strokeColor = props.strokeColor
        style.fillColor = props.fillColor
      }
      const cell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        position: pos,
        size: def.size,
        value: def.value ?? '',
        style,
      })
      graph.setSelectionCell(cell)
      bump()
    },
    [bump, nextInsertPosition]
  )

  // Click inserts at the default position; drag-and-release onto the canvas
  // (grapheditor-style) inserts at the drop point.
  const onPaletteVertex = useCallback(
    (_e: React.SyntheticEvent, def: ShapeDef) => {
      const finish = (ev: PointerEvent) => {
        window.removeEventListener('pointerup', finish)
        const container = containerRef.current
        const graph = graphRef.current
        if (container && graph) {
          const r = container.getBoundingClientRect()
          if (
            ev.clientX >= r.left &&
            ev.clientX <= r.right &&
            ev.clientY >= r.top &&
            ev.clientY <= r.bottom
          ) {
            const pt = graph.getPointForEvent(ev as unknown as MouseEvent)
            insertShape(def, [pt.x - def.size[0] / 2, pt.y - def.size[1] / 2])
            return
          }
        }
        insertShape(def)
      }
      window.addEventListener('pointerup', finish)
    },
    [insertShape]
  )

  const armConnector = useCallback((def: (typeof CONNECTOR_DEFS)[number]) => {
    setArmed({
      kind: 'edge',
      style: def.style,
      label: def.id,
    })
  }, [])

  const deleteSelection = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    const cells = graph.getSelectionCells()
    if (cells.length === 0) return
    graph.removeCells(cells)
    bump()
  }, [bump])

  const undo = useCallback(() => {
    const u = undoRef.current
    if (u && u.canUndo()) {
      u.undo()
      bump()
    }
  }, [bump])

  const redo = useCallback(() => {
    const u = undoRef.current
    if (u && u.canRedo()) {
      u.redo()
      bump()
    }
  }, [bump])

  const fitAll = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    const fit = graph.getPlugin('fit') as unknown as
      | { fitCenter?: (opts?: { margin?: number }) => unknown }
      | null
      | undefined
    fit?.fitCenter?.({ margin: 12 })
  }, [])

  const newDocument = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    graph.getDataModel().clear()
    fitAll()
    showStatus(t('drawio_cleared'), 'success')
  }, [fitAll, showStatus, t])

  const toggleGrid = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    setGridOn(on => {
      graph.setGridEnabled(!on)
      return !on
    })
  }, [])

  const applyStyle = useCallback(
    (key: string, value: string) => {
      const graph = graphRef.current
      if (!graph) return
      const cells = graph.getSelectionCells()
      if (cells.length === 0) return
      for (const cell of cells) {
        graph.setCellStyle({ [key]: value }, [cell])
      }
      bump()
    },
    [bump]
  )

  // ---- keyboard shortcuts ----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    container.addEventListener('keydown', onKey)
    return () => container.removeEventListener('keydown', onKey)
  }, [deleteSelection, undo, redo])

  // ---- save + companions -----------------------------------------------------
  const saveAndExport = useCallback(async () => {
    const graph = graphRef.current
    if (!graph) return
    try {
      const xml = new ModelXmlSerializer(graph.getDataModel()).export()
      replaceDocRef.current(xml)
      loadedRef.current = xml
      bump()

      const vertices = graph.getChildVertices()
      const edges = graph.getChildEdges(graph.getDefaultParent())
      if (vertices.length === 0 && edges.length === 0) {
        showStatus(t('drawio_doc_saved'), 'success')
        return
      }

      setExporting(true)
      const svg = graphToSvg(graph)
      const docName = treeRef.current.openDocName || 'diagram.drawio'
      const folderId = folderIdForDoc()

      const png = await svgToPngBlob(svg.xml, svg.width, svg.height)
      await uploadBlob(png, companionFileName(docName, 'png'), folderId)
      try {
        const pdf = await svgToPdfBlob(svg.xml)
        await uploadBlob(
          pdf,
          companionFileName(docName, 'pdf'),
          folderId,
          'application/pdf'
        )
      } catch (err) {
        // Keep the raw SVG so nothing is lost.
        // eslint-disable-next-line no-console
        console.warn('drawio: SVG → PDF conversion failed; uploading SVG', err)
        await uploadBlob(
          new Blob([svg.xml], { type: 'image/svg+xml' }),
          companionFileName(docName, 'svg'),
          folderId,
          'image/svg+xml'
        )
      }
      showStatus(t('drawio_exports_complete'), 'success')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('drawio: save/export failed', err)
      showStatus(t('drawio_export_failed'), 'error')
    } finally {
      setExporting(false)
    }
  }, [bump, folderIdForDoc, showStatus, t, uploadBlob])

  // Palette item renderer (with 28x20 SVG preview)
  const paletteItem = (
    key: string,
    label: string,
    active: boolean,
    onDown: (e: React.SyntheticEvent) => void
  ) => (
    <div
      key={key}
      className={'dg-item' + (active ? ' active' : '')}
      onPointerDown={onDown}
    >
      <svg {...ICON_PROPS}>{SHAPE_ICONS[key]}</svg>
      <span>{label}</span>
    </div>
  )

  const toolbarButton = (
    label: string,
    onClick: () => void,
    opts?: { active?: boolean; disabled?: boolean }
  ) => (
    <OLButton
      size="sm"
      variant={opts && opts.active ? 'primary' : 'secondary'}
      disabled={opts ? opts.disabled : undefined}
      onClick={onClick}
    >
      {label}
    </OLButton>
  )

  return (
    <div className="dg-editor">
      <div className="dg-toolbar">
        {toolbarButton(t('drawio_new'), newDocument)}
        <span className="dg-sep" />
        {toolbarButton(t('undo'), undo, {
          disabled: !undoRef.current?.canUndo(),
        })}
        {toolbarButton(t('redo'), redo, {
          disabled: !undoRef.current?.canRedo(),
        })}
        <span className="dg-sep" />
        {toolbarButton('−', () => graphRef.current?.zoomOut())}
        {toolbarButton('+', () => graphRef.current?.zoomIn())}
        {toolbarButton(t('drawio_fit'), fitAll)}
        <span className="dg-sep" />
        {toolbarButton(t('drawio_tool_select'), () => setArmed({ kind: 'select' }), {
          active: armed.kind === 'select',
        })}
        {toolbarButton(t('drawio_tool_pencil'), () => setArmed({ kind: 'pencil' }), {
          active: armed.kind === 'pencil',
        })}
        {toolbarButton(t('drawio_delete'), deleteSelection)}
        <span className="dg-sep" />
        {toolbarButton(gridOn ? '▦' : '⬚', toggleGrid, {
          active: gridOn,
        })}
        <label className="dg-swatch" aria-label={t('drawio_stroke_color')}>
          <input
            type="color"
            value={strokeColor}
            onChange={e => {
              setStrokeColor(e.target.value)
              applyStyle('strokeColor', e.target.value)
            }}
          />
        </label>
        <label className="dg-swatch" aria-label={t('drawio_fill_color')}>
          <input
            type="color"
            value={fillColor}
            onChange={e => {
              setFillColor(e.target.value)
              applyStyle('fillColor', e.target.value)
            }}
          />
        </label>
        <select
          className="dg-width"
          value={strokeWidth}
          onChange={e => {
            setStrokeWidth(e.target.value)
            applyStyle('strokeWidth', e.target.value)
          }}
          aria-label={t('drawio_line')}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="4">4</option>
          <option value="8">8</option>
        </select>
        <span style={{ flex: 1 }} />
        <OLButton
          variant="primary"
          disabled={exporting}
          onClick={() => void saveAndExport()}
        >
          {t('save')}
        </OLButton>
      </div>

      {importError && <div className="dg-banner">{t('drawio_load_failed')}</div>}

      <div className="dg-body">
        <div className="dg-sidebar">
          <div className="dg-group">
            <div className="dg-group-title">{t('drawio_group_general')}</div>
            {GENERAL_SHAPES.map(def =>
              paletteItem(def.id, t(def.labelKey), false, e =>
                onPaletteVertex(e, def)
              )
            )}
          </div>
          <div className="dg-group">
            <div className="dg-group-title">{t('drawio_group_connectors')}</div>
            {CONNECTOR_DEFS.map(def =>
              paletteItem(
                def.id,
                t(def.labelKey),
                armed.kind === 'edge' && armed.label === def.id,
                () => armConnector(def)
              )
            )}
          </div>
        </div>
        <div className="dg-canvas">
          <div ref={containerRef} className="dg-canvas-inner" />
          {armed.kind === 'edge' && (
            <div className="dg-pill">{t('drawio_edge_hint')}</div>
          )}
          {armed.kind === 'pencil' && (
            <div className="dg-pill">{t('drawio_pencil_hint')}</div>
          )}
          {exporting && <div className="dg-pill">{t('drawio_exporting')}</div>}
          {status && !exporting && (
            <div
              className="dg-pill"
              style={{
                background:
                  status.kind === 'error'
                    ? 'rgba(200, 40, 40, 0.92)'
                    : 'rgba(0, 0, 0, 0.7)',
              }}
            >
              {status.text}
            </div>
          )}
        </div>
      </div>

      <div className="dg-statusbar">
        <span>{t('drawio_zoom')}: {scalePct}%</span>
        {coords && (
          <span>
            x: {coords.x}  y: {coords.y}
          </span>
        )}
        <span className="spacer" />
        <span>{t('drawio_status_format')}</span>
      </div>
    </div>
  )
}
