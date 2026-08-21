// overleaf-lab: unit tests for the BYO model-list background sync (reviewer #9).
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyModelSync, syncAllProviderModels, startModelSync, stopModelSync } from '../src/LLMModelSync.mjs'

const row = {
    id: 'r1',
    name: 'Academic Cloud',
    providerType: 'openaiCompatible',
    baseUrl: 'https://example.de/v1',
    apiKey: '',
    models: ['old-model'],
    completionModel: 'model-a',
    enabled: true,
}

test('applyModelSync: replaces models, stamps time, keeps completion model', () => {
    const out = applyModelSync(row, ['model-a', 'model-b', 'model-c'], 123)
    assert.deepEqual(out.models, ['model-a', 'model-b', 'model-c'])
    assert.equal(out.lastModelsCheckedAt, 123)
    assert.equal(out.completionModel, 'model-a')
    assert.equal(out.staleCompletionModel, false)
})

test('applyModelSync: flags stale completion model but does not drop it', () => {
    const out = applyModelSync(row, ['model-x'], 123)
    assert.deepEqual(out.models, ['model-x'])
    assert.equal(out.completionModel, 'model-a')
    assert.equal(out.staleCompletionModel, true)
})

test('applyModelSync: caps list length', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `m${i}`)
    const out = applyModelSync(row, ids, 1)
    assert.equal(out.models.length, 100)
})

test('syncAllProviderModels: checks enabled rows only, applies via applySync', async () => {
    const users = [
        { _id: 'u1', llmProviders: [row, { ...row, id: 'off', enabled: false }] },
    ]
    const applied = []
    const listModels = async () => ({ ids: ['a', 'b'] })
    const result = await syncAllProviderModels({
        listModels,
        findUsers: async () => users,
        applySync: async (u, r, updated) => applied.push([u, r.id, updated.models]),
        log: { warn() {}, info() {} },
    })
    assert.equal(result.checked, 1)
    assert.equal(result.failed, 0)
    assert.equal(applied.length, 1)
    assert.equal(applied[0][1], 'r1')
    assert.deepEqual(applied[0][2], ['a', 'b'])
})

test('syncAllProviderModels: counts failures, keeps going', async () => {
    const users = [
        { _id: 'u1', llmProviders: [row, { ...row, id: 'r2' }] },
    ]
    let call = 0
    const listModels = async () => {
        call++
        if (call === 1) throw new Error('boom')
        return { ids: ['ok'] }
    }
    const result = await syncAllProviderModels({
        listModels,
        findUsers: async () => users,
        applySync: async () => {},
        log: { warn() {}, info() {} },
    })
    assert.equal(result.checked, 1)
    assert.equal(result.failed, 1)
})

test('syncAllProviderModels: requires injected persistence', async () => {
    await assert.rejects(
        () => syncAllProviderModels({ findUsers: async () => [] }),
        /findUsers and applySync/,
    )
})

test('startModelSync/stopModelSync: disabled when interval <= 0', () => {
    const handle = startModelSync({
        intervalMs: 0,
        initialDelayMs: 0,
        findUsers: async () => [],
        applySync: async () => {},
        log: { info() {} },
    })
    assert.equal(handle, null)
    stopModelSync()
})
