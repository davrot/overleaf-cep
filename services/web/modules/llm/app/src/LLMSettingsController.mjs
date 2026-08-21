/*
 * LLMSettingsController - bring-your-own (BYO) LLM provider rows.
 *
 * Data model (per user):
 *   User.llmProviders: [ {
 *     id              string   (8 hex chars)
 *     name            string   (1..80)
 *     providerType    'openai' | 'anthropic' | 'openaiCompatible'
 *     baseUrl         string   (required for openaiCompatible; default endpoints
 *                              used when empty for openai/anthropic)
 *     apiKey          string   (encrypted at rest via LLMCrypto; '' = keyless)
 *     models          string[] (1..100)
 *     completionModel string   (optional; must be one of models)
 *     enabled         boolean
 *     createdAt       string   (ISO timestamp)
 *   } ]
 *
 * Legacy single-connection settings (llmApiUrl/llmApiKey/llmModelName/...)
 * are migrated to row #1 on first read/write when present.
 *
 * Every endpoint here is gated by LLM_ALLOW_USER_SETTINGS (F1 fix: the gate
 * previously only enforced chat(), not settings/check/scan/save).
 */

import { z } from 'zod'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { expressify } from '@overleaf/promise-utils'
import { encryptSecret, normalizeStoredSecret, storedToPlaintext } from './LLMCrypto.mjs'
import { normalizeProviderSpec, chatText, listModels, detectProviderType } from './LLMClient.mjs'
import OError from '@overleaf/o-error'

// overleaf-lab: hard cap on rows per user - keeps the editor model list and
// the user document bounded.
const MAX_PROVIDERS_PER_USER = 10
const MAX_ROWS_IN_LIST = 500 // listModels result cap

export const rowSchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        providerType: z.enum(['openai', 'anthropic', 'openaiCompatible']),
        baseUrl: z.string().trim().max(500).optional().default(''),
        apiKey: z.string().trim().max(2000).optional().default(''),
        models: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
        completionModel: z.string().trim().max(200).optional().default(''),
        enabled: z.boolean().optional().default(true),
    })
    .superRefine((value, ctx) => {
        if (value.providerType === 'openaiCompatible' && !value.baseUrl) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['baseUrl'],
                message: 'A base URL is required for OpenAI-compatible providers'
            })
        }
        if (value.completionModel && !value.models.includes(value.completionModel)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['completionModel'],
                message: 'completionModel must be one of the listed models'
            })
        }
    })

