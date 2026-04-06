import crypto from 'crypto'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import { hasExtendedOpenAICacheRetention } from '@/lib/models'
import { getAnthropicMinCacheTokens, type AnthropicCacheTTL } from './provider-options'

const PROMPT_CACHE_VERSION = 'v1'

function isEnabled(): boolean {
  const raw = process.env.OPENAI_PROMPT_CACHE_ENABLED
  if (!raw) {
    return true
  }
  return raw === '1' || raw.toLowerCase() === 'true'
}

function resolveMinTokens(): number {
  const raw = Number(process.env.OPENAI_PROMPT_CACHE_MIN_TOKENS ?? '1024')
  if (!Number.isFinite(raw) || raw < 1) {
    return 1024
  }
  return Math.trunc(raw)
}

function resolveRetention(): '24h' | 'in_memory' {
  const raw = process.env.OPENAI_PROMPT_CACHE_RETENTION
  return raw === 'in_memory' ? 'in_memory' : '24h'
}

const PROMPT_CACHE_MIN_TOKENS = resolveMinTokens()
const PROMPT_CACHE_RETENTION = resolveRetention()

export interface PromptCacheDecision {
  key: string
  retention: '24h' | 'in_memory'
}

export function resolvePromptCacheDecision({
  provider,
  modelName,
  systemPrompt,
  messages,
  totalInputTokens,
  cacheKeyOverride,
  retentionPreference,
}: {
  provider: string
  modelName: string
  systemPrompt: string
  messages: SanitizedMessage[]
  totalInputTokens: number
  cacheKeyOverride?: string | null
  retentionPreference?: '24h' | 'in_memory'
}): PromptCacheDecision | null {
  if (provider !== 'openai') {
    return null
  }

  if (!isEnabled()) {
    return null
  }

  if (totalInputTokens < PROMPT_CACHE_MIN_TOKENS) {
    return null
  }

  const retention =
    retentionPreference === '24h'
      ? hasExtendedOpenAICacheRetention(modelName)
        ? '24h'
        : 'in_memory'
      : (retentionPreference ??
        (hasExtendedOpenAICacheRetention(modelName) ? PROMPT_CACHE_RETENTION : 'in_memory'))

  const key =
    cacheKeyOverride ??
    (() => {
      const payload = JSON.stringify({
        v: PROMPT_CACHE_VERSION,
        model: modelName,
        systemPrompt,
        messages,
      })
      const hash = crypto.createHash('sha256').update(payload).digest('base64url')
      return `ctx:${hash}`
    })()

  return {
    key,
    retention,
  }
}

// ============================================================================
// Anthropic Cache Decision
// ============================================================================

export interface AnthropicCacheDecision {
  enabled: boolean
  ttl: AnthropicCacheTTL
  minTokens: number
}

function isAnthropicCacheEnabled(): boolean {
  const raw = process.env.ANTHROPIC_PROMPT_CACHE_ENABLED
  if (!raw) {
    return true // Enabled by default (split-system strategy implemented 2025-12-10)
  }
  return raw === '1' || raw.toLowerCase() === 'true'
}

function resolveAnthropicCacheTTL(): AnthropicCacheTTL {
  const raw = process.env.ANTHROPIC_PROMPT_CACHE_TTL
  if (!raw) {
    return '5m' // Default to 5 minutes
  }
  return raw === '1h' ? '1h' : '5m'
}

/**
 * Determine if Anthropic caching should be applied.
 *
 * Unlike OpenAI's key-based caching, Anthropic caching:
 * - Applies cache_control inline on message parts
 * - Has different token thresholds per model family
 * - Uses ephemeral caching with 5-minute or 1-hour TTL
 *
 * @returns Cache decision with model-specific minimum tokens
 */
export function resolveAnthropicCacheDecision({
  modelName,
  systemPromptTokens,
}: {
  modelName: string
  systemPromptTokens: number
}): AnthropicCacheDecision | null {
  if (!isAnthropicCacheEnabled()) {
    return null
  }

  const minTokens = getAnthropicMinCacheTokens(modelName)

  if (systemPromptTokens < minTokens) {
    return null
  }

  return {
    enabled: true,
    ttl: resolveAnthropicCacheTTL(),
    minTokens,
  }
}
