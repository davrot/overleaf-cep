import logger from '@overleaf/logger'
import fetch from 'node-fetch'
import { AbortController } from 'abort-controller'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import Settings from '@overleaf/settings'
import {
    getSystemPrompt,
    getAdminLLMSettings,
    readAdminSettings,
} from './LLMAdminController.mjs'

// Helper function to remove <think> tags (for DeepSeek, Qwen and similar models)
// Handles both closed <think>...</think> and unclosed <think>... at end of string
function stripThinkTags(content) {
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, '')
    return cleaned.trim()
}

// Parse available models from admin settings or environment variable
async function getAvailableModels() {
    if (Settings.llm && !Settings.llm.enabled) {
        logger.debug({ llmEnabled: Settings.llm.enabled }, '[LLM] getAvailableModels: LLM disabled')
        return []
    }

    const adminSettings = await getAdminLLMSettings()
    let modelsList = Array.isArray(adminSettings.allowedModels)
        ? adminSettings.allowedModels.filter(m => typeof m === 'string' && m.trim().length > 0)
        : []

    if (modelsList.length === 0) {
        const modelsEnv = process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME
        logger.debug(
            {
                LLM_AVAILABLE_MODELS: process.env.LLM_AVAILABLE_MODELS,
                LLM_MODEL_NAME: process.env.LLM_MODEL_NAME,
                resolved: modelsEnv,
            },
            '[LLM] getAvailableModels: reading env'
        )

        if (modelsEnv) {
            modelsList = modelsEnv
                .split(',')
                .map(m => m.trim())
                .filter(m => m.length > 0)
        }
    }

    if (modelsList.length === 0) {
        return []
    }

    const result = modelsList.map((id, index) => ({
        id,
        name: id.replace(/-/g, ' ').toUpperCase(),
        isDefault: index === 0,
    }))

    logger.debug({ count: result.length, models: result.map(m => m.id) }, '[LLM] getAvailableModels: parsed models')
    return result
}

async function getModels(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const projectId = req.params.Project_id

    logger.debug(
        { projectId, userId, llmSettings: Settings.llm },
        '[LLM] getModels: request received'
    )

    try {
        if (Settings.llm && !Settings.llm.enabled) {
            logger.debug({}, '[LLM] getModels: LLM disabled, returning empty')
            return res.json({ models: [] })
        }

        const admin = await readAdminSettings()
        if (admin.llmDisabledByAdmin === true) {
            logger.debug({}, '[LLM] getModels: LLM admin-disabled, returning empty')
            return res.json({ models: [] })
        }

        const models = []

        // 1. Add server-wide models from admin settings/env
        const serverModels = await getAvailableModels()
        models.push(...serverModels)

        // 2. Add user's personal LLM model if configured and activated
        if (userId && Settings.llm && Settings.llm.allowUserSettings) {
            try {
                const user = await User.findById(
                    userId,
                    'useOwnLLMSettings llmModelName llmApiUrl llmApiKey'
                )

                if (
                    user &&
                    user.useOwnLLMSettings &&
                    user.llmModelName &&
                    user.llmApiUrl &&
                    user.llmApiKey
                ) {
                    const personalModel = {
                        id: `personal-${user.llmModelName}`,
                        name: `${user.llmModelName} (🔒 Personal)`,
                        isDefault: false,
                        isPersonal: true,
                        label: 'Private',
                    }
                    models.push(personalModel)
                }
            } catch (error) {
                logger.warn(
                    { userId, projectId, err: error },
                    '[LLM] Error fetching user LLM settings'
                )
            }
        }

        logger.debug(
            { count: models.length, modelIds: models.map(m => m.id) },
            '[LLM] getModels: returning models'
        )
        res.json({ models })
    } catch (error) {
        logger.error(
            { userId, projectId, err: error },
            '[LLM] Error fetching available models'
        )
        res.status(500).json({
            success: false,
            error: 'Failed to fetch available models',
        })
    }
}

