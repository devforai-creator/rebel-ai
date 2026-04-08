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
 * Build Anthropic cache control object for provider options.
 *
 * This helper is used for request-level automatic caching and can also be
 * reused anywhere the Anthropic provider expects the shared `cacheControl`
 * option shape.
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
 * Minimum cacheable tokens per Anthropic model family/version.
 *
 * Anthropic's prompt-caching thresholds vary by model generation, so we keep
 * the common current and legacy breakpoints explicit instead of using a single
 * family-wide value.
 */
export const ANTHROPIC_CACHE_MIN_TOKENS: Record<string, number> = {
  opus: 4096, // Opus 4.5/4.6
  opusLegacy: 1024, // Opus 4/4.1/3
  sonnet: 1024, // Sonnet 4/4.5/3.7/3.5
  haiku: 4096, // Haiku 4.5
  haikuLegacy: 2048, // Haiku 3/3.5
}

/**
 * Get minimum cacheable tokens for an Anthropic model.
 */
export function getAnthropicMinCacheTokens(modelName: string): number {
  const normalized = modelName.toLowerCase()
  if (normalized.includes('haiku-4-5')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.haiku
  }
  if (normalized.includes('haiku')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.haikuLegacy
  }
  if (normalized.includes('sonnet')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.sonnet
  }
  if (normalized.includes('opus-4-5') || normalized.includes('opus-4-6')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.opus
  }
  if (normalized.includes('opus')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.opusLegacy
  }
  // Default to most restrictive
  return ANTHROPIC_CACHE_MIN_TOKENS.haiku
}
