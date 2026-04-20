import type {
  ProjectFileData,
  PyodideWorkerRequest,
  PyodideWorkerResponse,
} from './pyodide-worker-messages'

export type OutputCallback = (
  stream: 'stdout' | 'stderr',
  line: string,
  fileId: string,
  executionId: string
) => void

export type LifecycleCallback = (
  event:
    | { type: 'loaded' }
    | { type: 'loading-failed'; error: string }
    | {
        type: 'run-finished'
        fileId: string
        executionId: string
        outputs: string[]
      }
) => void

export class PyodideWorkerClient {
  private worker: Worker
  private baseAssetPath: string
  private createWorker: () => Worker
  private listening = false
  private destroyed = false
  private loadingError: string | null = null
  private pendingMessages: PyodideWorkerRequest[] = []
  private outputCallback: OutputCallback | null
  private lifecycleCallback: LifecycleCallback | null

  constructor(options: {
    baseAssetPath: string
    createWorker: () => Worker
    onOutput?: OutputCallback
    onLifecycle?: LifecycleCallback
  }) {
    this.baseAssetPath = options.baseAssetPath
    this.createWorker = options.createWorker
    this.outputCallback = options.onOutput ?? null
    this.lifecycleCallback = options.onLifecycle ?? null
    this.worker = this.createWorker()
    this.worker.addEventListener('message', this.receive)

    this.queueMessage({
      type: 'init',
      baseAssetPath: this.baseAssetPath,
    })
  }

  runCode(
    code: string,
    options: { fileId: string; executionId: string; files: ProjectFileData[] }
  ): void {
    if (this.destroyed) {
      throw new Error('Pyodide worker client has been destroyed')
    }

    if (this.loadingError) {
      throw new Error(this.loadingError)
    }

    this.queueMessage({
      type: 'run-code',
      code,
      fileId: options.fileId,
      executionId: options.executionId,
      files: options.files,
    })
  }

  reset(): void {
    if (this.destroyed) {
      return
    }

    // Terminate the current worker immediately
    this.worker.terminate()
    this.pendingMessages.length = 0

    // Reset state for the new worker
    this.listening = false
    this.loadingError = null

    // Create a fresh worker and re-initialize Pyodide
    this.worker = this.createWorker()
    this.worker.addEventListener('message', this.receive)
    this.queueMessage({
      type: 'init',
      baseAssetPath: this.baseAssetPath,
    })
  }

  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.pendingMessages.length = 0

    this.worker.terminate()
  }

  private queueMessage(message: PyodideWorkerRequest) {
    if (this.listening) {
      this.worker.postMessage(message)
    } else {
      this.pendingMessages.push(message)
    }
  }

  private receive = (event: MessageEvent<PyodideWorkerResponse>) => {
    // Discard messages from a previously terminated worker
    if (event.target !== this.worker) {
      return
    }

    const response = event.data

    switch (response.type) {
      case 'listening':
        this.listening = true
        for (const message of this.pendingMessages) {
          this.worker.postMessage(message)
        }
        this.pendingMessages.length = 0
        return

      case 'loaded':
        this.lifecycleCallback?.({ type: 'loaded' })
        return

      case 'loading-failed':
        this.loadingError = response.error
        this.pendingMessages.length = 0
        this.lifecycleCallback?.({
          type: 'loading-failed',
          error: response.error,
        })
        return

      case 'output-line':
        this.outputCallback?.(
          response.stream,
          response.line,
          response.fileId,
          response.executionId
        )
        return

      case 'run-code-result':
        this.lifecycleCallback?.({
          type: 'run-finished',
          fileId: response.fileId,
          executionId: response.executionId,
          outputs: response.outputs,
        })
    }
  }
}
