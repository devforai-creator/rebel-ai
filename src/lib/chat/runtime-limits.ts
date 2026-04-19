/**
 * Central operational tuning surface for first-class chat and runner behavior.
 *
 * Keep request caps, polling policy, rate-limit windows, and runner input
 * budgets here so tuning does not require chasing unrelated modules.
 */

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
} as const

export const CHAT_RATE_LIMITS = {
  userWindowSeconds: 60,
  userMaxRequests: 30,
  anonWindowSeconds: 60,
  anonMaxRequests: 10,
  maxAnonRateLimitIdentifierLength: 256,
} as const

export const CHAT_JOB_POLLER_LIMITS = {
  timeoutMs: 10 * 60 * 1000,
  initialDelayMs: 2000,
  maxDelayMs: 8000,
  backoffMultiplier: 1.8,
  slowProgressThresholdMs: 30_000,
  recentStreamWindowMs: 3000,
  recentStreamMinDelayMs: 4000,
  hiddenTabMinDelayMs: 10_000,
} as const
