import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider'
import { isOpenAIGpt56Model } from '@/lib/models'

export type AnthropicCacheTTL = '5m' | '1h'
export const DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT = 'high'
export const ANTHROPIC_INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14'
export const DEFAULT_OPENAI_TEXT_VERBOSITY = 'low'

type ProviderOptionsInput = {
  modelName?: string | null
  promptCacheKey?: string | null
  promptCacheRetention?: '24h' | 'in_memory'
  // Provider-specific reasoning options
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
    const openaiOptions: Record<string, JSONValue> = {
      textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
    }

    if (overrides?.promptCacheKey) {
      openaiOptions.promptCacheKey = overrides.promptCacheKey
      if (!isOpenAIGpt56Model(overrides.modelName)) {
        openaiOptions.promptCacheRetention = overrides.promptCacheRetention ?? '24h'
      }
    }

    if (
      overrides?.reasoningEffort &&
      (overrides.reasoningEffort !== 'none' || isOpenAIGpt56Model(overrides.modelName))
    ) {
      openaiOptions.reasoningEffort = overrides.reasoningEffort
    }

    if (Object.keys(openaiOptions).length > 0) {
      options.openai = openaiOptions
    }
  }

  if (provider === 'anthropic' && supportsAnthropicAdaptiveThinking(overrides?.modelName)) {
    const anthropicOptions: Record<string, JSONValue> = {
      thinking: {
        type: 'adaptive',
      },
      effort:
        overrides?.reasoningEffort && overrides.reasoningEffort !== 'none'
          ? overrides.reasoningEffort
          : DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT,
    }

    if (!usesBuiltInAnthropicInterleavedThinking(overrides?.modelName)) {
      anthropicOptions.anthropicBeta = [ANTHROPIC_INTERLEAVED_THINKING_BETA]
    }

    options.anthropic = anthropicOptions
  }

  return Object.keys(options).length > 0 ? options : undefined
}

export function supportsAnthropicAdaptiveThinking(modelName?: string | null): boolean {
  if (typeof modelName !== 'string') {
    return false
  }

  const normalized = modelName.trim().toLowerCase().replaceAll('.', '-')
  if (!normalized) {
    return false
  }

  if (normalized.includes('claude-mythos-preview')) {
    return true
  }

  if (normalized.includes('claude-fable-5') || normalized.includes('claude-mythos-5')) {
    return true
  }

  const opusMatch = normalized.match(/claude-opus-4-(\d+)/)
  if (opusMatch && Number(opusMatch[1]) >= 6) {
    return true
  }

  if (normalized.includes('claude-sonnet-5')) {
    return true
  }

  const sonnetMatch = normalized.match(/claude-sonnet-4-(\d+)/)
  if (sonnetMatch && Number(sonnetMatch[1]) >= 6) {
    return true
  }

  return false
}

function usesBuiltInAnthropicInterleavedThinking(modelName?: string | null): boolean {
  if (typeof modelName !== 'string') {
    return false
  }

  const normalized = modelName.trim().toLowerCase().replaceAll('.', '-')
  return (
    normalized.includes('claude-fable-5') ||
    normalized.includes('claude-mythos-5') ||
    normalized.includes('claude-sonnet-5')
  )
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
  fable: 512, // Fable 5
  mythos: 512, // Mythos 5
  mythosPreview: 2048, // Mythos Preview
  opus48: 1024, // Opus 4.8
  opus: 4096, // Opus 4.5/4.6/4.7
  opusLegacy: 1024, // Opus 4/4.1/3
  sonnet: 1024, // Sonnet 4/4.5/3.7/3.5
  haiku: 4096, // Haiku 4.5
  haikuLegacy: 2048, // Haiku 3/3.5
}

/**
 * Get minimum cacheable tokens for an Anthropic model.
 */
export function getAnthropicMinCacheTokens(modelName: string): number {
  const normalized = modelName.toLowerCase().replaceAll('.', '-')
  if (normalized.includes('fable-5')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.fable
  }
  if (normalized.includes('mythos-preview')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.mythosPreview
  }
  if (normalized.includes('mythos-5')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.mythos
  }
  if (normalized.includes('haiku-4-5')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.haiku
  }
  if (normalized.includes('haiku')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.haikuLegacy
  }
  if (normalized.includes('sonnet')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.sonnet
  }
  if (normalized.includes('opus-4-8')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.opus48
  }
  if (
    normalized.includes('opus-4-5') ||
    normalized.includes('opus-4-6') ||
    normalized.includes('opus-4-7')
  ) {
    return ANTHROPIC_CACHE_MIN_TOKENS.opus
  }
  if (normalized.includes('opus')) {
    return ANTHROPIC_CACHE_MIN_TOKENS.opusLegacy
  }
  // Default to most restrictive
  return ANTHROPIC_CACHE_MIN_TOKENS.haiku
}
