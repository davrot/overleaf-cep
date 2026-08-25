import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Graph,
  InternalEvent,
  ModelXmlSerializer,
  Point,
  RubberBandHandler,
  UndoManager,
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

const STATUS_TTL_MS = 4_000
const RECT_SIZE: [number, number] = [180, 100]
const ELLIPSE_SIZE: [number, number] = [180, 100]
const TEXT_SIZE: [number, number] = [180, 40]

type Tool = 'select' | 'rectangle' | 'ellipse' | 'text' | 'arrow' | 'pencil'

interface Status {
  text: string
  kind: 'success' | 'error'
}

/**
 * Diagram editor shown as a `sourceEditorComponents` module for `.drawio`
 * documents.
 *
 * The diagram is drawn on a maxGraph canvas (`@maxgraph/core`, Apache-2.0,
 * the mxGraph successor that powers draw.io) bundled into Overleaf's own
 * JavaScript — no iframe, no external host, no CDN. The document itself is
 * plain model XML (the editable source); on save it is written back into
 * the Overleaf document (so it participates in real-time sync and version
 * history) and PNG/PDF companion files are exported **in the browser**
 * (maxGraph SVG → canvas/svg2pdf.js+jsPDF) for use with
 * `\includegraphics{diagram.pdf}`.
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
  const arrowSourceRef = useRef<MaxCell | null>(null)

  const { getCurrentDocValue } = useEditorManagerContext()
  const { currentDocumentId, openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { focusMode, setFocusMode } = useLayoutContext()

  const [tool, setTool] = useState<Tool>('select')
  const [importError, setImportError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [, setUiTick] = useState(0)
  const [strokeColor, setStrokeColor] = useState('#333333')
  const [fillColor, setFillColor] = useState('#fdf7e2')
  const [strokeWidth, setStrokeWidth] = useState('2')
  const [status, setStatus] = useState<Status | null>(null)

  const toolRef = useRef<Tool>('select')
  const strokePropsRef = useRef({ strokeColor, strokeWidth })
  useEffect(() => {
    toolRef.current = tool
  }, [tool])
  useEffect(() => {
    strokePropsRef.current = { strokeColor, strokeWidth }
  }, [strokeColor, strokeWidth])

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

    // Undo/redo (wired as documented by maxGraph).
    const undoManager = new UndoManager()
    const onUndoEvent = (sender: unknown, evt: { getProperty?: (k: string) => unknown }) => {
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

    // Two-click arrow creation (or drag from a cell: ConnectionHandler).
    const onMouseUp = (
      sender: unknown,
      me: { state?: { cell?: MaxCell | null } | null }
    ) => {
      if (toolRef.current !== 'arrow') return
      const cell = me?.state && me.state.cell ? me.state.cell : null
      if (!cell || !graph.isEnabled()) return
      if (!arrowSourceRef.current) {
        arrowSourceRef.current = cell
        showStatus(t('drawio_arrow_hint'), 'success')
        return
      }
      if (cell !== arrowSourceRef.current) {
        graph.insertEdge({
          parent: graph.getDefaultParent(),
          source: arrowSourceRef.current,
          target: cell,
          value: '',
          style: { endArrow: 'classic' },
        })
        bump()
      }
      arrowSourceRef.current = null
      setTool('select')
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

    return () => {
      cancelAnimationFrame(raf)
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
      arrowSourceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- pencil (freehand) ----------------------------------------------------
  useEffect(() => {
    const graph = graphRef.current
    const container = containerRef.current
    if (!graph || !container || tool !== 'pencil') return

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
  }, [tool, bump])

  // ---- toolbar actions ------------------------------------------------------
  const nextInsertPosition = useCallback((): [number, number] => {
    const graph = graphRef.current
    if (!graph) return [40, 40]
    const b = graph.getGraphBounds()
    if (!b || b.width === 0 || b.height === 0) return [40, 40]
    return [b.x + b.width + 40, b.y + 40]
  }, [])

  const addVertex = useCallback(
    (
      style: Record<string, unknown>,
      size: [number, number],
      value: string
    ) => {
      const graph = graphRef.current
      if (!graph) return
      const [x, y] = nextInsertPosition()
      const cell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        position: [x, y],
        size,
        value,
        style,
      })
      graph.setSelectionCell(cell)
      bump()
    },
    [bump, nextInsertPosition]
  )

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

  const toolButton = (value: Tool, label: string) => (
    <OLButton
      size="sm"
      variant={tool === value ? 'primary' : 'secondary'}
      onClick={() => setTool(value)}
    >
      {label}
    </OLButton>
  )

  const addShape = (value: Tool) => {
    if (value === 'rectangle') {
      addVertex({ fillColor: '#fdf7e2' }, RECT_SIZE, '')
    } else if (value === 'ellipse') {
      addVertex({ shape: 'ellipse', fillColor: '#fdf7e2' }, ELLIPSE_SIZE, '')
    } else if (value === 'text') {
      addVertex(
        { shape: 'label', fillColor: 'none', strokeColor: 'none', fontSize: 18 },
        TEXT_SIZE,
        'Text'
      )
    } else {
      setTool(value)
    }
  }

  return (
    <div style={outerStyle}>
      <div style={toolbarStyle}>
        {toolButton('select', t('drawio_tool_select'))}
        <OLButton
          size="sm"
          variant="secondary"
          onClick={() => addShape('rectangle')}
        >
          {t('drawio_tool_rectangle')}
        </OLButton>
        <OLButton
          size="sm"
          variant="secondary"
          onClick={() => addShape('ellipse')}
        >
          {t('drawio_tool_ellipse')}
        </OLButton>
        <OLButton
          size="sm"
          variant="secondary"
          onClick={() => addShape('text')}
        >
          {t('drawio_tool_text')}
        </OLButton>
        {toolButton('arrow', t('drawio_tool_arrow'))}
        {toolButton('pencil', t('drawio_tool_pencil'))}
        <span style={separatorStyle} />
        <OLButton size="sm" variant="secondary" onClick={deleteSelection}>
          {t('drawio_delete')}
        </OLButton>
        <OLButton
          size="sm"
          variant="secondary"
          onClick={undo}
          disabled={!undoRef.current?.canUndo()}
        >
          {t('drawio_undo')}
        </OLButton>
        <OLButton
          size="sm"
          variant="secondary"
          onClick={redo}
          disabled={!undoRef.current?.canRedo()}
        >
          {t('drawio_redo')}
        </OLButton>
        <span style={separatorStyle} />
        <OLButton size="sm" variant="secondary" onClick={() => graphRef.current?.zoomIn()}>
          {t('drawio_zoom_in')}
        </OLButton>
        <OLButton size="sm" variant="secondary" onClick={() => graphRef.current?.zoomOut()}>
          {t('drawio_zoom_out')}
        </OLButton>
        <OLButton size="sm" variant="secondary" onClick={fitAll}>
          {t('drawio_fit')}
        </OLButton>
        <span style={separatorStyle} />
        <label
          style={swatchStyle}
          title={t('drawio_stroke_color')}
          aria-label={t('drawio_stroke_color')}
        >
          <input
            type="color"
            value={strokeColor}
            onChange={e => {
              setStrokeColor(e.target.value)
              applyStyle('strokeColor', e.target.value)
            }}
          />
        </label>
        <label
          style={swatchStyle}
          title={t('drawio_fill_color')}
          aria-label={t('drawio_fill_color')}
        >
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
          style={widthSelectStyle}
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
      {importError && (
        <div style={bannerStyle}>{t('drawio_load_failed')}</div>
      )}
      <div ref={containerRef} style={canvasStyle} />
      {exporting && <div style={statusPillStyle}>{t('drawio_exporting')}</div>}
      {status && !exporting && (
        <div
          style={{
            ...statusPillStyle,
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
  )
}

const outerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-light-primary, #fff)',
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  padding: '6px 8px',
  borderBottom: '1px solid var(--border-strong, #ccc)',
  background: 'var(--bg-light-tertiary, #f7f6f3)',
}

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: 'var(--border-strong, #ccc)',
  margin: '0 4px',
}

const swatchStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 4px',
}

const widthSelectStyle: React.CSSProperties = {
  padding: '2px 4px',
  fontSize: 13,
}

const bannerStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  background: 'rgba(255, 196, 0, 0.2)',
  borderBottom: '1px solid rgba(200, 150, 0, 0.5)',
}

const canvasStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  userSelect: 'none',
  touchAction: 'none',
}

const statusPillStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  right: 12,
  padding: '6px 14px',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.7)',
  color: '#fff',
  fontSize: 13,
  zIndex: 20,
  pointerEvents: 'none',
}
