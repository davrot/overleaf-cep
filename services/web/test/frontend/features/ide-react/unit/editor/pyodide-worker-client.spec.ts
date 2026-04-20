import { expect } from 'chai'
import { PyodideWorkerClient } from '@/features/ide-react/components/editor/python/pyodide-worker-client'
import { WorkerMock, createWorker } from './worker-mock'

const BASE_ASSET_PATH = 'https://assets.example.test/'

describe('PyodideWorkerClient', function () {
  beforeEach(function () {
    WorkerMock.instances.length = 0
  })

  it('queues runCode until the worker reports listening', function () {
    const client = new PyodideWorkerClient({
      baseAssetPath: BASE_ASSET_PATH,
      createWorker,
    })
    const worker = WorkerMock.instances[0]

    client.runCode('print("ok")', {
      fileId: 'main.py',
      executionId: 'exec-1',
      files: [{ relativePath: 'main.py', content: 'print("ok")' }],
    })
    expect(worker.postedMessages).to.have.length(0)

    worker.emitMessage({ type: 'listening' })
    expect(worker.postedMessages.map(message => message.type)).to.deep.equal([
      'init',
      'run-code',
    ])

    const runRequest = worker.postedMessages.find(
      message => message.type === 'run-code'
    )
    expect(runRequest).to.include({
      type: 'run-code',
      fileId: 'main.py',
      executionId: 'exec-1',
      code: 'print("ok")',
    })
    expect(runRequest.files).to.deep.equal([
      { relativePath: 'main.py', content: 'print("ok")' },
    ])
  })

  it('sends runCode as fire-and-forget', function () {
    const client = new PyodideWorkerClient({
      baseAssetPath: BASE_ASSET_PATH,
      createWorker,
    })
    const worker = WorkerMock.instances[0]
    worker.emitMessage({ type: 'listening' })

    client.runCode('raise RuntimeError("boom")', {
      fileId: 'boom.py',
      executionId: 'exec-2',
      files: [],
    })
    const runRequest = worker.postedMessages.find(
      message => message.type === 'run-code'
    )
    expect(runRequest).to.include({
      type: 'run-code',
      fileId: 'boom.py',
      executionId: 'exec-2',
    })
  })

  function setupClientWithLifecycleTracking() {
    const lifecycleEvents: {
      type: string
      fileId?: string
      executionId?: string
      outputs?: string[]
    }[] = []

    const client = new PyodideWorkerClient({
      baseAssetPath: BASE_ASSET_PATH,
      createWorker,
      onLifecycle: event => {
        lifecycleEvents.push(event)
      },
    })
    const worker = WorkerMock.instances[0]
    worker.emitMessage({ type: 'listening' })
    return { client, worker, lifecycleEvents }
  }

  it('emits run-finished lifecycle event from run-code-result', function () {
    const { client, worker, lifecycleEvents } =
      setupClientWithLifecycleTracking()

    client.runCode('print("ok")', {
      fileId: 'main.py',
      executionId: 'exec-3',
      files: [],
    })
    worker.emitMessage({
      type: 'run-code-result',
      fileId: 'main.py',
      executionId: 'exec-3',
      outputs: ['/project/output.txt'],
    })

    expect(lifecycleEvents).to.deep.include({
      type: 'run-finished',
      fileId: 'main.py',
      executionId: 'exec-3',
      outputs: ['/project/output.txt'],
    })
  })

  it('surfaces outputs array from run-code-result with multiple files', function () {
    const { client, worker, lifecycleEvents } =
      setupClientWithLifecycleTracking()

    client.runCode('write_files()', {
      fileId: 'main.py',
      executionId: 'exec-4',
      files: [],
    })
    worker.emitMessage({
      type: 'run-code-result',
      fileId: 'main.py',
      executionId: 'exec-4',
      outputs: ['/project/fig1.png', '/project/results/data.csv'],
    })

    expect(lifecycleEvents).to.deep.include({
      type: 'run-finished',
      fileId: 'main.py',
      executionId: 'exec-4',
      outputs: ['/project/fig1.png', '/project/results/data.csv'],
    })
  })

  it('surfaces empty outputs when no project files were written', function () {
    const { client, worker, lifecycleEvents } =
      setupClientWithLifecycleTracking()

    client.runCode('print("no writes")', {
      fileId: 'main.py',
      executionId: 'exec-5',
      files: [],
    })
    worker.emitMessage({
      type: 'run-code-result',
      fileId: 'main.py',
      executionId: 'exec-5',
      outputs: [],
    })

    expect(lifecycleEvents).to.deep.include({
      type: 'run-finished',
      fileId: 'main.py',
      executionId: 'exec-5',
      outputs: [],
    })
  })

  it('reports lifecycle failure and rejects future run requests when loading fails', function () {
    const lifecycleEvents: Array<{ type: string; error?: string }> = []

    const client = new PyodideWorkerClient({
      baseAssetPath: BASE_ASSET_PATH,
      createWorker,
      onLifecycle: event => {
        lifecycleEvents.push(event)
      },
    })
    const worker = WorkerMock.instances[0]

    worker.emitMessage({
      type: 'loading-failed',
      error: 'runtime unavailable',
    })

    expect(lifecycleEvents).to.deep.equal([
      { type: 'loading-failed', error: 'runtime unavailable' },
    ])
    expect(() =>
      client.runCode('print("ok")', {
        fileId: 'main.py',
        executionId: 'exec-4',
        files: [],
      })
    ).to.throw('runtime unavailable')
  })

  it('terminates the worker even when destroy is called after loading failure', function () {
    const client = new PyodideWorkerClient({
      baseAssetPath: BASE_ASSET_PATH,
      createWorker,
    })
    const worker = WorkerMock.instances[0]

    worker.emitMessage({
      type: 'loading-failed',
      error: 'runtime unavailable',
    })
    client.destroy()

    expect(worker.terminated).to.equal(true)
  })

  describe('reset', function () {
    it('terminates the current worker and creates a new one', function () {
      const client = new PyodideWorkerClient({
        baseAssetPath: BASE_ASSET_PATH,
        createWorker,
      })
      const originalWorker = WorkerMock.instances[0]
      originalWorker.emitMessage({ type: 'listening' })
      originalWorker.emitMessage({ type: 'loaded' })

      client.reset()

      expect(originalWorker.terminated).to.equal(true)
      expect(WorkerMock.instances).to.have.length(2)
    })

    it('sends init to the new worker once it reports listening after reset', function () {
      const client = new PyodideWorkerClient({
        baseAssetPath: BASE_ASSET_PATH,
        createWorker,
      })
      const originalWorker = WorkerMock.instances[0]
      originalWorker.emitMessage({ type: 'listening' })
      originalWorker.emitMessage({ type: 'loaded' })

      client.reset()

      const newWorker = WorkerMock.instances[1]
      expect(newWorker.postedMessages).to.have.length(0)

      newWorker.emitMessage({ type: 'listening' })
      expect(newWorker.postedMessages).to.deep.equal([
        { type: 'init', baseAssetPath: BASE_ASSET_PATH },
      ])
    })

    it('allows running code on the new worker after reset', function () {
      const client = new PyodideWorkerClient({
        baseAssetPath: BASE_ASSET_PATH,
        createWorker,
      })
      const originalWorker = WorkerMock.instances[0]
      originalWorker.emitMessage({ type: 'listening' })
      originalWorker.emitMessage({ type: 'loaded' })

      client.reset()

      const newWorker = WorkerMock.instances[1]
      newWorker.emitMessage({ type: 'listening' })
      newWorker.emitMessage({ type: 'loaded' })

      client.runCode('print("after reset")', {
        fileId: 'main.py',
        executionId: 'exec-5',
        files: [],
      })

      const runRequest = newWorker.postedMessages.find(
        (message: any) => message.type === 'run-code'
      )
      expect(runRequest).to.include({
        type: 'run-code',
        fileId: 'main.py',
        executionId: 'exec-5',
        code: 'print("after reset")',
      })
    })

    it('reset is a no-op after destroy', function () {
      const client = new PyodideWorkerClient({
        baseAssetPath: BASE_ASSET_PATH,
        createWorker,
      })
      const originalWorker = WorkerMock.instances[0]
      originalWorker.emitMessage({ type: 'listening' })
      originalWorker.emitMessage({ type: 'loaded' })

      client.destroy()
      client.reset()

      // No new worker should have been created
      expect(WorkerMock.instances).to.have.length(1)
    })
  })
})
