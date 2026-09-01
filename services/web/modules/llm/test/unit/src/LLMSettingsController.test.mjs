/**
 * Unit tests for the LLM module's per-user grammar-settings endpoints.
 *
 *  - pure exports: degradeGrammarMode (degrade, never upgrade)
 *  - getGrammarSettings: effectiveMode degradation, model list (site models +
 *    `u:<rowId>:<model>` BYO rows), availability flags
 *  - saveGrammarSettings: invalid mode → 400; infeasible mode degrades and
 *    still succeeds
 *
 * Mock strategy (vitest 4): one hoisted mock registry + a hoisted `state`
 * object all tests mutate. The admin settings FILE is the REAL
 * readAdminSettings pointed at a fixture in os.tmpdir() via
 * LLM_ADMIN_SETTINGS_PATH (set before any controller import), rewritten per
 * test — readAdminSettings reads it on every call, so no re-import dance is
 * needed. Heavy deps (User, SessionManager) are mocked; no Mongo.
 */

import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const state = vi.hoisted(() => ({
  user: null,
  adminSettings: {},
  updateOneCalls: [],
}))

const ADMIN_FIXTURE = path.join(os.tmpdir(), `llm-admin-fixture-${process.pid}.json`)
process.env.LLM_ADMIN_SETTINGS_PATH = ADMIN_FIXTURE

vi.mock('../../../../../app/src/models/User.mjs', () => ({
  User: {
    findById: async () => state.user,
    findOne: () => ({ lean: () => Promise.resolve(state.user) }),
    updateOne: (filter, update) => {
      state.updateOneCalls.push({ filter, update })
      return { modifiedCount: 1 }
    },
  },
}))
vi.mock('../../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
  default: {
    getLoggedInUserId: () => 'user-1',
  },
}))

const { default: LLMSettingsController, degradeGrammarMode } = await import(
  '../../../app/src/LLMSettingsController.mjs'
)

class FakeRes {
  constructor() {
    this.body = ''
    this.statusCode = 200
  }
  status(code) {
    this.statusCode = code
    return this
  }
  json(obj) {
    this.body = JSON.stringify(obj)
    return this
  }
}

function makeUser(overrides = {}) {
  return {
    _id: 'user-1',
    llmProviders: [],
    llmApiUrl: '',
    llmApiKey: '',
    llmModelName: '',
    grammar: undefined,
    ...overrides,
  }
}

async function writeAdmin(config) {
  state.adminSettings = config
  await fs.writeFile(ADMIN_FIXTURE, JSON.stringify(config))
}

beforeAll(async () => {
  await fs.unlink(ADMIN_FIXTURE).catch(() => undefined)
})

afterEach(async () => {
  state.user = null
  state.updateOneCalls = []
})

beforeEach(async () => {
  await writeAdmin({})
})

describe('degradeGrammarMode (pure re-export from LLMSettingsController)', () => {
  it('keeps feasible modes', () => {
    const both = { ltAvailable: true, llmAvailableForUser: true }
    expect(degradeGrammarMode('default', both)).toBe('default')
    expect(degradeGrammarMode('lt', both)).toBe('lt')
    expect(degradeGrammarMode('llm', both)).toBe('llm')
    expect(degradeGrammarMode('lt+llm', both)).toBe('lt+llm')
  })

  it('never auto-upgrades and degrades combined to one available engine', () => {
    expect(degradeGrammarMode('lt+llm', { ltAvailable: true, llmAvailableForUser: false })).toBe('lt')
    expect(degradeGrammarMode('lt+llm', { ltAvailable: false, llmAvailableForUser: true })).toBe('llm')
    expect(degradeGrammarMode('default', { ltAvailable: false, llmAvailableForUser: false })).toBe('default')
  })

  it('drops unknown mode values to default', () => {
    expect(degradeGrammarMode('bogus', { ltAvailable: true, llmAvailableForUser: true })).toBe('default')
    expect(degradeGrammarMode('llm', null)).toBe('default')
  })
})

