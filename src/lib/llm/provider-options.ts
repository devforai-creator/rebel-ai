import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider'

export type AnthropicCacheTTL = '5m' | '1h'

type ProviderOptionsInput = {
  promptCacheKey?: string | null
  promptCacheRetention?: '24h' | 'in_memory'
  // OpenAI-specific reasoning options
  reasoningEffort?: string | null
  // Anthropic-specific cache options
  anthropicCacheEnabled?: boolean
  anthropicCacheTTL?: AnthropicCacheTTL
}

const GOOGLE_SAFETY_SETTINGS: Array<Record<string, JSONValue>> = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
]

export function getProviderOptions(
  provider: string,
  overrides?: ProviderOptionsInput,
): SharedV2ProviderOptions | undefined {
  const options: SharedV2ProviderOptions = {}

  if (provider === 'google') {
    options.google = {
      safetySettings: GOOGLE_SAFETY_SETTINGS,
    }
  }

  if (provider === 'openai') {
    const openaiOptions: Record<string, JSONValue> = {}

    if (overrides?.promptCacheKey) {
      openaiOptions.promptCacheKey = overrides.promptCacheKey
      openaiOptions.promptCacheRetention = overrides.promptCacheRetention ?? '24h'
    }

    if (overrides?.reasoningEffort && overrides.reasoningEffort !== 'none') {
      openaiOptions.reasoningEffort = overrides.reasoningEffort
    }

    if (Object.keys(openaiOptions).length > 0) {
      options.openai = openaiOptions
    }
  }

  return Object.keys(options).length > 0 ? options : undefined
}

/**
 * Build Anthropic cache control object for message parts.
 *
 * Anthropic caching is applied per-message-part using providerOptions.
 *
 * @example
 * ```typescript
 * const system = [
 *   { type: 'text', text: 'Short instructions' },
 *   {
 *     type: 'text',
 *     text: longContext,
 *     providerOptions: {
 *       anthropic: buildAnthropicCacheControl('5m')
 *     }
 *   }
 * ]
 * ```
 */
export function buildAnthropicCacheControl(
  ttl: AnthropicCacheTTL = '5m',
): Record<string, JSONValue> {
  if (ttl === '1h') {
    return { cacheControl: { type: 'ephemeral', ttl: '1h' } }
  }
  // Default 5-minute TTL
  return { cacheControl: { type: 'ephemeral' } }
}

/**
 * Minimum cacheable tokens per Anthropic model family.
 */
export const ANTHROPIC_CACHE_MIN_TOKENS: Record<string, number> = {
  opus: 4096, // Opus 4.5/4.6 requires 4096 tokens
  sonnet: 2048, // Sonnet 4.6 requires 2048 tokens
  haiku: 4096, // Haiku 4.5 requires 4096 tokens
}

/**
 * Get minimum cacheable tokens for an Anthropic model.
 */
export function getAnthropicMinCacheTokens(modelName: string): number {
  const normalized = modelName.toLowerCase()
  if (normalized.includes('haiku')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.haiku
  }
  if (normalized.includes('sonnet')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.sonnet
  }
  if (normalized.includes('opus')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.opus
  }
  // Default to most restrictive
  return ANTHROPIC_CACHE_MIN_TOKENS.haiku
}