function makeRowId() {
    return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

/*
 * F1: the single source of truth for "is BYO allowed on this deployment?".
 * Used by every user-facing LLM endpoint (settings CRUD, check/scan, and the
 * user-lane branches of chat/completion in LLMChatController).
 */
export function isUserSettingsAllowed() {
    return process.env.LLM_ALLOW_USER_SETTINGS === 'true'
}

async function requireUserSettingsAllowed(req, res) {
    if (isUserSettingsAllowed()) return true
    logger.info({ userId: req.session?.userId }, '[LLM] Blocked BYO settings access (LLM_ALLOW_USER_SETTINGS not set)')
    res.status(403).json({ ok: false, error: 'disabled', message: 'Bring-your-own LLM settings are disabled on this deployment' })
    return false
}

function publicRow(row) {
    return {
        id: row.id,
        name: row.name,
        providerType: row.providerType,
        baseUrl: row.baseUrl || '',
        hasKey: !!row.apiKey,
        models: row.models,
        completionModel: row.completionModel || '',
        enabled: row.enabled !== false,
        createdAt: row.createdAt || new Date(0).toISOString()
    }
}

/*
 * Load the user's provider rows, migrating legacy single-connection settings
 * to row #1 (virtually, without writing) when present.
 */
export async function loadProviders(userId) {
    const user = await User.findById(userId, 'llmProviders llmApiUrl llmApiType llmApiKey llmModelName llmModels llmModelNames llmCompletionModel llmCompletionModels useOwnLLMSettings')
    if (!user) return []

    if (Array.isArray(user.llmProviders) && user.llmProviders.length) {
        return user.llmProviders.filter(r => r?.id && Array.isArray(r?.models))
    }

    // Legacy migration (projection + best-effort persistence): a single saved
    // connection becomes the first row. F20: the legacy plaintext key is
    // encrypted on migration and the row is persisted (if still not present)
    // so save/edit/delete operate on a real row with an encrypted key.
    if (user.llmApiUrl) {
        const models = [
            ...(user.llmModelNames || user.llmModels || []),
            ...(user.llmModelName && !user.llmModels?.includes(user.llmModelName) ? [user.llmModelName] : [])
        ]
        const completionModels = [
            ...(user.llmCompletionModels || []),
            ...(user.llmCompletionModel && !user.llmCompletionModels?.includes(user.llmCompletionModel) ? [user.llmCompletionModel] : [])
        ]
        const legacyType = ['openai', 'anthropic', 'openaiCompatible'].includes(user.llmApiType) ? user.llmApiType : null
        const row = {
            id: 'legacy',
            name: 'Imported settings',
            providerType: legacyType || detectProviderType(user.llmApiUrl),
            baseUrl: user.llmApiUrl,
            apiKey: normalizeStoredSecret(user.llmApiKey || ''),
            models: models.slice(0, 100),
            completionModel: (completionModels[0] && models.includes(completionModels[0])) ? completionModels[0] : (models[0] || ''),
            enabled: user.useOwnLLMSettings !== false,
            createdAt: new Date(0).toISOString()
        }
        try {
            const result = await User.updateOne(
                {
                    _id: userId,
                    $or: [{ llmProviders: { $exists: false } }, { 'llmProviders.0': { $exists: false } }]
                },
                { $set: { llmProviders: [row] } }
            )
            if (result && result.modifiedCount) {
                logger.info({ userId }, '[LLM] loadProviders: migrated legacy settings to "Imported settings" row (key encrypted)')
            }
        }
        catch (err) {
            logger.warn({ userId, err: err?.message }, '[LLM] loadProviders: legacy migration persist failed (continuing with virtual row)')
        }
        return [row]
    }

    return []
}

async function getProvidersJson(req, res) {
    if (!(await requireUserSettingsAllowed(req, res))) return
    const userId = SessionManager.getLoggedInUserId(req.session)
    const providers = await loadProviders(userId)
    res.json({ ok: true, providers: providers.map(publicRow), maxProviders: MAX_PROVIDERS_PER_USER })
}

async function addProvider(req, res) {
    if (!(await requireUserSettingsAllowed(req, res))) return
    const userId = SessionManager.getLoggedInUserId(req.session)
    const parsed = rowSchema.safeParse(req.body || {})
    if (!parsed.success) {
        const details = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        return res.status(400).json({ ok: false, error: 'invalid', details })
    }
    const user = await User.findById(userId, 'llmProviders llmApiUrl llmModelName')
    const existing = Array.isArray(user?.llmProviders) ? user.llmProviders : []
    if (existing.length >= MAX_PROVIDERS_PER_USER) {
        return res.status(400).json({ ok: false, error: 'limit', message: `Maximum of ${MAX_PROVIDERS_PER_USER} providers` })
    }
    const row = {
        ...parsed.data,
        id: makeRowId(),
        models: [...new Set(parsed.data.models)],
        apiKey: parsed.data.apiKey ? encryptSecret(parsed.data.apiKey) : '',
        createdAt: new Date().toISOString()
    }
    // Persisting the legacy migration as row #1 too, so the virtual row gains
    // a real id on first write.
    const migrated =
        existing.length === 0
            ? (await loadProviders(userId)).map(r => ({ ...r, id: r.id === 'legacy' ? makeRowId() : r.id, apiKey: normalizeStoredSecret(r.apiKey) }))
            : []
    const merged = [...migrated, ...existing, row]
    await User.updateOne({ _id: userId }, { $set: { llmProviders: merged } })
    logger.info({ userId, rowId: row.id, name: row.name }, '[LLM] addProvider: row added')
    res.status(201).json({ ok: true, provider: publicRow(row) })
}

async function updateProvider(req, res) {
    if (!(await requireUserSettingsAllowed(req, res))) return
    const userId = SessionManager.getLoggedInUserId(req.session)
    const rowId = req.params.id
    const user = await User.findById(userId, 'llmProviders llmApiUrl llmApiKey llmModelName llmModels llmModelNames llmCompletionModel llmCompletionModels llmApiType useOwnLLMSettings')
    const current = (await loadProviders(userId)).find(r => r.id === rowId)
    if (!current) return res.status(404).json({ ok: false, error: 'not-found' })

    // Partial update: merge over current row, then validate the full shape.
    const merged = {
        ...current,
        name: req.body?.name ?? current.name,
        providerType: req.body?.providerType ?? current.providerType,
        baseUrl: req.body?.baseUrl !== undefined ? req.body.baseUrl : (current.baseUrl || ''),
        models: req.body?.models ?? current.models,
        completionModel: req.body?.completionModel !== undefined ? req.body.completionModel : (current.completionModel || ''),
        enabled: req.body?.enabled ?? current.enabled
    }
    const parsed = rowSchema.safeParse(merged)
    if (!parsed.success) {
        const details = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        return res.status(400).json({ ok: false, error: 'invalid', details })
    }
    let apiKey = normalizeStoredSecret(current.apiKey || '')
    if (req.body?.clearApiKey) apiKey = ''
    else if (req.body?.apiKey && req.body.apiKey.trim() !== '') apiKey = encryptSecret(req.body.apiKey)

    const rows = (Array.isArray(user?.llmProviders) ? user.llmProviders : (await loadProviders(userId))).map(r =>
        (r.id === rowId || r.id === 'legacy') ? { ...parsed.data, id: rowId === 'legacy' ? makeRowId() : rowId, apiKey, createdAt: new Date().toISOString() } : r
    )
    await User.updateOne({ _id: userId }, { $set: { llmProviders: rows } })
    logger.info({ userId, rowId }, '[LLM] updateProvider: row updated')
    res.json({ ok: true, provider: publicRow({ ...parsed.data, id: rowId, apiKey }) })
}

async function deleteProvider(req, res) {
    if (!(await requireUserSettingsAllowed(req, res))) return
    const userId = SessionManager.getLoggedInUserId(req.session)
    const rowId = req.params.id
    const providers = await loadProviders(userId)
    if (!providers.some(r => r.id === rowId)) return res.status(404).json({ ok: false, error: 'not-found' })
    const rows = (await User.findById(userId, 'llmProviders')).llmProviders || providers.map(r => ({ ...r, id: r.id === 'legacy' ? makeRowId() : r.id, apiKey: normalizeStoredSecret(r.apiKey) }))
    const remaining = rows.filter(r => r.id !== rowId && !(rowId === 'legacy' && r.name === 'Imported settings'))
    await User.updateOne({ _id: userId }, { $set: { llmProviders: remaining } })
    logger.info({ userId, rowId }, '[LLM] deleteProvider: row deleted')
    res.json({ ok: true })
}

async function checkProviderConnection(req, res) {
    if (!(await requireUserSettingsAllowed(req, res))) return
    const userId = SessionManager.getLoggedInUserId(req.session)
    const body = req.body || {}

    // Credentials: explicit body values win, else the referenced row.
    let baseUrl = body.baseUrl || ''
    let apiKey = body.apiKey || ''
    let providerType = body.providerType || ''
    const model = body.model || ''
    if (body.rowId) {
        const row = (await loadProviders(userId)).find(r => r.id === body.rowId)
        if (!row) return res.status(404).json({ ok: false, error: 'not-found' })
        baseUrl = baseUrl || row.baseUrl || ''
        providerType = providerType || row.providerType
        if (!apiKey && row.apiKey) apiKey = storedToPlaintext(row.apiKey)
    }
    if (!baseUrl && !providerType) return res.status(400).json({ ok: false, error: 'invalid', details: 'baseUrl or rowId is required' })
    providerType = providerType || detectProviderType(baseUrl)

    const spec = normalizeProviderSpec({ providerType, baseUrl, apiKey }, { model: model || 'qwen' })
    const started = Date.now()
    try {
        const { ids } = await listModels(spec, { timeoutMs: 60000 })
        const models = ids.slice(0, MAX_ROWS_IN_LIST)
        if (model && !models.includes(model)) {
            logger.warn({ userId, model, count: models.length }, '[LLM] checkProviderConnection: model not in list')
            return res.status(404).json({ ok: false, error: 'model-not-found', details: `Model "${model}" not available`, models, duration: `${Date.now() - started}ms` })
        }
        // Lightweight chat probe (catches backends whose /models works but
        // chat is misconfigured).
        await chatText(
            normalizeProviderSpec({ providerType, baseUrl, apiKey }, { model: model || models[0] || 'qwen' }),
            [{ role: 'user', content: 'Reply with the single word OK.' }],
            { maxOutputTokens: 16, temperature: 0, timeoutMs: 60000 }
        )
        res.json({ ok: true, message: 'Connection successful', models, duration: `${Date.now() - started}ms` })
    }
    catch (error) {
        const info = error?.code === 'auth' ? { status: 401 } : (error?.status || (OError.getFullInfo(error)?.status || 500))
        logger.warn({ userId, providerType, err: error?.message }, '[LLM] checkProviderConnection: failed')
        return res.status(info.status || 500).json({ ok: false, error: error.code || 'llm-error', message: error.message, duration: `${Date.now() - started}ms` })
    }
}

async function scanProviderModels(req, res) {
    if (!(await requireUserSettingsAllowed(req, res))) return
    const userId = SessionManager.getLoggedInUserId(req.session)
    const body = req.body || {}
    let baseUrl = body.baseUrl || ''
    let apiKey = body.apiKey || ''
    let providerType = body.providerType || ''
    if (body.rowId) {
        const row = (await loadProviders(userId)).find(r => r.id === body.rowId)
        if (!row) return res.status(404).json({ ok: false, error: 'not-found' })
        baseUrl = baseUrl || row.baseUrl || ''
        providerType = providerType || row.providerType
        if (!apiKey && row.apiKey) apiKey = storedToPlaintext(row.apiKey)
    }
    providerType = providerType || detectProviderType(baseUrl)
    if (!baseUrl) return res.status(400).json({ ok: false, error: 'invalid', details: 'baseUrl or rowId is required' })

    const spec = normalizeProviderSpec({ providerType, baseUrl, apiKey }, { model: 'scan' })
    try {
        const { ids } = await listModels(spec, { timeoutMs: 60000 })
        res.json({ ok: true, models: ids.slice(0, MAX_ROWS_IN_LIST) })
    }
    catch (error) {
        const status = error?.code === 'auth' ? 401 : (error?.status || (OError.getFullInfo(error)?.status || 500))
        logger.warn({ userId, providerType, err: error?.message }, '[LLM] scanProviderModels: failed')
        return res.status(status || 500).json({ ok: false, error: error.code || 'llm-error', message: error.message })
    }
}

// Redirect: BYO rows live in Account Settings (core section). Kept as a
// redirect so old bookmarks / navbar entries do not 404.
async function llmSettingsPage(req, res) {
    // overleaf-lab: dedicated BYO settings page (the Account ▸ 'AI Settings' item
    // and the Account Settings card both link here; it used to be a redirect to
    // the generic settings page, which showed no LLM UI at all).
    const allowUser = !!(Settings.llm && Settings.llm.allowUserSettings)
    const userId = SessionManager.getLoggedInUserId(req.session)
    const userDoc = userId ? await User.findOne({ _id: userId }).lean() : null
    const context = {
        user: {
            firstName: userDoc?.first_name || '',
            lastName: userDoc?.last_name || '',
            email: userDoc?.email || '',
            llmSettings: { allowed: allowUser },
        },
        featureFlags: { chatEnabled: true, completionEnabled: true },
    }
    res.render(new URL('../../app/views/llm-settings.pug', import.meta.url).pathname, context)
}

export default {
    isUserSettingsAllowed,
    requireUserSettingsAllowed,
    MAX_PROVIDERS_PER_USER,
    llmSettingsPage, // sync render - must NOT be expressified (no .catch)
    getProvidersJson: expressify(getProvidersJson),
    addProvider: expressify(addProvider),
    updateProvider: expressify(updateProvider),
    deleteProvider: expressify(deleteProvider),
    checkProviderConnection: expressify(checkProviderConnection),
    scanProviderModels: expressify(scanProviderModels)
}
