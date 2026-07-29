import BaseProvider from './BaseProvider.mjs'

// Helper function to remove <think> tags (for DeepSeek, Qwen and similar models)
// Handles both closed <think>...</think> and unclosed <think>... at end of string
function stripThinkTags(content) {
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, '')
    return cleaned.trim()
}

export default class OpenAIProvider extends BaseProvider {
  headers() {
    const headers = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    return headers
  }

  async listModels() {
    return this.fetch('/models')
  }

  async checkConnection(model) {
    return this.chat({
      model: model || 'default',
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
    const data = await this.fetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    if (!data?.choices?.[0]?.message) {
      throw new Error('Invalid OpenAI compatible provider chat response')
    }

    data.choices[0].message.content = this.extractText(data)

    return data
  }

  async complete(body) {
    const data = this.fetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    return this.extractText(data)
  }
  
  extractText(data) {
    return stripThinkTags(
      data?.choices?.[0]?.message?.content?.trim() || ''
    )
  }
}