async function chat(req, res) {
    const { messages, model } = req.body
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    logger.debug(
        {
            projectId,
            userId,
            model,
            messageCount: Array.isArray(messages) ? messages.length : 'invalid',
            isPersonalModel: model?.startsWith('personal-'),
        },
        '[LLM] chat: request received'
    )

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Invalid messages format' })
    }

    const admin = await readAdminSettings()
    if (admin.llmDisabledByAdmin === true) {
        return res.status(503).json({ error: 'LLM service is disabled' })
    }

    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ error: 'LLM service is disabled' })
    }

    const isPersonalModel = model && model.startsWith('personal-')

    const adminLlmSettings = await getAdminLLMSettings()
    let llmApiUrl = adminLlmSettings.llmApiUrl || process.env.LLM_API_URL
    let llmApiKey = adminLlmSettings.llmApiKey || process.env.LLM_API_KEY

    if (isPersonalModel && userId) {
        try {
            const user = await User.findById(
                userId,
                'useOwnLLMSettings llmApiUrl llmApiKey llmModelName'
            )
            if (
                user &&
                user.useOwnLLMSettings &&
                user.llmApiUrl &&
                user.llmApiKey
            ) {
                llmApiUrl = user.llmApiUrl
                llmApiKey = user.llmApiKey
            } else {
                return res.status(400).json({
                    error:
                        'Your LLM settings are incomplete. Please configure API URL, API Key, and Model Name in your account settings.',
                })
            }
        } catch (error) {
            return res.status(500).json({
                error: 'Failed to retrieve user LLM settings',
            })
        }
    } else if (!isPersonalModel) {
        if (!llmApiUrl || !llmApiKey) {
            return res.status(503).json({
                error:
                    'LLM service is not configured. Please contact your administrator or configure your own LLM settings.',
            })
        }
    }

    if (!llmApiUrl || !llmApiKey) {
        return res.status(503).json({ error: 'LLM service is not configured' })
    }

    const modelNameForApi = isPersonalModel && model
        ? model.substring('personal-'.length)
        : model || 'qwen3-32b'

    const controller = new AbortController()
    const timeout = setTimeout(() => {
        controller.abort()
    }, 300000) // 5 minutes

    try {
        const llmApiFullUrl = `${llmApiUrl}/chat/completions`

        // Prepend admin-configured system prompt if set and not already present
        let finalMessages = messages
        const adminSystemPrompt = await getSystemPrompt()
        if (adminSystemPrompt) {
            const hasSystemMessage = messages.length > 0 && messages[0].role === 'system'
            if (hasSystemMessage) {
                finalMessages = [
                    { role: 'system', content: adminSystemPrompt + '\n\n' + messages[0].content },
                    ...messages.slice(1),
                ]
            } else {
                finalMessages = [
                    { role: 'system', content: adminSystemPrompt },
                    ...messages,
                ]
            }
        }

        const requestBody = {
            model: modelNameForApi,
            messages: finalMessages,
            max_tokens: 8192,
            temperature: 0.7,
        }

        const startTime = Date.now()

        logger.info(
            {
                projectId,
                model: modelNameForApi,
                url: llmApiFullUrl,
                isPersonalModel,
                maxTokens: 8192,
            },
            '[LLM] chat: sending request to LLM API'
        )

        const response = await fetch(llmApiFullUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${llmApiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        })

        clearTimeout(timeout)
        const duration = Date.now() - startTime

        logger.info(
            { projectId, status: response.status, duration: `${duration}ms` },
            '[LLM] chat: LLM API responded'
        )

        if (!response.ok) {
            const errorText = await response.text()
            logger.error(
                {
                    projectId,
                    userId,
                    status: response.status,
                    error: errorText,
                    duration: `${duration}ms`,
                },
                '[LLM] API error response'
            )
            return res.status(response.status).json({
                error: 'LLM API error',
                details: errorText,
                status: response.status,
            })
        }

        const data = await response.json()

        // Strip <think> tags from the response content
        if (
            data.choices &&
            data.choices[0] &&
            data.choices[0].message &&
            data.choices[0].message.content
        ) {
            const originalLength = data.choices[0].message.content.length
            data.choices[0].message.content = stripThinkTags(
                data.choices[0].message.content
            )
            const strippedLength = data.choices[0].message.content.length
            if (originalLength !== strippedLength) {
                logger.debug(
                    { originalLength, strippedLength },
                    '[LLM] chat: stripped <think> tags'
                )
            }
        }

        logger.info(
            { projectId, duration: `${Date.now() - startTime}ms`, model: modelNameForApi },
            '[LLM] chat: response sent successfully'
        )
        res.json(data)
    } catch (error) {
        clearTimeout(timeout)

        if (error.name === 'AbortError') {
            return res.status(504).json({
                error: 'LLM service timeout',
                details: 'The LLM API did not respond within 5 minutes',
            })
        }

        logger.error(
            { projectId, userId, err: error },
            '[LLM] Error communicating with LLM service'
        )

        res.status(500).json({
            error: 'Failed to communicate with LLM service',
            details: error.message,
        })
    }
}

