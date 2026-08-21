import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

let LLMModule = {}

// LLM module is enabled when LLM_ENABLED env is set or llm.enabled in settings
const llmEnabled =
    process.env.LLM_ENABLED === 'true' ||
    (Settings.llm && Settings.llm.enabled !== false)

logger.info(
    {
        LLM_ENABLED: process.env.LLM_ENABLED,
        LLM_API_URL: process.env.LLM_API_URL ? '(set)' : '(not set)',
        LLM_API_KEY: process.env.LLM_API_KEY ? '(set)' : '(not set)',
        LLM_MODEL_NAME: process.env.LLM_MODEL_NAME,
        LLM_ALLOW_USER_SETTINGS: process.env.LLM_ALLOW_USER_SETTINGS,
        settingsLlm: Settings.llm,
        llmEnabled,
    },
    '[LLM] Module init: environment check'
)

if (llmEnabled) {
    const { default: LLMRouter } = await import('./app/src/LLMRouter.mjs')

    // Configure LLM settings from environment
    Settings.llm = Settings.llm || {}
    Settings.llm.enabled = true
    // overleaf-lab: make LLM_ALLOW_USER_SETTINGS authoritative. Upstream's `?? true`
    // fallback meant LLM_ALLOW_USER_SETTINGS=false never actually disabled per-user
    // settings; now only an explicit 'true' enables bring-your-own keys (OpenAI, etc.).
    Settings.llm.allowUserSettings = process.env.LLM_ALLOW_USER_SETTINGS === 'true'

    logger.info(
        {
            llmSettings: Settings.llm,
            routerType: typeof LLMRouter,
            hasApply: typeof LLMRouter?.apply,
        },
        '[LLM] Module loaded successfully'
    )

    LLMModule = {
        name: 'llm',
        router: LLMRouter,
        // overleaf-lab (reviewer #9): keep BYO model lists fresh — background sync
        // after startup and every 24h. The core web app calls `module.start?.()`
        // on boot (infrastructure/Modules.mjs).
        start: () =>
            (async () => {
                const { startModelSync } = await import('./app/src/LLMModelSync.mjs')
                const { User } = await import('../../app/src/models/User.mjs')
                startModelSync({
                    // $elemMatch matters: the positional-style 'llmProviders.$enabled'
                    // filter matches NOTHING in this mongo version (verified live),
                    // which would silently sync zero users forever.
                    findUsers: () => User.find({ llmProviders: { $elemMatch: { enabled: true, baseUrl: { $ne: '' } } } }).lean(),
                    applySync: (user, row, updatedRow) =>
                        User.updateOne(
                            { _id: user._id },
                            { $set: { llmProviders: user.llmProviders.map(r => (r.id === row.id ? updatedRow : r)) } },
                        ),
                })
            })().catch(err => {
                logger.warn({ err: err?.message }, '[LLM] model sync: failed to start')
            }),
    }
} else {
    logger.info({}, '[LLM] Module NOT loaded (disabled)')
}

export default LLMModule
