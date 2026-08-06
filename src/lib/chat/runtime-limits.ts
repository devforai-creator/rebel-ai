/**
 * Central operational tuning surface for first-class chat and runner behavior.
 *
 * Keep request caps, polling policy, rate-limit windows, and runner input
 * budgets here so tuning does not require chasing unrelated modules.
 */

import type { LlmProvider } from '@/types/database.types'
import { OPENROUTER_KIMI_K3_MODEL_ID } from '@/lib/llm/openrouter'

export const CHAT_REQUEST_LIMITS = {
  // Increased to 256KB to support characters with large first-message templates.
  maxMessageBytes: 262_144,
  // Cap parsing cost even when the platform request limit is looser.
  maxRequestBodyBytes: 5_308_416,
} as const

export const CHAT_REPROCESS_LIMITS = {
  streamUpdateIntervalMs: 200,
} as const

export const CHAT_RUNNER_LIMITS = {
  maxTotalInputTokens: 150_000,
  // Keep provider caps below the 800-second Pro + Fluid route duration so
  // stalls are handled by runner error flow instead of platform termination.
  routeMaxDurationSeconds: 800,
  providerStreamTimeoutMs: 240_000,
  kimiK3ProviderStreamTimeoutMs: 12 * 60 * 1000,
  // Leave one full Kimi budget plus 60 seconds for context loading, response
  // persistence, and runner cleanup before claiming another sequential job.
  latestJobStartMs: 20_000,
  stuckProcessingJobTimeoutMs: 20 * 60 * 1000,
} as const

export function resolveChatProviderStreamTimeoutMs({
  provider,
  modelName,
}: {
  provider: LlmProvider
  modelName: string
}): number {
  if (provider === 'openrouter' && modelName === OPENROUTER_KIMI_K3_MODEL_ID) {
    return CHAT_RUNNER_LIMITS.kimiK3ProviderStreamTimeoutMs
  }

  return CHAT_RUNNER_LIMITS.providerStreamTimeoutMs
}

export const CHAT_RATE_LIMITS = {
  userWindowSeconds: 60,
  userMaxRequests: 30,
  anonWindowSeconds: 60,
  anonMaxRequests: 10,
  maxAnonRateLimitIdentifierLength: 256,
} as const

export const CHAT_JOB_POLLER_LIMITS = {
  timeoutMs: 15 * 60 * 1000,
  initialDelayMs: 2000,
  maxDelayMs: 8000,
  backoffMultiplier: 1.8,
  slowProgressThresholdMs: 30_000,
  recentStreamWindowMs: 3000,
  recentStreamMinDelayMs: 4000,
  hiddenTabMinDelayMs: 10_000,
} as const
