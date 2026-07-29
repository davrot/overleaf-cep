import BaseProvider from './BaseProvider.mjs'

// Helper function to remove <think> tags (for DeepSeek, Qwen and similar models)
// Handles both closed <think>...</think> and unclosed <think>... at end of string
function stripThinkTags(content) {
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, '')
    return cleaned.trim()
}

export default class AnthropicProvider extends BaseProvider {
  headers() {
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey
    }

    return headers
  }

  async listModels() {
    return this.fetch('/v1/models')
  }

  async checkConnection(model) {
    return this.chat({
      model: model || 'claude-sonnet-5',
      messages: [
        {
          role: 'user',
          content: 'Test connection',
        },
      ],
      max_tokens: 1,
    })
  }

  async chat(body) {
    const data = await this.fetch('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(this.buildRequest(body)),
    })

    return {
      id: data.id,
      model: data.model,
      usage: data.usage,
      choices: [
        {
          index: 0,
          finish_reason: data.stop_reason,
          message: {
            role: 'assistant',
            content: this.extractText(data),
          },
        },
      ],
    }
  }

  async complete(body) {
    const data = await this.fetch('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(this.buildRequest(body)),
    })

    return this.extractText(data)
  }

  buildRequest(body) {
    const { messages = [], ...rest } = body

    const system = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n')

    const request = {
      ...rest,
      messages: messages.filter(m => m.role !== 'system'),
    }

    if (system) {
      request.system = system
    }

    return request
  }

  extractText(data) {
    return stripThinkTags(
      (data.content || [])
        .filter(x => x.type === 'text')
        .map(x => x.text)
        .join('')
        .trim()
    )
  }
}
