import AbortError from 'node-fetch'
import { fetchJson, RequestFailedError } from '@overleaf/fetch-utils'
import OError from '@overleaf/o-error'

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000

function handleError(err) {
  if (err.name === 'AbortError') {
    throw new OError('LLM request timed out', { timeout: REQUEST_TIMEOUT_MS / 1000, status: 504 }).withCause(err)
  }
  const status = err.response?.status || 500

  if (!(err instanceof RequestFailedError)) {
    throw new OError('Something wrong with LLM request', { status }).withCause(err)
  }

  let errInfo
  try {
    errInfo = JSON.parse(err.body)
  } catch {
    errInfo = { message: err.body }
  }

  throw new OError('LLM request failed', errInfo).withCause(err)
}

export default class BaseProvider {
  constructor({ llmApiUrl, llmApiKey }) {
    this.apiUrl = llmApiUrl.replace(/\/+$/, '')
    this.apiKey = llmApiKey || ''
  }

  async listModels() {
    throw new Error('Not implemented')
  }

  async checkConnection(model) {
    throw new Error('Not implemented')
  }

  async chat(body) {
    throw new Error('Not implemented')
  }

  async complete(body) {
    throw new Error('Not implemented')
  }

  async fetch(path, options = {}) {
    return await fetchJson(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        ...this.headers(),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(err => { handleError(err) })
  }

  normalizeChatResponse(data) {
    return data
  }

  headers() {
    return {}
  }
}
