import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useEffect,
  Dispatch,
  SetStateAction,
  FC,
  useState,
  useRef,
} from 'react'
import useDetachLayout from '../hooks/use-detach-layout'
import localStorage from '../../infrastructure/local-storage'
import getMeta from '../../utils/meta'
import { DetachRole } from './detach-context'
import { debugConsole } from '@/utils/debugging'
import { BinaryFile } from '@/features/file-view/types/binary-file'
import useScopeEventEmitter from '@/shared/hooks/use-scope-event-emitter'
import useEventListener from '@/shared/hooks/use-event-listener'
import { isMac } from '@/shared/utils/os'
import { sendSearchEvent } from '@/features/event-tracking/search-events'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import { repositionAllTooltips } from '@/features/source-editor/extensions/tooltips-reposition'
import { useEditorAnalytics } from '@/shared/hooks/use-editor-analytics'
import { useFeatureFlag } from './split-test-context'
import { useMobileLayout } from '../hooks/use-mobile-layout'
import { getEffectivePdfLayout } from '../utils/mobile-viewport'

export type IdeLayout = 'sideBySide' | 'flat'
export type IdeView = 'editor' | 'file' | 'pdf' | 'history'

export type LayoutContextOwnStates = {
  view: IdeView | null
  chatIsOpen: boolean
  reviewPanelOpen: boolean
  miniReviewPanelVisible: boolean
  settingsShown: boolean
  loadingStyleSheet: boolean
  pdfLayout: IdeLayout
  projectSearchIsOpen: boolean
  openFile: BinaryFile | null
  focusMode: boolean
}

export type LayoutContextValue = LayoutContextOwnStates & {
  reattach: () => void
  detach: () => void
  detachIsLinked: boolean
  detachRole: DetachRole
  changeLayout: (newLayout: IdeLayout, newView?: IdeView) => void
  setView: (view: IdeView | null) => void
  /**
   * True when the mobile IDE layout is active (see the mobile plan).
   * Desktop code must not branch on this except via additive branches that
   * are no-ops when false.
   */
  isMobileLayout: boolean
  setChatIsOpen: Dispatch<SetStateAction<LayoutContextValue['chatIsOpen']>>
  setReviewPanelOpen: Dispatch<
    SetStateAction<LayoutContextValue['reviewPanelOpen']>
  >
  setMiniReviewPanelVisible: Dispatch<
    SetStateAction<LayoutContextValue['miniReviewPanelVisible']>
  >
  setSettingsShown: Dispatch<
    SetStateAction<LayoutContextValue['settingsShown']>
  >
  setLoadingStyleSheet: Dispatch<
    SetStateAction<LayoutContextValue['loadingStyleSheet']>
  >
  pdfPreviewOpen: boolean
  setProjectSearchIsOpen: Dispatch<SetStateAction<boolean>>
  setOpenFile: Dispatch<SetStateAction<BinaryFile | null>>
  restoreView: () => void
  handleChangeLayout: (newLayout: IdeLayout, newView?: IdeView) => void
  handleDetach: () => void
  setFocusMode: Dispatch<SetStateAction<LayoutContextValue['focusMode']>>
}

const debugPdfDetach = getMeta('ol-debugPdfDetach')

export const LayoutContext = createContext<LayoutContextValue | undefined>(
  undefined
)

function setLayoutInLocalStorage(pdfLayout: IdeLayout) {
  localStorage.setItem(
    'pdf.layout',
    pdfLayout === 'sideBySide' ? 'split' : 'flat'
  )
}

const reviewPanelStorageKey = `ui.reviewPanelOpen.${getMeta('ol-project_id')}`

