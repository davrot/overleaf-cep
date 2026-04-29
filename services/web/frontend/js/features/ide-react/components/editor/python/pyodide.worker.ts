/// <reference lib="webworker" />
import path from 'path-browserify'
import type { PyodideInterface } from 'pyodide'
import type {
  OutputFileData,
  InitRequest,
  ProjectFileData,
  PyodideWorkerRequest,
  RunCodeRequest,
} from './pyodide-worker-messages'

type PyodideFS = PyodideInterface['FS']
type PyodideModule = typeof import('pyodide')

const PROJECT_FS_ROOT = '/project'
const PROJECT_FS_PREFIX = `${PROJECT_FS_ROOT}/`
const PYODIDE_INDEX_PATH = 'js/libs/pyodide/'

function ensureDirectoryExists(fs: PyodideFS, filePath: string) {
  const directory = path.dirname(filePath)
  if (directory === '.' || directory === '/') {
    return
  }

  let currentPath = directory.startsWith('/') ? '/' : ''
  for (const part of directory.split('/').filter(Boolean)) {
    currentPath = path.posix.join(currentPath, part)
    try {
      const analysis = fs.analyzePath(currentPath)
      if (!analysis.exists) {
        fs.mkdir(currentPath)
      }
    } catch {
      // Ignore failures when a directory already exists.
    }
  }
}

function syncProjectFiles(fs: PyodideFS, files: ProjectFileData[]) {
  for (const file of files) {
    const runtimePath = path.posix.join(
      PROJECT_FS_ROOT,
      path.posix.normalize(file.relativePath)
    )
    ensureDirectoryExists(fs, runtimePath)
    fs.writeFile(runtimePath, file.content)
  }

  fs.chdir(PROJECT_FS_ROOT)
}

let pyodideModule: PyodideModule | null = null
let pyodideIndexUrl: string | undefined

async function loadPyodideModule(pyodideIndexUrl: string) {
  const runtimeModuleUrl = `${pyodideIndexUrl}pyodide.mjs`

  try {
    return (await import(
      /* webpackIgnore: true */ runtimeModuleUrl
    )) as PyodideModule
  } catch (loadError) {
    const loadErrorMessage =
      loadError instanceof Error ? loadError.message : String(loadError)
    throw new Error(
      `Unable to load Pyodide module from ${runtimeModuleUrl}. Original error: ${loadErrorMessage}`
    )
  }
}

async function handleInit(msg: InitRequest) {
  pyodideIndexUrl = new URL(PYODIDE_INDEX_PATH, msg.baseAssetPath).toString()

  try {
    pyodideModule = await loadPyodideModule(pyodideIndexUrl)
    self.postMessage({ type: 'loaded' })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Pyodide initialization failed', error)
    self.postMessage({
      type: 'loading-failed',
      error: errorMessage,
    })
  }
}

async function handleRunCode(msg: RunCodeRequest) {
  const { fileId, executionId } = msg

  if (!pyodideModule || !pyodideIndexUrl) {
    self.postMessage({
      type: 'output-line',
      stream: 'stderr',
      line: 'Pyodide is not initialized',
      fileId,
      executionId,
    })
    self.postMessage({
      type: 'run-code-result',
      fileId,
      executionId,
      success: false,
      outputs: [],
      outputFiles: [],
    })
    return
  }

  const instance = await pyodideModule.loadPyodide({
    env: { MPLBACKEND: 'Agg' },
    packageBaseUrl: `${pyodideIndexUrl}${pyodideModule.version}/`,
  })

  const writtenPaths = new Set<string>()

  instance.setStdout({
    batched: (line: string) => {
      self.postMessage({
        type: 'output-line',
        stream: 'stdout',
        line,
        fileId,
        executionId,
      })
    },
  })
  instance.setStderr({
    batched: (line: string) => {
      self.postMessage({
        type: 'output-line',
        stream: 'stderr',
        line,
        fileId,
        executionId,
      })
    },
  })

  const fs = instance.FS
  const originalWrite = fs.write as PyodideFS['write']
  let runError: unknown = null
  try {
    if (msg.files.length > 0) {
      syncProjectFiles(fs, msg.files)
    }

    fs.write = ((...args: Parameters<PyodideFS['write']>) => {
      const [stream] = args
      // Only surface writes to the synced project workspace, not Pyodide internals.
      if (
        typeof stream?.path === 'string' &&
        stream.path.startsWith(PROJECT_FS_PREFIX)
      ) {
        writtenPaths.add(stream.path)
      }

      return originalWrite.call(fs, ...args)
    }) as PyodideFS['write']

    await instance.loadPackagesFromImports(msg.code)
    const result = await instance.runPythonAsync(msg.code)
    if (result !== undefined) {
      self.postMessage({
        type: 'output-line',
        stream: 'stdout',
        line: String(result),
        fileId,
        executionId,
      })
    }
  } catch (e) {
    runError = e
  }
  fs.write = originalWrite

  const paths = [...writtenPaths]

  if (runError) {
    const errorMessage =
      runError instanceof Error ? runError.message : String(runError)

    self.postMessage({
      type: 'output-line',
      stream: 'stderr',
      line: errorMessage,
      fileId,
      executionId,
    })
    self.postMessage({
      type: 'run-code-result',
      fileId,
      executionId,
      success: false,
      outputs: paths,
      outputFiles: [],
    })
    return
  }

  const outputFiles: OutputFileData[] = []
  const transferables: Transferable[] = []
  for (const writtenPath of paths) {
    const content = fs.readFile(writtenPath)
    const relativePath = writtenPath.slice(PROJECT_FS_PREFIX.length)
    outputFiles.push({ relativePath, content })
    if (content.buffer instanceof ArrayBuffer) {
      transferables.push(content.buffer)
    }
  }

  // The transferables moves ownership of each ArrayBuffer to the main thread
  // instead of structured-cloning it. The buffers are already referenced from
  // outputFiles.content; listing them here just swaps copy for move, so file
  // contents travel through once rather than being allocated on both sides.
  self.postMessage(
    {
      type: 'run-code-result',
      fileId,
      executionId,
      success: true,
      outputs: paths,
      outputFiles,
    },
    transferables
  )
}

self.addEventListener('message', async event => {
  const msg = event.data as PyodideWorkerRequest
  switch (msg.type) {
    case 'init':
      await handleInit(msg)
      break
    case 'run-code':
      await handleRunCode(msg)
      break
  }
})

self.postMessage({ type: 'listening' })
