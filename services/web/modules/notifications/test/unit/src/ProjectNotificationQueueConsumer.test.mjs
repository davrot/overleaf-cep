import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'

const consumerPath = path.join(
  import.meta.dirname,
  '../../../app/src/ProjectNotificationQueueConsumer.mjs'
)

describe('ProjectNotificationQueueConsumer', function () {
  let consumer
  const savedEnv = {}

  beforeAll(async function () {
    consumer = await import(consumerPath)
    for (const key of [
      'QUEUES_REDIS_HOST',
      'QUEUES_REDIS_PORT',
      'QUEUES_REDIS_PASSWORD',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_PASSWORD',
    ]) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  it('does not start a queue in the test environment', function () {
    expect(consumer.startProjectNotificationConsumer()).toBeNull()
    // idempotent no-op on repeat calls
    expect(consumer.startProjectNotificationConsumer()).toBeNull()
  })

  it('resolves redis config preferring QUEUES_REDIS_* over REDIS_*', function () {
    // no env at all → localhost default (same as the enqueue script's bull)
    expect(consumer.getQueueRedisConfig()).toEqual({
      host: '127.0.0.1',
      port: 6379,
      password: undefined,
    })

    process.env.REDIS_HOST = 'stackredis'
    process.env.REDIS_PORT = '6380'
    process.env.REDIS_PASSWORD = 'secret'
    expect(consumer.getQueueRedisConfig()).toEqual({
      host: 'stackredis',
      port: 6380,
      password: 'secret',
    })

    // explicit QUEUES_REDIS_* must win over REDIS_*
    process.env.QUEUES_REDIS_HOST = 'queuesredis'
    process.env.QUEUES_REDIS_PORT = '7777'
    expect(consumer.getQueueRedisConfig()).toEqual({
      host: 'queuesredis',
      port: 7777,
      password: 'secret',
    })
  })

  it('exposes the upstream queue name', function () {
    expect(consumer.QUEUE_NAME).toBe('project-notification')
  })
})
