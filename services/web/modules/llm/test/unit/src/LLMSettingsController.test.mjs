/**
 * Unit tests for the LLM module's per-user grammar-settings endpoints.
 *
 *  - Pure exports: degradeGrammarMode (the shared degrade rule)
 *  - getGrammarSettings: effectiveMode degradation, model list (server
 *    models + personal-<model>), availability flags
 *  - saveGrammarSettings: invalid mode → 400; infeasible mode degrades and
 *    succeeds
 *
 * Heavy deps (User, SessionManager, admin settings file) are mocked so this
 * runs in the fast unit path without Mongo.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import MockResponse from '../../../../../test/unit/src/helpers/MockResponse.mjs'

const CONTROLLER_PATH = new URL(
  '../../../app/src/LLMSettingsController.mjs',
  import.meta.url
).pathname

function makeUser(overrides = {}) {
  return {
    _id: 'user-1',
    useOwnLLMSettings: false,
    llmApiKey: '',
    llmModelName: '',
    llmApiUrl: '',
    grammar: undefined,
    ...overrides,
  }
}

describe('LLMSettingsController (grammar)', function () {
  async function setup(ctx) {
    vi.resetModules()
    vi.doMock('../../../app/src/LLMAdminController.mjs', () => ({
      readAdminSettings: async () => ctx.adminSettings,
      ADMIN_SETTINGS_PATH: '/tmp/llm-grammar-test.json',
      getSystemPrompt: async () => null,
      getAdminLLMSettings: async () => ({
        llmApiUrl: ctx.adminSettings.llmApiUrl || null,
        llmApiKey: ctx.adminSettings.llmApiKey || null,
        allowedModels: ctx.adminSettings.allowedModels || [],
      }),
    }))
    vi.doMock('../../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
      default: {
        getLoggedInUserId: () => 'user-1',
      },
    }))
    vi.doMock('../../../../../app/src/models/User.mjs', () => ({
      User: {
        findById: sinon
          .stub()
          .callsFake(async function () {
            return ctx.user
          }),
        updateOne: (...args) => ctx.userUpdateOne(...args),
      },
    }))
  }

  function getController() {
    const mod = import(CONTROLLER_PATH)
    return mod.then(m => ({
      getGrammarSettings: m.default.getGrammarSettings,
      saveGrammarSettings: m.default.saveGrammarSettings,
      degradeGrammarMode: m.degradeGrammarMode,
    }))
  }

  beforeEach(async function (ctx) {
    ctx.adminSettings = {}
    ctx.user = makeUser()
    ctx.req = { params: {}, body: {}, session: {} }
    ctx.res = new MockResponse(vi)
    ctx.userUpdateOne = vi.fn()
  })

  // The ctx-based mocks are registered in each test via setup(ctx) because
  // vi.doMock needs to happen before every fresh dynamic import.

  describe('degradeGrammarMode (pure export)', function () {
    it('keeps feasible modes', async function (ctx) {
      await setup(ctx)
      const { degradeGrammarMode } = await getController()
      const bothOn = {
        ltAvailable: true,
        llmAvailableForUser: true,
      }
      expect(degradeGrammarMode('default', bothOn)).toBe('default')
      expect(degradeGrammarMode('lt', bothOn)).toBe('lt')
      expect(degradeGrammarMode('llm', bothOn)).toBe('llm')
      expect(degradeGrammarMode('lt+llm', bothOn)).toBe('lt+llm')
    })

    it('never auto-upgrades and degrades combined to one available engine', async function (ctx) {
      await setup(ctx)
      const { degradeGrammarMode } = await getController()
      expect(
        degradeGrammarMode('lt+llm', {
          ltAvailable: true,
          llmAvailableForUser: false,
        })
      ).toBe('lt')
      expect(
        degradeGrammarMode('lt+llm', {
          ltAvailable: false,
          llmAvailableForUser: true,
        })
      ).toBe('llm')
      expect(
        degradeGrammarMode('default', {
          ltAvailable: false,
          llmAvailableForUser: false,
        })
      ).toBe('default')
    })

    it('drops unknown mode values to default', async function (ctx) {
      await setup(ctx)
      const { degradeGrammarMode } = await getController()
      expect(
        degradeGrammarMode('bogus', {
          ltAvailable: true,
          llmAvailableForUser: true,
        })
      ).toBe('default')
    })
  })

  describe('GET /user/llm-settings/grammar', function () {
    it('returns effectiveMode + server and personal models when both engines are available', async function (ctx) {
      ctx.adminSettings = {
        allowedModels: ['gpt-4o', 'llama-3'],
        llmApiUrl: 'http://llm/v1',
        llmApiKey: 'key',
        languageToolUrl: 'http://languagetool:8010',
      }
      ctx.user = makeUser({
        grammar: { mode: 'lt+llm', llmModel: 'gpt-4o', language: 'en-GB' },
        useOwnLLMSettings: true,
        llmApiKey: 'personal-key',
        llmModelName: 'claude-3',
        llmApiUrl: 'http://personal/v1',
      })
      await setup(ctx)

      const { getGrammarSettings } = await getController()
      await getGrammarSettings(ctx.req, ctx.res)

      const payload = JSON.parse(ctx.res.body)
      expect(payload.mode).toBe('lt+llm')
      expect(payload.effectiveMode).toBe('lt+llm')
      expect(payload.availability.llmAvailableForUser).toBe(true)
      const ids = payload.models.map((m) => m.id)
      expect(ids).toContain('gpt-4o')
      expect(ids).toContain('personal-claude-3')
    })

    it('degrades effectiveMode when admin force-offs make the mode infeasible', async function (ctx) {
      ctx.adminSettings = {
        llmDisabledByAdmin: true,
        languageToolDisabledByAdmin: true,
      }
      ctx.user = makeUser({
        grammar: { mode: 'lt+llm', llmModel: '', language: 'auto' },
      })
      await setup(ctx)

      const { getGrammarSettings } = await getController()
      await getGrammarSettings(ctx.req, ctx.res)

      const payload = JSON.parse(ctx.res.body)
      expect(payload.mode).toBe('lt+llm')
      expect(payload.effectiveMode).toBe('default')
      expect(payload.availability.llmAvailableForUser).toBe(false)
      expect(payload.models).toEqual([])
    })

    it('defaults to default/auto when the user has no grammar document', async function (ctx) {
      ctx.adminSettings = {}
      ctx.user = makeUser()
      await setup(ctx)

      const { getGrammarSettings } = await getController()
      await getGrammarSettings(ctx.req, ctx.res)

      const payload = JSON.parse(ctx.res.body)
      expect(payload.mode).toBe('default')
      expect(payload.effectiveMode).toBe('default')
      expect(payload.language).toBe('auto')
    })
  })

  describe('POST /user/llm-settings/grammar', function () {
    it('rejects invalid modes with 400', async function (ctx) {
      ctx.req.body = { mode: 'bogus' }
      await setup(ctx)

      const { saveGrammarSettings } = await getController()
      await saveGrammarSettings(ctx.req, ctx.res)

      expect(ctx.res.statusCode).toBe(400)
    })

    it('degrades an infeasible mode on save and reports the degradation', async function (ctx) {
      ctx.adminSettings = {
        llmDisabledByAdmin: true,
        languageToolDisabledByAdmin: true,
      }
      ctx.req.body = { mode: 'lt', llmModel: '', language: 'en-US' }
      await setup(ctx)

      const { saveGrammarSettings } = await getController()
      await saveGrammarSettings(ctx.req, ctx.res)

      expect(ctx.userUpdateOne).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(ctx.res.body)
      expect(payload.success).toBe(true)
      expect(payload.degraded).toBe(true)
      expect(payload.effectiveMode).toBe('default')
    })
  })
})
