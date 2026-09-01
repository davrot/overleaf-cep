// overleaf-lab (grammar port): pure helpers for the editor grammar feature —
// the degrade rule, the cost caps, the prompt shape, and the lenient JSON
// parser that maps LLM suggestions back onto the spans we actually sent.
// Run: cd services/web/modules/llm && node --test app/test/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
    GRAMMAR_MODES,
    GRAMMAR_MAX_SPANS,
    GRAMMAR_MAX_TOTAL_CHARS,
    degradeGrammarMode,
    sanitizeGrammarSpans,
    buildGrammarMessages,
    parseGrammarSuggestions,
} from '../src/LLMGrammar.mjs'

test('degrade: keeps every feasible mode', () => {
    const both = { ltAvailable: true, llmAvailableForUser: true }
    assert.equal(degradeGrammarMode('default', both), 'default')
    assert.equal(degradeGrammarMode('lt', both), 'lt')
    assert.equal(degradeGrammarMode('llm', both), 'llm')
    assert.equal(degradeGrammarMode('lt+llm', both), 'lt+llm')
})

test('degrade: drops infeasible engines, never auto-upgrades', () => {
    assert.equal(degradeGrammarMode('lt', { ltAvailable: false, llmAvailableForUser: true }), 'default')
    assert.equal(degradeGrammarMode('llm', { ltAvailable: true, llmAvailableForUser: false }), 'default')
    assert.equal(degradeGrammarMode('default', { ltAvailable: true, llmAvailableForUser: true }), 'default')
})

test('degrade: combined mode falls back to the one engine that is on', () => {
    assert.equal(degradeGrammarMode('lt+llm', { ltAvailable: true, llmAvailableForUser: false }), 'lt')
    assert.equal(degradeGrammarMode('lt+llm', { ltAvailable: false, llmAvailableForUser: true }), 'llm')
    assert.equal(degradeGrammarMode('lt+llm', { ltAvailable: false, llmAvailableForUser: false }), 'default')
})

test('degrade: unknown modes and missing availability -> default', () => {
    assert.equal(degradeGrammarMode('bogus', { ltAvailable: true, llmAvailableForUser: true }), 'default')
    assert.equal(degradeGrammarMode('llm', null), 'default')
})

test('sanitize: caps span count and scales total chars to the budget', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ spanId: `s${i}`, text: 'x'.repeat(400) }))
    const r = sanitizeGrammarSpans(many)
    assert.equal(r.spans.length, GRAMMAR_MAX_SPANS)
    assert.equal(r.truncated, true)
    assert.equal(r.totalChars, r.spans.reduce((n, s) => n + s.text.length, 0))
    assert.ok(r.totalChars <= GRAMMAR_MAX_TOTAL_CHARS)
})

test('sanitize: synthesizes span ids, drops non-strings, null on non-array', () => {
    const r = sanitizeGrammarSpans([{ text: 'one' }, { id: 'legacy', text: 'two' }, 'nonsense', null])
    assert.deepEqual(r.spans.map(s => s.spanId), ['s0', 'legacy', 's2', 's3'])
    assert.deepEqual(r.spans.map(s => s.text), ['one', 'two', '', ''])
    assert.equal(r.truncated, false)
    assert.equal(sanitizeGrammarSpans('nope'), null)
    assert.equal(sanitizeGrammarSpans(undefined), null)
})

test('sanitize: short input is left untouched', () => {
    const spans = [{ spanId: 'a', text: 'alpha' }, { spanId: 'b', text: 'beta' }]
    const r = sanitizeGrammarSpans(spans)
    assert.deepEqual(r.spans, spans)
    assert.equal(r.totalChars, 9)
})

test('prompt: system + user, one numbered block per span', () => {
    const spans = [{ spanId: 's0', text: 'first span' }, { spanId: 's1', text: 'second span' }]
    const messages = buildGrammarMessages(spans)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].role, 'system')
    assert.match(messages[0].content, /single JSON array/)
    assert.equal(messages[1].role, 'user')
    assert.match(messages[1].content, /--- id: s0 ---\nfirst span/)
    assert.match(messages[1].content, /--- id: s1 ---\nsecond span/)
})

test('parse: valid array against the spans we sent', () => {
    const spans = [{ spanId: 's0', text: 'Hello world' }, { spanId: 's1', text: 'Second line' }]
    const out = parseGrammarSuggestions(
        '[{"id":"s0","start":0,"end":5,"message":"caps","suggestion":"hello"},{"id":"s1","start":1,"end":2,"message":""}]',
        spans
    )
    assert.equal(out.length, 2)
    assert.deepEqual(out[0], { spanId: 's0', start: 0, end: 5, message: 'caps', suggestion: 'hello' })
    assert.equal(out[1].suggestion, '')
})

test('parse: tolerates code fences and leading prose', () => {
    const spans = [{ spanId: 's0', text: 'abcdef' }]
    const out = parseGrammarSuggestions(
        'Sure! Here is the result:\n```json\n[{"id":"s0","start":1,"end":3,"message":"m","suggestion":"X"}]\n```',
        spans
    )
    assert.equal(out.length, 1)
    assert.equal(out[0].suggestion, 'X')
})

test('parse: out-of-bounds / unknown span / non-positive ranges are dropped', () => {
    const spans = [{ spanId: 's0', text: 'abcdef' }]
    const items = [
        { id: 's0', start: 5, end: 99, message: 'over' },
        { id: 'missing', start: 0, end: 1, message: 'no span' },
        { id: 's0', start: 3, end: 3, message: 'zero width' },
        { id: 's0', start: -1, end: 1, message: 'negative' },
        { id: 's0', start: 1, end: 2, message: 'ok', suggestion: 'X' },
        'garbage',
        42,
    ]
    const out = parseGrammarSuggestions(JSON.stringify(items), spans)
    assert.equal(out.length, 1)
    assert.equal(out[0].id, undefined)
    assert.equal(out[0].spanId, 's0')
})

test('parse: invalid JSON / non-array -> []', () => {
    const spans = [{ spanId: 's0', text: 'abcdef' }]
    assert.deepEqual(parseGrammarSuggestions('no json here', spans), [])
    assert.deepEqual(parseGrammarSuggestions('{"a":1}', spans), [])
    assert.deepEqual(parseGrammarSuggestions(null, spans), [])
})