export const LayoutProvider: FC<React.PropsWithChildren> = ({ children }) => {
  // what to show in the "flat" view (editor or pdf)
  const { isEnabled: mobileLayoutEnabled } = useMobileLayout()
  const [openFile, setOpenFile] = useState<BinaryFile | null>(null)
  const historyToggleEmitter = useScopeEventEmitter('history:toggle', true)
  const { isOpen: railIsOpen, setIsOpen: setRailIsOpen } = useRailContext()
  const [prevRailIsOpen, setPrevRailIsOpen] = useState(railIsOpen)
  // Whether we came from a file or a document when we left the ide
  const lastIdeView = useRef<IdeView>('editor')
  const { sendEvent } = useEditorAnalytics()

  // Initialize the view and pdf layout, forcing a single-pane layout on
  // mobile (see mobile plan, Phase 0). Desktop layout state is unchanged.
  const [view, _setView] = useState<IdeView | null>('editor')

  const setView = useCallback(
    (value: IdeView | null) => {
      _setView(oldValue => {
        // ensure that the "history:toggle" event is broadcast when switching in or out of history view
        if (value === 'history' || oldValue === 'history') {
          historyToggleEmitter()
        }

        if (value === 'history') {
          setPrevRailIsOpen(railIsOpen)
          setRailIsOpen(true)
        }

        if (oldValue === 'history') {
          setRailIsOpen(prevRailIsOpen)
        }

        if (value === 'editor' || value === 'file') {
          lastIdeView.current = value
        }

        return value
      })
    },
    [
      _setView,
      setRailIsOpen,
      historyToggleEmitter,
      prevRailIsOpen,
      setPrevRailIsOpen,
      railIsOpen,
    ]
  )

  const restoreView = useCallback(() => {
    setView(lastIdeView.current ?? 'editor')
  }, [setView])

  // whether the chat pane is open
  const [chatIsOpen, setChatIsOpen] = usePersistedState<boolean>(
    'ui.chatOpen',
    false
  )

  // whether the review pane is open
  const [reviewPanelOpen, setReviewPanelOpen] = usePersistedState<boolean>(
    reviewPanelStorageKey,
    false
  )

  // whether the review pane is collapsed
  const [miniReviewPanelVisible, setMiniReviewPanelVisible] =
    useState<boolean>(false)

  // whether the settings modal is open
  const [settingsShown, setSettingsShown] = useState<boolean>(false)

  // whether the project search is open
  const [projectSearchIsOpen, setProjectSearchIsOpen] = useState(false)

  // whether to display the editor and preview side-by-side or full-width ("flat")
  // Desktop: always start in 'sideBySide' (byte-for-byte with pre-mobile
  // behavior; the `pdf.layout` storage key is write-only on desktop).
  // Mobile: always start flat (single-pane, see mobile plan Phase 0).
  const [pdfLayout, setPdfLayout] = useState<IdeLayout>(() =>
    getEffectivePdfLayout(mobileLayoutEnabled)
  )

  const [persistedFocusMode, setPersistedFocusMode] =
    usePersistedState<boolean>('ui.focus-mode', false)

  const focusModeEnabled = useFeatureFlag('focus-mode')

  const focusMode = focusModeEnabled && persistedFocusMode
  const setFocusMode = useCallback(
    (value: SetStateAction<boolean>) => {
      if (focusModeEnabled) {
        const newValue = typeof value === 'function' ? value(focusMode) : value
        setPersistedFocusMode(newValue)
        sendEvent('project-layout-change', {
          layout: pdfLayout,
          view: view ?? undefined,
          focusMode: newValue,
        })
      }
    },
    [
      focusMode,
      focusModeEnabled,
      pdfLayout,
      sendEvent,
      setPersistedFocusMode,
      view,
    ]
  )

  useEventListener(
    'ui.toggle-settings',
    useCallback(
      (event: CustomEvent<boolean>) => {
        setSettingsShown(event.detail)
      },
      [setSettingsShown]
    )
  )

  // TODO ide-redesign-cleanup: remove this listener as we have an equivalent in rail-context
  useEventListener(
    'ui.toggle-review-panel',
    useCallback(() => {
      setReviewPanelOpen(open => !open)
    }, [setReviewPanelOpen])
  )

  useEventListener(
    'ui.toggle-focus-mode',
    useCallback(() => {
      setFocusMode(mode => !mode)
    }, [setFocusMode])
  )

  // Global keyboard shortcut handlers
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd/Ctrl+Shift+F for full project search
      if (
        (isMac ? event.metaKey : event.ctrlKey) &&
        event.shiftKey &&
        event.key.toUpperCase() === 'F'
      ) {
        event.preventDefault()
        sendSearchEvent('search-open', {
          searchType: 'full-project',
          method: 'keyboard',
        })
        setProjectSearchIsOpen(true)
      }
      // Cmd/Ctrl+Shift+M for focus mode
      if (
        focusModeEnabled &&
        (isMac ? event.metaKey : event.ctrlKey) &&
        event.shiftKey &&
        event.key.toUpperCase() === 'M'
      ) {
        event.preventDefault()
        setFocusMode(mode => !mode)
      }
    }

    // Use capture phase to ensure we get the event even if something else stops propagation
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [focusModeEnabled, setFocusMode, setProjectSearchIsOpen])

  // whether stylesheet on theme is loading
  const [loadingStyleSheet, setLoadingStyleSheet] = useState(false)

  const changeLayout = useCallback(
    (newLayout: IdeLayout, newView: IdeView = 'editor') => {
      const targetView = newLayout === 'sideBySide' ? 'editor' : newView
      setPdfLayout(newLayout)
      if (targetView === 'editor') {
        restoreView()
      } else {
        setView(targetView)
      }
      setLayoutInLocalStorage(newLayout)
    },
    [setPdfLayout, setView, restoreView]
  )

  // Desktop: pdfLayout always starts side-by-side; on mobile the layout is
  // forced flat (single-pane). This effect handles the *transition* (mobile
  // <-> desktop, e.g. rotating to landscape): it only fires when
  // `mobileLayoutEnabled` actually changes (the guard avoids re-firing on
  // every state change that re-creates deps), and it only touches
  // *pdfLayout* — it must NOT reset `view` (bug H1: the drawer open/close
  // used to re-run `changeLayout` and reset `view` to 'editor', so a user
  // viewing the PDF lost their PDF view just by opening the drawer; bug
  // M3.5: leaving mobile used to leave it in flat mode). On mobile the
  // initial flat layout comes from `getEffectivePdfLayout`, so the effect
  // only needs to persist it here.
  const prevMobileLayoutEnabled = useRef(mobileLayoutEnabled)
  useEffect(() => {
    if (mobileLayoutEnabled === prevMobileLayoutEnabled.current) {
      return
    }
    prevMobileLayoutEnabled.current = mobileLayoutEnabled
    if (mobileLayoutEnabled) {
      // entering mobile: force single-pane (view is already forced-flat
      // on first render by `getEffectivePdfLayout`; keep it if the
      // user is mid-navigation, e.g. rotating a phone into the IDE).
      setPdfLayout('flat')
    } else {
      // leaving mobile (rotated to >=768px, etc.): restore the desktop
      // default so the desktop layout doesn't stay in 'flat'. The LS
      // `pdf.layout` key is write-only on desktop (never read for init),
      // so persisting the mobile layout is inert on desktop.
      setPdfLayout('sideBySide')
    }
  }, [mobileLayoutEnabled, setPdfLayout])

  // Force codemirror to reposition all tooltips to prevent an issue
  // where tooltips would sometimes show on top of the pdf preview
  // https://github.com/overleaf/internal/issues/23840
  useEffect(() => {
    if (view === 'pdf' && pdfLayout === 'flat') {
      repositionAllTooltips()
    }
  }, [view, pdfLayout])

  const {
    reattach,
    detach,
    isLinking: detachIsLinking,
    isLinked: detachIsLinked,
    role: detachRole,
    isRedundant: detachIsRedundant,
  } = useDetachLayout()

  const pdfPreviewOpen =
    pdfLayout === 'sideBySide' || view === 'pdf' || detachRole === 'detacher'

  useEffect(() => {
    if (debugPdfDetach) {
      debugConsole.warn('Layout Effect', {
        detachIsRedundant,
        detachRole,
        detachIsLinking,
        detachIsLinked,
      })
    }

    if (detachRole !== 'detacher') return // not in a PDF detacher layout

    if (detachIsRedundant) {
      changeLayout('sideBySide')
      return
    }

    if (detachIsLinking || detachIsLinked) {
      // the tab is linked to a detached tab (or about to be linked); show
      // editor only
      changeLayout('flat', 'editor')
    }
  }, [
    detachIsRedundant,
    detachRole,
    detachIsLinking,
    detachIsLinked,
    changeLayout,
  ])

  const handleDetach = useCallback(() => {
    detach()
    sendEvent('project-layout-detach')
  }, [detach, sendEvent])

  const handleReattach = useCallback(() => {
    if (detachRole !== 'detacher') {
      return
    }
    reattach()
    sendEvent('project-layout-reattach')
  }, [detachRole, reattach, sendEvent])

  const handleChangeLayout = useCallback(
    (newLayout: IdeLayout, newView?: IdeView) => {
      handleReattach()
      changeLayout(newLayout, newView)
      sendEvent('project-layout-change', {
        layout: newLayout,
        view: newView,
        focusMode,
      })
    },
    [changeLayout, focusMode, handleReattach, sendEvent]
  )

  useEventListener(
    'keydown',
    useCallback(
      (event: KeyboardEvent) => {
        if (
          isMac &&
          event.metaKey &&
          event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          switch (event.code) {
            case 'ArrowLeft': // Editor only
              event.preventDefault()
              handleChangeLayout('flat', 'editor')
              break
            case 'ArrowRight': // PDF only
              event.preventDefault()
              handleChangeLayout('flat', 'pdf')
              break
            case 'ArrowDown': // Split view
              event.preventDefault()
              handleChangeLayout('sideBySide')
              break
            case 'ArrowUp': // Open PDF in separate tab (detach)
              event.preventDefault()
              if ('BroadcastChannel' in window && detachRole !== 'detacher') {
                handleDetach()
              }
              break
          }
        }
      },
      [detachRole, handleChangeLayout, handleDetach]
    )
  )

  const value = useMemo<LayoutContextValue>(
    () => ({
      reattach,
      detach,
      detachIsLinked,
      detachRole,
      changeLayout,
      chatIsOpen,
      settingsShown,
      openFile,
      pdfLayout,
      isMobileLayout: mobileLayoutEnabled,
      pdfPreviewOpen,
      projectSearchIsOpen,
      setProjectSearchIsOpen,
      reviewPanelOpen,
      miniReviewPanelVisible,
      loadingStyleSheet,
      setChatIsOpen,
      setSettingsShown,
      setOpenFile,
      setPdfLayout,
      setReviewPanelOpen,
      setMiniReviewPanelVisible,
      setLoadingStyleSheet,
      setView,
      view,
      restoreView,
      handleChangeLayout,
      handleDetach,
      focusMode,
      setFocusMode,
    }),
    [
      reattach,
      detach,
      detachIsLinked,
      detachRole,
      changeLayout,
      chatIsOpen,
      settingsShown,
      openFile,
      pdfLayout,
      pdfPreviewOpen,
      projectSearchIsOpen,
      setProjectSearchIsOpen,
      reviewPanelOpen,
      miniReviewPanelVisible,
      loadingStyleSheet,
      setChatIsOpen,
      setSettingsShown,
      setOpenFile,
      setPdfLayout,
      setReviewPanelOpen,
      setMiniReviewPanelVisible,
      setLoadingStyleSheet,
      setView,
      view,
      restoreView,
      handleChangeLayout,
      handleDetach,
      focusMode,
      setFocusMode,
      mobileLayoutEnabled,
    ]
  )

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  )
}

export function useLayoutContext() {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayoutContext is only available inside LayoutProvider')
  }
  return context
}
