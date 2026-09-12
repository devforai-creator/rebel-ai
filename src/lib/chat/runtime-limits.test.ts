import { describe, expect, it } from 'vitest'
import {
  CHAT_JOB_POLLER_LIMITS,
  CHAT_RUNNER_LIMITS,
  resolveChatProviderStreamTimeoutMs,
  resolveChatInputTokenLimit,
} from './runtime-limits'

describe('chat runtime limits', () => {
  it('allows a cold 200K local request while retaining cloud budgets', () => {
    expect(
      resolveChatProviderStreamTimeoutMs({ provider: 'local', modelName: 'local-rp-base' }),
    ).toBe(840_000)
    expect(resolveChatInputTokenLimit('local')).toBe(200_000)
    expect(resolveChatInputTokenLimit('openrouter')).toBe(150_000)
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

  it('keeps the existing hard cap for other provider models', () => {
    expect(
      resolveChatProviderStreamTimeoutMs({
        provider: 'openrouter',
        modelName: 'z-ai/glm-5',
      }),
    ).toBe(240_000)
  })

  it('orders the provider, route, poller, and stuck-job deadlines safely', () => {
    expect(CHAT_RUNNER_LIMITS.kimiK3ProviderStreamTimeoutMs).toBeLessThan(
      CHAT_RUNNER_LIMITS.routeMaxDurationSeconds * 1000,
    )
    expect(
      CHAT_RUNNER_LIMITS.latestJobStartMs +
        CHAT_RUNNER_LIMITS.kimiK3ProviderStreamTimeoutMs +
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
