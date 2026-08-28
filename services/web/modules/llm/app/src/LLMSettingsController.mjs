import logger from '@overleaf/logger'
import fetch from 'node-fetch'
import { AbortController } from 'abort-controller'
import { fileURLToPath } from 'url'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { expressify } from '@overleaf/promise-utils'
import { readAdminSettings } from './LLMAdminController.mjs'

const llmSettingsPugPath = fileURLToPath(
    new URL('../../app/views/llm-settings.pug', import.meta.url)
)

const GRAMMAR_MODES = ['default', 'lt', 'llm', 'lt+llm']

/**
 * Compute the available (admin-enabled, service-reachable) flags that the
 * frontend uses to render the grammar mode UI. Also used to degrade a
 * saved mode that is no longer available (admin force-off, missing URL).
 */
async function grammarAvailability(userId) {
    const admin = await readAdminSettings()
    const llmAdminEnabled = admin.llmDisabledByAdmin !== true
    const ltAvailable =
        admin.languageToolDisabledByAdmin !== true &&
        !!(
            admin.languageToolUrl ||
            process.env.LANGUAGE_TOOL_URL ||
            process.env.LANGUAGE_TOOL_HOST ||
            process.env.LANGUAGE_TOOL_PORT
        )

    let personalComplete = false
    if (userId) {
        const u = await User.findById(
            userId,
            'useOwnLLMSettings llmApiKey llmModelName llmApiUrl'
        )
        personalComplete = !!(
            u && u.useOwnLLMSettings && u.llmApiKey && u.llmModelName && u.llmApiUrl
        )
    }

    const llmServerConfigured =
        !!(admin.llmApiUrl && admin.llmApiKey) ||
        !!(process.env.LLM_API_URL && process.env.LLM_API_KEY)

    const llmAvailableForUser = llmAdminEnabled && (personalComplete || llmServerConfigured)

    return {
        llmAdminEnabled,
        ltAvailable,
        llmServerConfigured,
        llmAvailableForUser,
        llmPersonalComplete: personalComplete,
    }
}

// Validate a stored mode against availability and degrade to the next
// best feasible mode (never silently picks a more expensive mode).
function degradeGrammarMode(mode, available) {
    if (!available) return 'default'
    if (!GRAMMAR_MODES.includes(mode)) return 'default'
    if (mode === 'lt+llm') {
        if (available.ltAvailable && available.llmAvailableForUser) return 'lt+llm'
        if (available.ltAvailable) return 'lt'
        if (available.llmAvailableForUser) return 'llm'
        return 'default'
    }
    if (mode === 'lt') return available.ltAvailable ? 'lt' : 'default'
    if (mode === 'llm') return available.llmAvailableForUser ? 'llm' : 'default'
    return 'default'
}

async function llmSettingsPage(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)

    logger.debug({ userId, pugPath: llmSettingsPugPath }, '[LLM] llmSettingsPage: rendering')

    let user = {}
    try {
        user = await User.findById(
            userId,
            'useOwnLLMSettings llmModelName llmApiUrl llmApiKey grammar'
        )
    } catch (err) {
        logger.warn({ userId, err }, '[LLM] Error loading user for settings page')
    }

    const grammarAvail = await grammarAvailability(userId)
    const llmSettings = {
        useOwnSettings: user?.useOwnLLMSettings || false,
        modelName: user?.llmModelName || '',
        apiUrl: user?.llmApiUrl || '',
        hasApiKey: !!(user?.llmApiKey),
        grammar: user?.grammar || {
            mode: 'default',
            llmModel: '',
            language: 'auto',
        },
    }

    logger.debug(
        { userId, useOwnSettings: llmSettings.useOwnSettings, hasApiKey: llmSettings.hasApiKey },
        '[LLM] llmSettingsPage: user settings loaded'
    )

    res.render(llmSettingsPugPath, {
        user: { llmSettings },
        grammarAvail,
    })
}

