import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useFileTreeOpenContext } from '@/features/ide-react/context/file-tree-open-context'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import LoadingSpinner from '@/shared/components/loading-spinner'
import OLNotification from '@/shared/components/ol/ol-notification'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import getMeta from '@/utils/meta'
import { findInTree } from '@/features/file-tree/util/find-in-tree'
import type { Folder } from '../../../../../types/folder'
import {
  findParentFolderId,
  isEditableImage,
  type TreeNode,
} from '../util/toast-image-utils'
import { saveEditedImage } from '../util/toast-image-save'
import './toast-image-editor.css'

const SIZE_POLL_ATTEMPTS = 100
const SIZE_POLL_DELAY_MS = 15

type EditorFile = {
  _id: string
  name: string
  hash: string
}

// eslint-disable-next-line import/first
type TuiImageEditorInstance = {
  on: (event: string, cb: () => void) => void
  off: (event: string, cb?: () => void) => void
  loadImage: (options: {
    path: string
    name?: string
  }) => Promise<void>
  toDataURL: (options?: {
    format?: string
    quality?: number
  }) => string
  destroy: () => void
}

type TuiImageEditorCtor = new (
  el: HTMLElement,
  options?: Record<string, unknown>
) => TuiImageEditorInstance

export default function ToastImageFileViewButton({
  file,
}: {
  file: EditorFile
}) {
  if (!isEditableImage(file.name)) {
    return null
  }
  return <EditImageButton file={file} />
}

function EditImageButton({ file }: { file: EditorFile }) {
  const { t } = useTranslation()
  const [showEditor, setShowEditor] = useState(false)

  return (
    <>
      <div style={{ display: 'inline-block', marginLeft: '8px' }}>
        <OLButton
          variant="secondary"
          onClick={() => setShowEditor(true)}
        >
          <MaterialIcon type="edit" className="align-middle" />{' '}
          <span>{t('edit_image')}</span>
        </OLButton>
      </div>
      {showEditor && (
        <ImageEditorModal file={file} onClose={() => setShowEditor(false)} />
      )}
    </>
  )
}

/**
 * Full-screen TUI Image Editor for a project image file.
 *
 * Fixes over the original CE+ implementation:
 * - deterministic init (waits for a non-zero container size; no blind
 *   setTimeout + MutationObserver button hiding),
 * - unsaved-changes guard (dirty tracking + confirm dialog),
 * - verified upload flow (response.ok checks, real error display),
 * - canonical post-save refresh: the replaced file is re-selected through
 *   the file-tree-open context (no magic CustomEvent),
 * - gif support (CE file views already preview gif).
 */
