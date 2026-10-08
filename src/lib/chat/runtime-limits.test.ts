import { describe, expect, it } from 'vitest'
import {
  CHAT_JOB_POLLER_LIMITS,
  CHAT_RUNNER_LIMITS,
  resolveChatProviderStreamTimeoutMs,
  resolveChatInputTokenLimit,
} from './runtime-limits'

describe('chat runtime limits', () => {
  it('allows 200K input for local and cloud requests while retaining timeout budgets', () => {
    expect(
      resolveChatProviderStreamTimeoutMs({ provider: 'local', modelName: 'local-rp-base' }),
    ).toBe(840_000)
    expect(resolveChatInputTokenLimit('local')).toBe(200_000)
    expect(resolveChatInputTokenLimit('openrouter')).toBe(200_000)
    expect(CHAT_RUNNER_LIMITS.localProviderStreamTimeoutMs + 40_000).toBeLessThan(
      CHAT_JOB_POLLER_LIMITS.timeoutMs,
    )
    expect(CHAT_JOB_POLLER_LIMITS.timeoutMs).toBeLessThan(
      CHAT_RUNNER_LIMITS.stuckProcessingJobTimeoutMs,
    )
  })

  it('gives OpenRouter Kimi K3 a long reasoning-aware stream budget', () => {
    expect(
      resolveChatProviderStreamTimeoutMs({
        provider: 'openrouter',
        modelName: 'moonshotai/kimi-k3',
      }),
    ).toBe(12 * 60 * 1000)
  })

  it('gives other cloud models the same extended generation budget', () => {
    expect(
      resolveChatProviderStreamTimeoutMs({
        provider: 'openrouter',
        modelName: 'z-ai/glm-5',
      }),
    ).toBe(12 * 60 * 1000)
  })

  it('orders the provider, route, poller, and stuck-job deadlines safely', () => {
    expect(CHAT_RUNNER_LIMITS.kimiK3ProviderStreamTimeoutMs).toBeLessThan(
      CHAT_RUNNER_LIMITS.routeMaxDurationSeconds * 1000,
    )
    expect(
      CHAT_RUNNER_LIMITS.latestJobStartMs +
        Math.max(
          CHAT_RUNNER_LIMITS.providerStreamTimeoutMs,
          CHAT_RUNNER_LIMITS.kimiK3ProviderStreamTimeoutMs,
        ) +
        60_000,
    ).toBeLessThanOrEqual(CHAT_RUNNER_LIMITS.routeMaxDurationSeconds * 1000)
    expect(CHAT_RUNNER_LIMITS.routeMaxDurationSeconds * 1000).toBeLessThan(
      CHAT_JOB_POLLER_LIMITS.timeoutMs,
    )
    expect(CHAT_JOB_POLLER_LIMITS.timeoutMs).toBeLessThan(
      CHAT_RUNNER_LIMITS.stuckProcessingJobTimeoutMs,
    )
  })
})
