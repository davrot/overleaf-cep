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
type TuiImageEditorUi = {
  on: (event: string, cb: (...args: unknown[]) => void) => void
  initializeImgUrl?: string
}

type TuiImageEditorInstance = {
  ui?: TuiImageEditorUi
  on: (event: string, cb: () => void) => void
  off: (event: string, cb?: () => void) => void
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

  // Deterministic editor init. Constraint notes (verified in
  // node_modules/tui-image-editor@3.15.3/dist/tui-image-editor.js):
  //   - Ui#_makeSubMenu does `new SUB_UI_COMPONENT[<Menu>]` per entry of
  //     options.menu; that map only holds Shape/Crop/Resize/Flip/Rotate/
  //     Text/Mask/Icon/Draw/Filter. Any other name (e.g. 'guide') is
  //     `new undefined` and throws "... is not a constructor" during
  //     construction. Wait for a non-zero container size first, as before.
  //   - The image must be loaded via includeUI.loadImage: only that path
  //     runs Ui#initCanvas -> activeMenuEvent, which activates the menus.
  //   - ImageEditor 3.15.3 has NO public loadImage(options) method
  //     (only loadImageFromFile/loadImageFromURL).
  // The option set matches the old (working) CE+ plugin exactly.
  useEffect(() => {
    let cancelled = false
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    const markReady = () => {
      if (!cancelled && mountedRef.current) {
        setReady(true)
      }
    }

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

        // Retry hygiene: dispose the previous instance + its DOM before
        // re-initializing into the same container (otherwise the new mount
        // div would nest inside the stale one).
        const prev = editorRef.current
        editorRef.current = null
        if (prev && typeof prev.destroy === 'function') {
          try {
            prev.destroy()
          } catch (e) {
            // already destroyed
          }
        }
        container.replaceChildren()

        const mount = document.createElement('div')
        mount.style.width = '100%'
        mount.style.height = '100%'
        container.appendChild(mount)

        const editor = new ImageEditorCtor(mount, {
          includeUI: {
            // Load the project image at construction time — exactly the
            // old working plugin's pattern. It is also the ONLY path that
            // activates TUI's menus (Ui#initCanvas -> activeMenuEvent).
            // Do not add an explicit loadImage() call afterwards: 3.15.3
            // has no such public method.
            loadImage: {
              path: `/project/${projectId}/blob/${file.hash}`,
              name: file.name,
            },
            // All entries must exist in TUI's SUB_UI_COMPONENT map (see
            // note above) — the old working plugin's menu set.
            menu: [
              'crop',
              'flip',
              'rotate',
              'draw',
              'shape',
              'icon',
              'text',
              'mask',
              'filter',
            ],
            initMenu: 'filter',
            uiSize: { width: '100%', height: '100%' },
            menuBarPosition: 'left',
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
        editorRef.current = editor

        // Readiness + dirty tracking: TUI fires its invoker events on the
        // UI instance (ImageEditor#_attachInvokerEvents). The invoker
        // fires 'executeCommand' with history name 'Load' when the
        // initial image load has settled; every other command (and
        // afterUndo/afterRedo) means the pixels were modified.
        const ui: TuiImageEditorUi | undefined = editor.ui
        if (ui && typeof ui.on === 'function') {
          const onCommand = (name: unknown) => {
            if (name === 'Load') {
              markReady()
            } else if (name) {
              dirtyRef.current = true
            }
          }
          ui.on('executeCommand', onCommand)
          const onHistory = () => {
            dirtyRef.current = true
          }
          ui.on('afterUndo', onHistory)
          ui.on('afterRedo', onHistory)
        }
        // Bounded fallback for the same completion signal: Ui sets
        // initializeImgUrl when the internal load promise settles (the
        // same .then that fires 'Load'). Keep Save disabled until the
        // image really is on the canvas — never upload a blank canvas
        // over a project file.
        const deadline = Date.now() + 20_000
        const tick = () => {
          if (cancelled || !mountedRef.current) return
          const uiNow = editorRef.current?.ui
          if (
            uiNow &&
            typeof uiNow.initializeImgUrl === 'string' &&
            uiNow.initializeImgUrl
          ) {
            markReady()
            return
          }
          if (Date.now() < deadline) {
            setTimeout(tick, 150)
          }
        }
        setTimeout(tick, 150)
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