async function completion(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { cursorOffset, leftContext, rightContext, language, maxLength } =
        req.body

    logger.debug(
        {
            projectId,
            userId,
            language,
            maxLength,
            leftContextLen: leftContext?.length,
            rightContextLen: rightContext?.length,
        },
        '[LLM] completion: request received'
    )

    if (!leftContext && !rightContext) {
        return res.status(400).json({ success: false, error: 'No context provided' })
    }

    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ success: false, error: 'LLM service is disabled' })
    }

    const adminLlmSettings = await getAdminLLMSettings()
    let llmApiUrl = adminLlmSettings.llmApiUrl || process.env.LLM_API_URL
    let llmApiKey = adminLlmSettings.llmApiKey || process.env.LLM_API_KEY

    // Try user settings if server-wide not configured
    if ((!llmApiUrl || !llmApiKey) && userId) {
        try {
            const user = await User.findById(
                userId,
                'useOwnLLMSettings llmApiUrl llmApiKey llmModelName'
            )
            if (user && user.useOwnLLMSettings && user.llmApiUrl && user.llmApiKey) {
                llmApiUrl = user.llmApiUrl
                llmApiKey = user.llmApiKey
            }
        } catch (error) {
            logger.warn({ userId, err: error }, '[LLM] Error loading user settings for completion')
        }
    }

    if (!llmApiUrl || !llmApiKey) {
        return res.status(503).json({ success: false, error: 'LLM service is not configured' })
    }

    const completionModel =
        process.env.LLM_COMPLETION_MODEL ||
        (process.env.LLM_MODEL_NAME || 'qwen3-32b').split(',')[0].trim()

    const controller = new AbortController()
    const timeout = setTimeout(() => {
        controller.abort()
    }, 30000) // 30 seconds for completions

    try {
        const systemPrompt = `/no_think\nYou are a text completion engine. Output ONLY the missing text. No thinking, no explanation, no markdown, no code fences, no tags. Just the raw continuation characters.`

        const userPrompt = `Complete the text at [CURSOR]. Output only the few words that replace [CURSOR]:

${leftContext}[CURSOR]${rightContext}`

        const response = await fetch(`${llmApiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${llmApiKey}`,
            },
            body: JSON.stringify({
                model: completionModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                max_tokens: maxLength || 60,
                temperature: 0.1,
            }),
            signal: controller.signal,
        })

        clearTimeout(timeout)

        if (!response.ok) {
            return res
                .status(response.status)
                .json({ success: false, error: 'Completion request failed' })
        }

        const data = await response.json()
        const completionText =
            data.choices?.[0]?.message?.content?.trim() || ''

        // Strip any think tags and clean up
        const cleaned = stripThinkTags(completionText)

        res.json({ success: true, data: cleaned })
    } catch (error) {
        clearTimeout(timeout)

        if (error.name === 'AbortError') {
            return res
                .status(504)
                .json({ success: false, error: 'Completion timeout' })
        }

        logger.error(
            { projectId, userId, err: error },
            '[LLM] Completion error'
        )
        res
            .status(500)
            .json({ success: false, error: 'Completion failed' })
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Grammar checking (LLM) — see docs/llm-languagetool-integration-plan.md
// ═══════════════════════════════════════════════════════════════════════

const GRAMMAR_MAX_SPANS = 50
const GRAMMAR_MAX_TOTAL_CHARS = 15_000
const GRAMMAR_TIMEOUT_MS = 90_000

const GRAMMAR_SYSTEM_PROMPT = [
    'You are a grammar and style corrector for short prose excerpts taken from a LaTeX document.',
    'You only fix grammar, spelling and wording problems. You never change meaning, LaTeX commands, math, formatting, terminology, or tone.',
    'You MUST reply with a single JSON array and nothing else. Each element is an object:',
    '{"id": <span id>, "start": <start offset, inclusive>, "end": <end offset, exclusive>, "message": <short explanation>, "suggestion": <corrected replacement for the range start..end>}',
    'Offsets are zero-based character offsets into the raw span text. Only include spans that actually contain an error. Reply with "[]" when there are no errors.',
].join('\n')

/**
 * Parse the strict JSON the grammar LLM is instructed to return. Be lenient:
 * strip code fences and any leading prose, find the first balanced JSON
 * array, and validate every suggestion against the source span bounds.
 */
function parseGrammarSuggestions(content, spans) {
    const spansById = new Map(spans.map(s => [s.spanId, s]))

    const cleaned = (content || '')
        .replace(/```[a-z]*\n?/g, '')
        .trim()
    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    if (start === -1 || end <= start) {
        return []
    }

    let items
    try {
        items = JSON.parse(cleaned.slice(start, end + 1))
    } catch (err) {
        logger.debug(
            { content: content.slice(0, 500) },
            '[GRAMMAR] Could not parse LLM JSON response'
        )
        return []
    }

    if (!Array.isArray(items)) return []

    const suggestions = []
    for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const span = spansById.get(item.id)
        if (!span || typeof item.start !== 'number' || typeof item.end !== 'number') {
            continue
        }
        if (item.start < 0 || item.end > span.text.length || item.end <= item.start) {
            continue
        }
        suggestions.push({
            spanId: item.id,
            start: item.start,
            end: item.end,
            message: typeof item.message === 'string' ? item.message : '',
            suggestion:
                typeof item.suggestion === 'string' ? item.suggestion : '',
        })
    }
    return suggestions
}

/**
 * POST /project/:Project_id/llm/grammar
 * LLM grammar check on plain-text spans extracted from the LaTeX source.
 *
 * Body: { spans: [{ spanId, start, text }], model? }
 *   - spans: plain-text regions of the document (the client re-maps the
 *     response to document positions using the same list).
 *   - model: model id, or 'personal-<model>' to use the user's personal LLM.
 *
 * Response: { success: true, suggestions: [{ spanId, start, end, message,
 * suggestion }] } where start/end are offsets within the span text.
 */
async function grammar(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({
            success: false,
            error: 'LLM service is disabled',
        })
    }

    const admin = await readAdminSettings()
    if (admin.llmDisabledByAdmin === true) {
        return res.status(503).json({
            success: false,
            error: 'LLM service is disabled by the administrator',
        })
    }

    const { spans, model } = req.body || {}
    if (!Array.isArray(spans) || spans.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'spans must be a non-empty array',
        })
    }

    // ── Guardrails: hard caps to bound LLM cost ──────────────────────
    const filteredSpans = spans.slice(0, GRAMMAR_MAX_SPANS).map(s => ({
        spanId: s.spanId ?? s.id,
        text: s.text || '',
    }))

    const totalChars = filteredSpans.reduce((n, s) => n + s.text.length, 0)
    if (totalChars > GRAMMAR_MAX_TOTAL_CHARS) {
        const scale = GRAMMAR_MAX_TOTAL_CHARS / totalChars
        for (const s of filteredSpans) {
            s.text = s.text.slice(0, Math.ceil(s.text.length * scale))
        }
        logger.warn(
            { projectId, totalChars },
            '[GRAMMAR] Input truncated to size cap'
        )
    }

    let llmApiUrl = admin.llmApiUrl || process.env.LLM_API_URL
    let llmApiKey = admin.llmApiKey || process.env.LLM_API_KEY

    const isPersonalModel =
        typeof model === 'string' && model.startsWith('personal-')

    if (isPersonalModel && userId) {
        try {
            const user = await User.findById(
                userId,
                'useOwnLLMSettings llmApiUrl llmApiKey llmModelName'
            )
            if (
                user &&
                user.useOwnLLMSettings &&
                user.llmApiUrl &&
                user.llmApiKey
            ) {
                llmApiUrl = user.llmApiUrl
                llmApiKey = user.llmApiKey
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Personal LLM settings are incomplete',
                })
            }
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: 'Failed to load personal LLM settings',
            })
        }
    }

    if (!llmApiUrl || !llmApiKey) {
        return res.status(503).json({
            success: false,
            error:
                'LLM is not configured. Ask your administrator or configure your own LLM settings.',
        })
    }

    const modelNameForApi =
        isPersonalModel && model
            ? model.substring('personal-'.length)
            : model ||
              (Array.isArray(admin.allowedModels) && admin.allowedModels[0]) ||
              (process.env.LLM_MODEL_NAME || 'qwen3-32b').split(',')[0].trim()

    const userPrompt = [
        'Check the following numbered text excerpts for grammar errors. For each excerpt, respond with entries referencing its id.',
        ...filteredSpans.map(s => `\n--- id: ${s.spanId} ---\n${s.text}`),
        '',
        'Respond with the JSON array exactly as described.',
    ].join('\n')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GRAMMAR_TIMEOUT_MS)

    try {
        const response = await fetch(`${llmApiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${llmApiKey}`,
            },
            body: JSON.stringify({
                model: modelNameForApi,
                messages: [
                    { role: 'system', content: GRAMMAR_SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                max_tokens: Math.min(4096, Math.max(512, Math.ceil(totalChars / 2))),
                temperature: 0,
            }),
            signal: controller.signal,
        })

        clearTimeout(timeout)

        if (!response.ok) {
            const errorText = await response.text()
            logger.error(
                {
                    projectId,
                    status: response.status,
                    error: errorText.slice(0, 500),
                },
                '[GRAMMAR] LLM API error'
            )
            return res.status(response.status).json({
                success: false,
                error: 'LLM API error',
                details: errorText,
            })
        }

        const data = await response.json()
        const content = data.choices?.[0]?.message?.content || ''
        const stripped = stripThinkTags(content)
        const suggestions = parseGrammarSuggestions(stripped, filteredSpans)

        logger.info(
            { projectId, suggestionCount: suggestions.length },
            '[GRAMMAR] Response sent successfully'
        )

        res.json({ success: true, suggestions })
    } catch (error) {
        clearTimeout(timeout)

        if (error.name === 'AbortError') {
            return res.status(504).json({
                success: false,
                error: 'LLM service timeout',
            })
        }

        logger.error({ projectId, err: error }, '[GRAMMAR] Error communicating with LLM service')
        res.status(500).json({
            success: false,
            error: 'Failed to communicate with LLM service',
        })
    }
}

export default {
    chat: expressify(chat),
    getModels: expressify(getModels),
    completion: expressify(completion),
    grammar: expressify(grammar),
}
