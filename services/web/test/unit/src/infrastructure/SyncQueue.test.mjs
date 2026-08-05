import { beforeEach, describe, expect, it, vi } from 'vitest'

const queue = {
    add: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    process: vi.fn(),
}

vi.mock('../../../../app/src/infrastructure/Queues.mjs', () => ({
    default: {
        getQueue: vi.fn(() => queue),
    },
}))

vi.mock('../../../../app/src/infrastructure/GracefulShutdown.mjs', () => ({
    addOptionalCleanupHandlerBeforeStoppingTraffic: vi.fn(),
    addRequiredCleanupHandlerBeforeDrainingConnections: vi.fn(),
}))

const { default: SyncQueue } = await import(
    '../../../../app/src/infrastructure/SyncQueue.mjs'
)

describe('SyncQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('registers a concurrent provider worker', () => {
        const handler = vi.fn()

        SyncQueue.register('webdav', handler)

        expect(queue.process).toHaveBeenCalledWith(4, expect.any(Function))
    })

    it('enqueues a durable provider and project payload', async () => {
        await SyncQueue.enqueue('dropbox', 'user-1', 'project-2')

        expect(queue.add).toHaveBeenCalledWith(
            {
                provider: 'dropbox',
                userId: 'user-1',
                projectId: 'project-2',
            },
            { removeOnComplete: true }
        )
    })
})
