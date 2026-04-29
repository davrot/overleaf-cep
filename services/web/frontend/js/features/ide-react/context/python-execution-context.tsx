import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import getMeta from '@/utils/meta'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useProjectContext } from '@/shared/context/project-context'
import {
  PythonRunner,
  ExecutionContext,
} from '@/features/ide-react/components/editor/python/python-runner'

// Worker factory lives here (a .tsx file) so that the full
// `new Worker(new URL(..., import.meta.url))` expression is in a single place
// where webpack 5 can statically detect it and create a proper worker bundle.
// Keeping import.meta.url out of .ts files also avoids Node.js 24 switching to
// ESM mode and breaking CJS-based test loading via @babel/register.
const createPyodideWorker = () =>
  new Worker(
    /* webpackChunkName: "pyodide-worker" */
    new URL('../components/editor/python/pyodide.worker.ts', import.meta.url),
    { type: 'module' }
  )

export interface PythonExecutionContextValue {
  getPythonRunner: (fileId: string) => PythonRunner
}

export const PythonExecutionContext = createContext<
  PythonExecutionContextValue | undefined
>(undefined)

export const PythonExecutionProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const { openDocs } = useEditorManagerContext()
  const { projectSnapshot } = useProjectContext()
  const { pathInFolder } = useFileTreePathContext()
  const runnersRef = useRef(new Map<string, PythonRunner>())
  const baseAssetPathRef = useRef<string | null>(null)

  const pathInFolderRef = useRef(pathInFolder)
  pathInFolderRef.current = pathInFolder

  // Refreshes the project snapshot and resolves the source code and all project
  // files for the given fileId, to be passed to the executor for running.
  const getExecutionContext = useCallback(
    async (fileId: string): Promise<ExecutionContext | null> => {
      await openDocs.awaitBufferedOps(AbortSignal.timeout(5000))
      await projectSnapshot.refresh()

      const relativePath = pathInFolderRef.current(fileId)
      if (!relativePath) {
        return null
      }

      const code = projectSnapshot.getDocContents(relativePath)
      if (code == null) {
        return null
      }

      const docPaths = projectSnapshot.getDocPaths()
      const files = docPaths
        .map(docPath => {
          const content = projectSnapshot.getDocContents(docPath)
          return content != null ? { relativePath: docPath, content } : null
        })
        .filter(
          (f): f is { relativePath: string; content: string } => f != null
        )

      return { code, files }
    },
    [openDocs, projectSnapshot]
  )

  const getPythonRunner = useCallback(
    (fileId: string): PythonRunner => {
      const existing = runnersRef.current.get(fileId)
      if (existing) {
        return existing
      }

      if (!baseAssetPathRef.current) {
        baseAssetPathRef.current = new URL(
          getMeta('ol-baseAssetPath'),
          window.location.href
        ).toString()
      }

      const runner = new PythonRunner(
        fileId,
        baseAssetPathRef.current,
        () => getExecutionContext(fileId),
        createPyodideWorker
      )
      runner.init()
      runnersRef.current.set(fileId, runner)
      return runner
    },
    [getExecutionContext]
  )

  useEffect(() => {
    const runners = runnersRef.current
    return () => {
      for (const runner of runners.values()) {
        runner.destroy()
      }
      runners.clear()
    }
  }, [])

  const value = useMemo(() => ({ getPythonRunner }), [getPythonRunner])

  return (
    <PythonExecutionContext.Provider value={value}>
      {children}
    </PythonExecutionContext.Provider>
  )
}

export const usePythonExecutionContext = (): PythonExecutionContextValue => {
  const context = useContext(PythonExecutionContext)

  if (!context) {
    throw new Error(
      'usePythonExecutionContext is only available inside PythonExecutionContext.Provider'
    )
  }

  return context
}