describe('GET /user/llm-settings/grammar', () => {
  const req = { params: {}, body: {}, session: {} }

  it('returns effectiveMode + site and BYO models when both engines are available', async () => {
    await writeAdmin({
      allowedModels: ['gpt-4o', 'llama-3'],
      llmApiUrl: 'http://llm/v1',
      llmApiKey: 'key',
      languageToolUrl: 'http://languagetool:8010',
    })
    state.user = makeUser({
      grammar: { mode: 'lt+llm', llmModel: 'gpt-4o', language: 'en-GB' },
      llmProviders: [
        {
          id: 'abcd1234',
          name: 'My Ollama',
          providerType: 'openaiCompatible',
          baseUrl: 'http://ollama/v1',
          apiKey: '',
          models: ['claude-3', 'qwen-small'],
          completionModel: 'claude-3',
          enabled: true,
        },
      ],
    })

    const res = new FakeRes()
    await LLMSettingsController.getGrammarSettings(req, res)

    const payload = JSON.parse(res.body)
    expect(payload.mode).toBe('lt+llm')
    expect(payload.effectiveMode).toBe('lt+llm')
    expect(payload.availability.llmAvailableForUser).toBe(true)
    const ids = payload.models.map(m => m.id)
    expect(ids).toContain('gpt-4o')
    expect(ids).toContain('u:abcd1234:claude-3')
    expect(ids).toContain('u:abcd1234:qwen-small')
  })

  it('degrades effectiveMode when admin force-offs make the mode infeasible', async () => {
    await writeAdmin({
      llmDisabledByAdmin: true,
      languageToolDisabledByAdmin: true,
    })
    state.user = makeUser({
      grammar: { mode: 'lt+llm', llmModel: '', language: 'auto' },
    })

    const res = new FakeRes()
    await LLMSettingsController.getGrammarSettings(req, res)

    const payload = JSON.parse(res.body)
    expect(payload.mode).toBe('lt+llm')
    expect(payload.effectiveMode).toBe('default')
    expect(payload.availability.llmAvailableForUser).toBe(false)
    expect(payload.models).toEqual([])
  })

  it('defaults to default/auto when the user has no grammar document', async () => {
    await writeAdmin({})
    state.user = makeUser()

    const res = new FakeRes()
    await LLMSettingsController.getGrammarSettings(req, res)

    const payload = JSON.parse(res.body)
    expect(payload.mode).toBe('default')
    expect(payload.effectiveMode).toBe('default')
    expect(payload.language).toBe('auto')
  })

  it('omits BYO models for disabled rows', async () => {
    await writeAdmin({
      llmApiUrl: 'http://llm/v1',
      llmApiKey: 'key',
      allowedModels: ['site-1'],
    })
    state.user = makeUser({
      llmProviders: [
        {
          id: 'deadbeef',
          name: 'Off row',
          baseUrl: 'http://x/v1',
          models: ['model-a'],
          enabled: false,
        },
      ],
    })

    const res = new FakeRes()
    await LLMSettingsController.getGrammarSettings(req, res)

    const payload = JSON.parse(res.body)
    const ids = payload.models.map(m => m.id)
    expect(ids).toContain('site-1')
    expect(ids).not.toContain('u:deadbeef:model-a')
  })
})

describe('POST /user/llm-settings/grammar', () => {
  const req = { params: {}, body: {}, session: {} }

  it('rejects invalid modes with 400', async () => {
    req.body = { mode: 'bogus' }
    const res = new FakeRes()
    await LLMSettingsController.saveGrammarSettings(req, res)
    expect(res.statusCode).toBe(400)
    expect(state.updateOneCalls.length).toBe(0)
  })

  it('degrades an infeasible mode on save and reports the degradation', async () => {
    await writeAdmin({
      llmDisabledByAdmin: true,
      languageToolDisabledByAdmin: true,
    })
    req.body = { mode: 'lt', llmModel: '', language: 'en-US' }
    const res = new FakeRes()
    await LLMSettingsController.saveGrammarSettings(req, res)

    expect(state.updateOneCalls).toHaveLength(1)
    const payload = JSON.parse(res.body)
    expect(payload.success).toBe(true)
    expect(payload.degraded).toBe(true)
    expect(payload.effectiveMode).toBe('default')
    expect(payload.mode).toBe('lt')
  })

  it('keeps every stored key when only the mode changes', async () => {
    await writeAdmin({
      llmApiUrl: 'http://llm/v1',
      llmApiKey: 'key',
      languageToolUrl: 'http://languagetool:8010',
    })
    state.user = makeUser({
      grammar: { mode: 'lt', llmModel: 'gpt-4o', language: 'de-DE' },
    })
    req.body = { mode: 'lt+llm' }
    const res = new FakeRes()
    await LLMSettingsController.saveGrammarSettings(req, res)

    expect(state.updateOneCalls).toHaveLength(1)
    const { filter, update } = state.updateOneCalls[0]
    expect(filter).toEqual({ _id: 'user-1' })
    expect(update.$set.grammar).toEqual({
      mode: 'lt+llm',
      llmModel: 'gpt-4o',
      language: 'de-DE',
    })
    const payload = JSON.parse(res.body)
    expect(payload.degraded).toBe(false)
    expect(payload.effectiveMode).toBe('lt+llm')
  })
})