async function checkLLMConnection(req, res) {
    const { apiUrl, apiKey: providedApiKey, modelName } = req.body
    const userId = SessionManager.getLoggedInUserId(req.session)

    logger.debug(
        { userId, apiUrl, modelName, hasProvidedKey: !!providedApiKey },
        '[LLM] checkLLMConnection: request received'
    )

    // If no API key provided, fall back to stored key
    let apiKey = providedApiKey
    if (!apiKey) {
        try {
            const user = await User.findById(userId, 'llmApiKey')
            if (user && user.llmApiKey) {
                apiKey = user.llmApiKey
                logger.debug({ userId }, '[LLM] checkLLMConnection: using stored API key')
            }
        } catch (err) {
            logger.warn({ err }, '[LLM] Could not fetch stored API key')
        }
    }

    if (!apiUrl || !apiKey || !modelName) {
        return res.status(400).json({ error: 'Missing required parameters' })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
        controller.abort()
    }, 30000)

    try {
        const llmApiUrl = `${apiUrl}/chat/completions`

        const requestBody = {
            model: modelName,
            messages: [{ role: 'user', content: 'Test connection' }],
            max_tokens: 10,
            temperature: 0.7,
        }

        const startTime = Date.now()

        const response = await fetch(llmApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        })

        clearTimeout(timeout)
        const duration = Date.now() - startTime

        logger.debug(
            { userId, apiUrl, modelName, status: response.status, duration: `${duration}ms` },
            '[LLM] checkLLMConnection: LLM API responded'
        )

        if (!response.ok) {
            const errorText = await response.text()
            return res.status(400).json({
                success: false,
                error: 'LLM connection failed',
                details: errorText,
                status: response.status,
            })
        }

        res.json({
            success: true,
            message: 'LLM connection successful',
            duration: `${duration}ms`,
        })
    } catch (error) {
        clearTimeout(timeout)

        if (error.name === 'AbortError') {
            return res.status(504).json({
                success: false,
                error: 'Connection timeout',
                details: 'The LLM API did not respond within 30 seconds',
            })
        }

        res.status(500).json({
            success: false,
            error: 'Failed to test LLM connection',
            details: error.message,
        })
    }
}

async function saveLLMSettings(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { useOwnLLMSettings, llmApiKey, llmModelName, llmApiUrl } = req.body

    logger.debug(
        {
            userId,
            useOwnLLMSettings,
            llmModelName,
            llmApiUrl,
            hasApiKey: !!llmApiKey,
        },
        '[LLM] saveLLMSettings: request received'
    )

    try {
        if (useOwnLLMSettings) {
            const currentUser = await User.findById(userId, 'llmApiKey')
            const hasExistingApiKey = currentUser && currentUser.llmApiKey

            if (!llmApiUrl || !llmModelName) {
                return res.status(400).json({
                    success: false,
                    error:
                        'API URL and Model Name are required when enabling custom LLM settings',
                })
            }

            if (!hasExistingApiKey && (!llmApiKey || llmApiKey.trim() === '')) {
                return res.status(400).json({
                    success: false,
                    error:
                        'API Key is required when enabling custom LLM settings',
                })
            }
        }

        const updateData = {
            useOwnLLMSettings: Boolean(useOwnLLMSettings),
            llmModelName: llmModelName || '',
            llmApiUrl: llmApiUrl || '',
        }

        // Only update API key if a new one is provided
        if (llmApiKey && llmApiKey.trim() !== '') {
            updateData.llmApiKey = llmApiKey
        }

        await User.updateOne({ _id: userId }, { $set: updateData })

        logger.debug({ userId, useOwnLLMSettings }, '[LLM] saveLLMSettings: saved successfully')

        res.json({
            success: true,
            message: 'LLM settings saved successfully',
        })
    } catch (error) {
        logger.error(
            { userId, err: error },
            '[LLM] Error saving settings'
        )

        res.status(500).json({
            success: false,
            error: 'Failed to save LLM settings',
        })
    }
}

