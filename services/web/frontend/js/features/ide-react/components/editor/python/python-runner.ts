// Per-file Python execution manager. Each PythonRunner owns a PyodideWorkerClient
// and exposes a subscribe/getState API for use with useSyncExternalStore,
// so React components can reactively read execution status and output.
import { v4 as uuid } from 'uuid'
import { debugConsole } from '@/utils/debugging'
import { PyodideWorkerClient } from './pyodide-worker-client'
import type { OutputStream } from './pyodide-worker-messages'
import type {
  BatchUploadItem,
  UploadResult,
} from '@/infrastructure/batch-file-uploader'

export type FileUploader = (items: BatchUploadItem[]) => Promise<UploadResult[]>

const MAX_OUTPUT_LINES = 100

export type ExecutionStatus =
  | 'loading'
  | 'idle'
  | 'running'
  | 'finished'
  | 'errored'

export type ExecutionContext = {
  code: string
  files: { relativePath: string; content: string }[]
}

type Listener = () => void

export type OutputLine = {
  stream: OutputStream
  line: string
}

export type PythonRunnerState = {
  output: OutputLine[]
  status: ExecutionStatus
  error: string | null
}

export const DEFAULT_STATE: PythonRunnerState = {
  output: [],
  status: 'loading',
  error: null,
}

export class PythonRunner {
  readonly fileId: string
  private client: PyodideWorkerClient | null = null
  private readonly baseAssetPath: string
  private readonly createWorker: () => Worker
  private readonly getExecutionContext: () => Promise<ExecutionContext | null>
  private readonly fileUploader: FileUploader

  private listeners = new Set<Listener>()

  private activeExecutionId: string | null = null
  private state: PythonRunnerState = DEFAULT_STATE

  constructor(
    fileId: string,
    baseAssetPath: string,
    getExecutionContext: () => Promise<ExecutionContext | null>,
    createWorker: () => Worker,
    fileUploader: FileUploader
  ) {
    this.fileId = fileId
    this.baseAssetPath = baseAssetPath
    this.createWorker = createWorker
    this.getExecutionContext = getExecutionContext
    this.fileUploader = fileUploader
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = () => this.state

  private updateState(fields: Partial<PythonRunnerState>) {
    const prev = this.state
    const output = fields.output ?? prev.output
    const status = fields.status ?? prev.status
    const error = fields.error !== undefined ? fields.error : prev.error

    if (
      output === prev.output &&
      status === prev.status &&
      error === prev.error
    ) {
      return
    }

    this.state = { output, status, error }

    for (const listener of this.listeners) {
      listener()
    }
  }

  init() {
    if (this.client) {
      return
    }

    this.updateState({ status: 'loading', error: null })

    this.client = new PyodideWorkerClient({
      baseAssetPath: this.baseAssetPath,
      createWorker: this.createWorker,
      fileUploader: this.fileUploader,
      onLifecycle: event => {
        switch (event.type) {
          case 'loaded':
            this.updateState({ status: 'idle', error: null })
            return

          case 'loading-failed':
            debugConsole.error('Failed to load Python runtime', event.error)
            this.updateState({ status: 'errored', error: event.error })
            return

          case 'run-finished': {
            if (
              event.fileId !== this.fileId ||
              this.activeExecutionId !== event.executionId
            ) {
              return
            }

            this.activeExecutionId = null
            this.updateState({ status: 'finished' })
          }
        }
      },
      onOutput: (stream, line, fileId, executionId) => {
        if (fileId !== this.fileId || this.activeExecutionId !== executionId) {
          return
        }
        this.updateState({
          output: appendCapped(this.state.output, { stream, line }),
        })
      },
    })
  }

  async run() {
    if (!this.client || this.state.status === 'loading') {
      return
    }

    let context: ExecutionContext | null
    try {
      context = await this.getExecutionContext()
    } catch (err) {
      debugConsole.error('Failed to build execution context', err)
      this.updateState({ status: 'errored', error: formatError(err) })
      return
    }

    // Re-check after await — status may have changed but TypeScript
    // still narrows from the pre-await check, so we cast back.
    if (
      !context ||
      !this.client ||
      (this.state.status as ExecutionStatus) === 'loading'
    ) {
      return
    }

    const { code, files } = context

    const executionId = uuid()
    this.activeExecutionId = executionId
    this.updateState({ status: 'running', output: [], error: null })

    try {
      this.client.runCode(code, {
        fileId: this.fileId,
        executionId,
        files,
      })
    } catch (runError) {
      if (this.activeExecutionId !== executionId) {
        return
      }
      this.activeExecutionId = null
      this.updateState({ status: 'errored', error: formatError(runError) })
    }
  }

  interrupt() {
    if (!this.client) {
      return
    }

    this.client.reset()
    this.activeExecutionId = null

    // The worker is terminated and recreated by reset(), so it needs to
    // reload Pyodide. The 'loaded' lifecycle callback will transition
    // back to 'idle'.
    this.updateState({
      status: 'loading',
      output:
        this.state.status === 'running'
          ? appendCapped(this.state.output, {
              stream: 'info',
              line: 'Execution interrupted',
            })
          : this.state.output,
    })
  }

  destroy() {
    if (this.client) {
      this.client.destroy()
      this.client = null
    }
  }
}

function appendCapped(existing: OutputLine[], entry: OutputLine): OutputLine[] {
  const updated = [...existing, entry]
  return updated.length > MAX_OUTPUT_LINES
    ? updated.slice(-MAX_OUTPUT_LINES)
    : updated
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