function ImageEditorModal({
  file,
  onClose,
}: {
  file: EditorFile
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { handleFileTreeSelect } = useFileTreeOpenContext()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<TuiImageEditorInstance | null>(null)
  const mountedRef = useRef(true)
  const dirtyRef = useRef(false)
  const treeRef = useRef<TreeNode | null>(null)

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [initTick, setInitTick] = useState(0)

  useEffect(() => {
    treeRef.current = (fileTreeData as unknown as TreeNode) ?? null
  }, [fileTreeData])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const editor = editorRef.current
      editorRef.current = null
      if (editor && typeof editor.destroy === 'function') {
        try {
          editor.destroy()
        } catch (e) {
          // already destroyed
        }
      }
    }
  }, [])

  // Deterministic editor init (T1): the modal may not have settled when we
  // first mount, so wait for a non-zero size before handing the container to
  // TUI (which renders into zero-sized canvases otherwise). No blind
  // timeouts, no DOM-mutation button hiding (TUI is configured without load
  // buttons, and the CSS keeps them hidden defensively).
  useEffect(() => {
    let cancelled = false
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    const init = async () => {
      const container = containerRef.current
      if (!container) return
      for (let i = 0; i < SIZE_POLL_ATTEMPTS; i++) {
        if (cancelled) return
        const rect = container.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) break
        await sleep(SIZE_POLL_DELAY_MS)
      }
      if (cancelled) return
      try {
        const editorModule = (await import('tui-image-editor')) as any
        await import('tui-image-editor/dist/tui-image-editor.css')
        if (cancelled || !mountedRef.current) return
        const ImageEditorCtor: TuiImageEditorCtor =
          editorModule.default ?? editorModule.ImageEditor

        const mount = document.createElement('div')
        mount.style.width = '100%'
        mount.style.height = '100%'
        container.appendChild(mount)

        const editor = new ImageEditorCtor(mount, {
          includeUI: {
            // Load the project image at construction time (the old CE+
            // version's approach, proven in this environment).
            loadImage: {
              path: `/project/${projectId}/blob/${file.hash}`,
              name: file.name,
            },
            menu: ['resize', 'filter', 'draw', 'shape', 'text', 'guide'],
            initMenu: 'shape',
            uiSize: { width: '100%', height: '100%' },
            menuBarPosition: 'top',
            // The classic (CE+) working configuration disables TUI's built-in
            // load/download buttons; with them enabled the bundled build
            // crashes at construction ("n is not a constructor"). We drive
            // the UI from our own toolbar (modal footer Save/Close).
            loadButton: false,
            downloadButton: false,
            // TUI's standard theme fetches its brand icon sheet from
            // uicdn.toast.com, which the IDE CSP blocks and which crashes
            // editor init. Disable the brand slot entirely (the old CE+
            // version did exactly this): no external fetch, no third-party
            // branding, TUI stays fully self-contained inside the image.
            theme: {
              'common.bi.image': '',
              'common.bisize.width': '0',
              'common.bisize.height': '0',
              'common.backgroundImage': 'none',
              'common.backgroundColor': '#1e1e1e',
              'header.backgroundImage': 'none',
              'header.backgroundColor': '#2d2d2d',
              'menu.normalIcon.color': '#ccc',
              'menu.activeIcon.color': '#fff',
              'menu.disabledIcon.color': '#555',
              'menu.hoverIcon.color': '#fff',
              'submenu.backgroundColor': '#2d2d2d',
              'submenu.partition.color': '#444',
              'submenu.normalIcon.color': '#ccc',
              'submenu.activeIcon.color': '#fff',
              'submenu.normalLabel.color': '#ccc',
              'submenu.activeLabel.color': '#fff',
              'checkbox.border': '1px solid #ccc',
              'range.pointer.color': '#fff',
              'range.bar.color': '#555',
              'range.subbar.color': '#fff',
              'range.disabledPointer.color': '#555',
              'range.disabledBar.color': '#333',
              'range.disabledSubbar.color': '#555',
              'range.value.color': '#fff',
              'range.value.fontWeight': 'lighter',
              'range.value.fontSize': '11px',
              'range.value.border': '1px solid #555',
              'range.value.backgroundColor': '#1e1e1e',
              'range.title.color': '#fff',
              'range.title.fontWeight': 'lighter',
              'colorpicker.button.border': '1px solid #555',
              'colorpicker.title.color': '#fff',
            },
          },
          cssMaxWidth: container.clientWidth || 800,
          cssMaxHeight: container.clientHeight || 520,
          usageStatistics: false,
        })
        editor.on('image:updated', () => {
          dirtyRef.current = true
        })
        editorRef.current = editor
        await editor.loadImage({
          path: `/project/${projectId}/blob/${file.hash}`,
          name: file.name,
        })
        if (cancelled || !mountedRef.current) return
        setReady(true)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to initialize image editor:', err)
        if (!cancelled && mountedRef.current) {
          setFailed(true)
          setError(t('image_edit_failed'))
        }
      }
    }

    void init()
    return () => {
      cancelled = true
    }
    // initTick allows re-running the initialization on "retry".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initTick])

  const requestClose = useCallback(() => {
    if (saving) return
    if (dirtyRef.current && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }, [saving, confirmDiscard, onClose])

  // T3: after the (replacing) upload succeeds, the real-time socket updates
  // the file tree. Wait briefly for the new file ref to appear, then
  // re-select it through the file-tree-open context — the canonical way to
  // refresh the file view (new hash → new preview). Falls back gracefully
  // if it never shows up (the tree still updates via the socket).
  const handleSave = useCallback(
    async () => {
      const editor = editorRef.current
      if (!editor || saving) return
      setSaving(true)
      setError(null)
      try {
        const tree = treeRef.current
        const folderId =
          (tree && findParentFolderId(tree, file._id)) || tree?._id || ''
        const result = await saveEditedImage({
          projectId,
          file: { name: file.name },
          folderId,
          csrfToken: (getMeta('ol-csrfToken') as string) || '',
          fetchImpl: fetch,
          toDataURL: (options?: {
            format?: string
            quality?: number
          }) => editor.toDataURL(options),
          t,
        })
        if (!result.ok) {
          throw new Error(result.error)
        }
        const uploadedId = result.uploadedId

        if (uploadedId) {
          let newRef = null
          const deadline = Date.now() + 4_000
          const sleep = (ms: number) =>
            new Promise(r => setTimeout(r, ms))
          while (Date.now() < deadline) {
            const currentTree = treeRef.current
            if (currentTree) {
              newRef = findInTree(
                currentTree as unknown as Folder,
                uploadedId
              )
            }
            if (newRef) break
            await sleep(150)
          }
          if (newRef && mountedRef.current) {
            handleFileTreeSelect([newRef])
          }
        }

        if (mountedRef.current) {
          setError(null)
        }
        onClose()
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error('Failed to save image:', err)
        if (mountedRef.current) {
          setError(err?.message || t('image_edit_failed'))
        }
      } finally {
        if (mountedRef.current) {
          setSaving(false)
        }
      }
    },
    [file, projectId, saving, onClose, handleFileTreeSelect, t]
  )

  return (
    <OLModal
      size="lg"
      show
      className="toast-image-editor-modal"
      onHide={requestClose}
    >
      <OLModalHeader>
        <OLModalTitle>
          {t('edit_image')} – {file.name}
        </OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {failed ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: '48px 24px',
            }}
          >
            <p>{t('image_edit_failed')}</p>
            <OLButton
              variant="primary"
              onClick={() => {
                setFailed(false)
                setError(null)
                dirtyRef.current = false
                setInitTick(n => n + 1)
              }}
            >
              {t('retry', 'Retry')}
            </OLButton>
          </div>
        ) : (
          <>
            {error && (
              <OLNotification type="error" content={error} />
            )}
            {!ready && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '24px 0',
                }}
              >
                <LoadingSpinner />
              </div>
            )}
            <div
              ref={containerRef}
              style={{
                position: 'relative',
                width: '100%',
                height: '70vh',
                minHeight: 360,
              }}
            />
          </>
        )}
      </OLModalBody>
      <OLModalFooter>
        {confirmDiscard ? (
          <>
            <span style={{ marginRight: 'auto' }}>
              {t('unsaved_image_changes')}
            </span>
            <OLButton
              variant="secondary"
              onClick={() => setConfirmDiscard(false)}
            >
              {t('keep_editing', 'Keep editing')}
            </OLButton>
            <OLButton
              variant="danger"
              onClick={() => {
                onClose()
              }}
            >
              {t('discard', 'Discard')}
            </OLButton>
          </>
        ) : (
          <>
            <OLButton variant="secondary" onClick={requestClose}>
              {t('close')}
            </OLButton>
            <OLButton
              variant="primary"
              onClick={() => void handleSave()}
              disabled={!ready || saving}
            >
              {t('save')}
            </OLButton>
          </>
        )}
      </OLModalFooter>
    </OLModal>
  )
}
