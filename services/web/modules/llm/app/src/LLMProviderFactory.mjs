import OpenAIProvider from './providers/OpenAIProvider.mjs'
import AnthropicProvider from './providers/AnthropicProvider.mjs'

export function createLLMProvider(settings) {
  switch (settings.llmProvider) {
    case 'openai':
      return new OpenAIProvider(settings)

    case 'anthropic':
    default:
      return new AnthropicProvider(settings)
  }
}
