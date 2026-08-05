import Queues from './Queues.mjs'
import {
    addOptionalCleanupHandlerBeforeStoppingTraffic,
    addRequiredCleanupHandlerBeforeDrainingConnections,
} from './GracefulShutdown.mjs'

const queues = new Map()
const handlers = new Map()

function queueName(provider) {
    return `${provider}-sync`
}

function getQueue(provider) {
    const name = queueName(provider)
    if (!queues.has(provider)) queues.set(provider, Queues.getQueue(name))
    return queues.get(provider)
}

function register(provider, handler) {
    if (handlers.has(provider)) return
    const queue = getQueue(provider)
    handlers.set(provider, handler)
    if (process.env.QUEUE_PROCESSING_ENABLED !== 'false') {
        const concurrency = Number(process.env.SYNC_QUEUE_CONCURRENCY) || 4
        queue.process(concurrency, async job => handler(job.data))
        const label = `${queueName(provider)} queue`
        addOptionalCleanupHandlerBeforeStoppingTraffic(label, async () => {
            await queue.pause(true)
        })
        addRequiredCleanupHandlerBeforeDrainingConnections(label, async () => {
            await queue.close()
        })
    }
}

async function enqueue(provider, userId, projectId, data = {}) {
    const queue = getQueue(provider)
    try {
        await queue.add(
            {
                provider,
                userId: userId.toString(),
                projectId: projectId.toString(),
                ...data,
            },
            {
                removeOnComplete: true,
            }
        )
    } catch (error) {
        if (!/already exists|Job .* exists/i.test(error.message)) throw error
    }
}

export default {
    enqueue,
    register,
}
