import { afterAll, describe, expect, it } from 'vitest'
import { checkLevel } from '../../app/src/LanguageToolController.mjs'
import { resolveLanguageToolUrl } from '../../app/src/adminConfig.mjs'

function withEnv(name, value, fn) {
  const prev = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env[name]
    else process.env[name] = prev
  }
}

describe('LanguageToolController.checkLevel (picky)', () => {
  it('defaults to picky when no flag/env is set', () => {
    expect(
      withEnv('LANGUAGE_TOOL_LEVEL', undefined, () => checkLevel({}))
    ).toBe('picky')
    expect(
      withEnv('LANGUAGE_TOOL_LEVEL', undefined, () => checkLevel(undefined))
    ).toBe('picky')
    expect(
      withEnv('LANGUAGE_TOOL_LEVEL', undefined, () =>
        checkLevel({ language: 'en-GB' }))
    ).toBe('picky')
  })

  it('honours an explicit request flag over the default', () => {
    const run = (body) => withEnv('LANGUAGE_TOOL_LEVEL', undefined, () => checkLevel(body))
    expect(run({ picky: true })).toBe('picky')
    expect(run({ picky: false })).toBe('default')
    expect(run({ picky: 0 })).toBe('default')
  })

  it('falls back to LANGUAGE_TOOL_LEVEL only when the flag is absent', () => {
    expect(
      withEnv('LANGUAGE_TOOL_LEVEL', 'default', () => checkLevel({}))
    ).toBe('default')
    // explicit request still wins
    expect(
      withEnv('LANGUAGE_TOOL_LEVEL', 'default', () => checkLevel({ picky: true }))
    ).toBe('picky')
    expect(
      withEnv('LANGUAGE_TOOL_LEVEL', 'picky', () => checkLevel({ picky: false }))
    ).toBe('default')
  })

  it('ignores invalid env values', () => {
    expect(
      withEnv('LANGUAGE_TOOL_LEVEL', 'nonsense', () => checkLevel({}))
    ).toBe('picky')
  })
})

describe('resolveLanguageToolUrl (preference order)', () => {
  it('prefers the admin JSON URL over env', () => {
    process.env.LANGUAGE_TOOL_URL = 'http://env:8010'
    process.env.LANGUAGE_TOOL_HOST = 'envhost'
    expect(
      resolveLanguageToolUrl({ languageToolUrl: 'http://admin:8010' })
    ).toBe('http://admin:8010')
    delete process.env.LANGUAGE_TOOL_URL
    delete process.env.LANGUAGE_TOOL_HOST
  })

  it('falls back to LANGUAGE_TOOL_URL, then HOST/PORT', () => {
    delete process.env.LANGUAGE_TOOL_URL
    afterAll(() => {
      delete process.env.LANGUAGE_TOOL_HOST
      delete process.env.LANGUAGE_TOOL_PORT
    })
    process.env.LANGUAGE_TOOL_HOST = 'lt'
    process.env.LANGUAGE_TOOL_PORT = '9999'
    expect(resolveLanguageToolUrl({})).toBe('http://lt:9999')

    process.env.LANGUAGE_TOOL_URL = 'http://envonly:8010'
    expect(resolveLanguageToolUrl({})).toBe('http://envonly:8010')
    delete process.env.LANGUAGE_TOOL_URL
  })

  it('returns undefined when nothing is configured', () => {
    delete process.env.LANGUAGE_TOOL_URL
    delete process.env.LANGUAGE_TOOL_HOST
    delete process.env.LANGUAGE_TOOL_PORT
    expect(resolveLanguageToolUrl({})).toBeUndefined()
    expect(resolveLanguageToolUrl(undefined)).toBeUndefined()
  })
})
