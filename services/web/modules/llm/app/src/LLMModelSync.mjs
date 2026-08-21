// overleaf-lab: reviewer #9 — "the list of models can be changed by the
// provider. Do we need to auto-fetch the model list daily?" → yes:
// background sync that re-fetches the model list of every enabled BYO row
// (and keeps the user's chosen completion model, flagging it when the
// backend no longer serves it). Runs once shortly after web startup and then
// every 24h (override with LLM_MODEL_SYNC_INTERVAL_MS /
// LLM_MODEL_SYNC_INITIAL_DELAY_MS, e.g. '0' to disable the initial run).
//
// Everything dependency-injected: `listModels`, user loading and row updates
// are passed in, so the full flow is unit-testable without mongo.
import logger from '@overleaf/logger'
import { listModels as defaultListModels, normalizeProviderSpec } from './LLMClient.mjs'
import { storedToPlaintext } from './LLMCrypto.mjs'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SYNCED_MODELS = 100

function envMs(name, fallbackMs) {
    const raw = process.env[name]
    if (raw === undefined || raw === '') return fallbackMs
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : fallbackMs
}

// Pure: merge a freshly fetched model list into a row. Keeps the user's
// completion model even if the backend dropped it (flagged stale), and
// records when the list was last checked.
export function applyModelSync(row, fetchedIds = [], checkedAt = Date.now()) {
    const models = (fetchedIds || []).slice(0, MAX_SYNCED_MODELS)
    const completionModel = row.completionModel || ''
    return {
        ...row,
        models,
        lastModelsCheckedAt: checkedAt,
        staleCompletionModel: completionModel !== '' && !models.includes(completionModel),
    }
}

async function syncOneRow(row, { listModels, log }) {
    const apiKey = row.apiKey ? storedToPlaintext(row.apiKey) : ''
    const spec = normalizeProviderSpec(
        { providerType: row.providerType || 'openaiCompatible', baseUrl: row.baseUrl, apiKey },
        { model: 'sync' },
    )
    const { ids } = await listModels(spec, { timeoutMs: 60000 })
    return ids
}

// Full sync over all users with enabled BYO rows. `findUsers` returns user
// docs with their current row objects; `applySync` receives (userDoc, row,
// updatedRow) and persists the row.
export async function syncAllProviderModels({
    listModels = defaultListModels,
    findUsers,
    applySync,
    log = logger,
} = {}) {
    if (typeof findUsers !== 'function' || typeof applySync !== 'function') {
        throw new Error('syncAllProviderModels: findUsers and applySync are required')
    }
    const users = (await findUsers()) || []
    let checked = 0
    let failed = 0
    for (const user of users) {
        for (const row of user.llmProviders || []) {
            if (!row.enabled || !row.baseUrl) continue
            try {
                const ids = await syncOneRow(row, { listModels, log })
                await applySync(user, row, applyModelSync(row, ids))
                checked++
            }
            catch (error) {
                failed++
                log.warn(
                    { userId: user._id?.toString?.() || user._id, rowId: row.id, err: error?.message },
                    '[LLM] model sync: row failed (keeping previous list)',
                )
            }
        }
    }
    log.info({ users: users.length, checked, failed }, '[LLM] model sync: complete')
    return { checked, failed }
}

let active = null

export function startModelSync({
    intervalMs = envMs('LLM_MODEL_SYNC_INTERVAL_MS', DAY_MS),
    initialDelayMs = envMs('LLM_MODEL_SYNC_INITIAL_DELAY_MS', 90 * 1000),
    findUsers,
    applySync,
    log = logger,
} = {}) {
    stopModelSync()
    if (intervalMs <= 0) {
        log.info({}, '[LLM] model sync: disabled (interval <= 0)')
        return null
    }
    const run = () =>
        syncAllProviderModels({ findUsers, applySync, log }).catch(error => {
            log.warn({ err: error?.message }, '[LLM] model sync: run failed')
        })
    if (initialDelayMs > 0) {
        const t = setTimeout(run, initialDelayMs)
        t.unref?.()
        active = { kind: 'timeout', handle: t }
    }
    const interval = setInterval(run, intervalMs)
    interval.unref?.()
    active = { ...active, interval }
    log.info(
        { intervalMs, initialDelayMs },
        '[LLM] model sync: scheduled (keeps BYO model lists fresh)',
    )
    return active
}

export function stopModelSync() {
    if (!active) return
    if (active.handle) clearTimeout(active.handle)
    if (active.interval) clearInterval(active.interval)
    active = null
}

export default { startModelSync, stopModelSync, syncAllProviderModels, applyModelSync }