/**
 * GET /user/llm-settings/grammar
 * Returns the user's stored grammar preferences + effective availability +
 * the list of LLM models the user can pick for grammar checks (server-admin
 * models + the user's personal model when configured).
 */
async function getGrammarSettings(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)

    let user = {}
    try {
        user = await User.findById(
            userId,
            'grammar useOwnLLMSettings llmApiKey llmModelName llmApiUrl'
        )
    } catch (err) {
        logger.warn({ userId, err }, '[LLM] Error loading grammar settings')
    }

    const available = await grammarAvailability(userId)
    const stored = user?.grammar || {
        mode: 'default',
        llmModel: '',
        language: 'auto',
    }
    const effectiveMode = degradeGrammarMode(
        stored.mode || 'default',
        available
    )

    // Available models for LLM grammar checks: server-admin models (when the
    // server LLM is configured) + the user's personal model id (prefixed
    // 'personal-') when a complete personal LLM setup exists.
    const admin = await readAdminSettings()
    const models = []
    if (available.llmAdminEnabled && available.llmServerConfigured) {
        const ids = Array.isArray(admin.allowedModels) && admin.allowedModels.length
            ? admin.allowedModels
            : (process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME || '')
                  .split(',')
                  .map(m => m.trim())
                  .filter(Boolean)
        for (const id of ids) {
            if (id) models.push({ id, name: id, isPersonal: false })
        }
    }
    if (available.llmAdminEnabled && available.llmPersonalComplete) {
        models.push({
            id: `personal-${user.llmModelName}`,
            name: `🔒 ${user.llmModelName} (personal)`,
            isPersonal: true,
        })
    }

    res.json({
        mode: stored.mode || 'default',
        effectiveMode,
        llmModel: stored.llmModel || '',
        language: stored.language || 'auto',
        availability: available,
        models,
    })
}

/**
 * POST /user/llm-settings/grammar
 * Persists grammar mode / model / language. The backend validates the mode
 * against availability and degrades (never rejects), so a stale mode on a
 * different deployment falls back gracefully.
 */
async function saveGrammarSettings(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { mode, llmModel, language } = req.body || {}

    if (mode !== undefined && !GRAMMAR_MODES.includes(mode)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid grammar mode',
        })
    }

    const available = await grammarAvailability(userId)

    let user = {}
    try {
        user = await User.findById(userId, 'grammar')
    } catch (err) {
        logger.warn({ userId, err }, '[LLM] Error loading grammar settings')
    }

    const stored = user?.grammar || { mode: 'default', llmModel: '', language: 'auto' }
    const nextMode = mode || stored.mode || 'default'
    const effectiveMode = degradeGrammarMode(nextMode, available)

    const grammar = {
        mode: nextMode,
        llmModel:
            typeof llmModel === 'string'
                ? llmModel
                : stored.llmModel || '',
        language:
            typeof language === 'string' && language
                ? language
                : stored.language || 'auto',
    }

    try {
        await User.updateOne({ _id: userId }, { $set: { grammar } })
    } catch (error) {
        logger.error({ userId, err: error }, '[LLM] Error saving grammar settings')
        return res.status(500).json({
            success: false,
            error: 'Failed to save grammar settings',
        })
    }

    res.json({
        success: true,
        mode: grammar.mode,
        effectiveMode,
        degraded: effectiveMode !== grammar.mode,
        availability: available,
    })
}

export default {
    llmSettingsPage: expressify(llmSettingsPage),
    checkLLMConnection: expressify(checkLLMConnection),
    saveLLMSettings: expressify(saveLLMSettings),
    getGrammarSettings: expressify(getGrammarSettings),
    saveGrammarSettings: expressify(saveGrammarSettings),
}

export { GRAMMAR_MODES, degradeGrammarMode }
