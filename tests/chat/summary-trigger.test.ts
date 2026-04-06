import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  triggerSummaryGeneration,
  getSummaryTriggerStats,
  __resetSummaryTriggerStatsForTest,
} from '@/lib/chat/summary-trigger'

const baseArgs = {
  origin: 'https://app.example.com',
  chatId: 'chat-1',
  userId: 'user-1',
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  apiKeyId: 'key-1',
}

const originalSummarySecret = process.env.SUMMARY_GENERATION_SECRET
const originalRetryDelay = process.env.SUMMARY_TRIGGER_RETRY_DELAY_MS
const originalMaxAttempts = process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS
const originalBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

beforeEach(() => {
  __resetSummaryTriggerStatsForTest()
  process.env.SUMMARY_GENERATION_SECRET = 'summary-secret'
  process.env.SUMMARY_TRIGGER_RETRY_DELAY_MS = '0'
})

afterEach(() => {
  // Restore original env to prevent test pollution
  if (originalSummarySecret !== undefined) {
    process.env.SUMMARY_GENERATION_SECRET = originalSummarySecret
  } else {
    delete process.env.SUMMARY_GENERATION_SECRET
  }
  if (originalRetryDelay !== undefined) {
    process.env.SUMMARY_TRIGGER_RETRY_DELAY_MS = originalRetryDelay
  } else {
    delete process.env.SUMMARY_TRIGGER_RETRY_DELAY_MS
  }
  if (originalMaxAttempts !== undefined) {
    process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS = originalMaxAttempts
  } else {
    delete process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS
  }
  if (originalBypassSecret !== undefined) {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = originalBypassSecret
  } else {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }
})

describe('triggerSummaryGeneration', () => {
  it('succeeds on first attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))

    await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const stats = getSummaryTriggerStats()
    expect(stats.totalSuccesses).toBe(1)
    expect(stats.totalFailures).toBe(0)
  })

  it('retries on server errors before succeeding', async () => {
    process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS = '2'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream failed', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const stats = getSummaryTriggerStats()
    expect(stats.totalSuccesses).toBe(1)
    expect(stats.totalFailures).toBe(1)
    expect(stats.consecutiveFailures).toBe(0)
  })

  it('records consecutive failures after exhausting retries', async () => {
    process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS = '3'
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))

    await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const stats = getSummaryTriggerStats()
    expect(stats.totalSuccesses).toBe(0)
    expect(stats.totalFailures).toBe(3)
    expect(stats.consecutiveFailures).toBe(3)
  })

  it('returns an error when summary secret is missing', async () => {
    delete process.env.SUMMARY_GENERATION_SECRET
    const fetchMock = vi.fn()

    const result = await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(result).toEqual({
      success: false,
      error: 'SUMMARY_GENERATION_SECRET not configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    const stats = getSummaryTriggerStats()
    expect(stats.totalFailures).toBe(1)
    expect(stats.consecutiveFailures).toBe(1)
  })

  it('does not retry on 4xx responses', async () => {
    process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS = '3'
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }))

    const result = await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: false,
      error: 'HTTP 400: bad request',
      attempts: 1,
    })
  })

  it('clamps invalid max attempts to 1 and returns network error for non-Error throws', async () => {
    process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS = '0'
    process.env.SUMMARY_TRIGGER_RETRY_DELAY_MS = '-50'
    const fetchMock = vi.fn().mockRejectedValue('boom')

    const result = await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: false,
      error: 'Network error',
      attempts: 1,
    })
  })

  it('caps max attempts at 5 when env is too large', async () => {
    process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS = '9'
    const fetchMock = vi.fn().mockRejectedValue(new Error('still failing'))

    const result = await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(result).toEqual({
      success: false,
      error: 'still failing',
      attempts: 5,
    })
  })

  it('adds Vercel bypass header when configured', async () => {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-secret'
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    await triggerSummaryGeneration(baseArgs, { fetchImpl: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, requestInit] = fetchMock.mock.calls[0]
    expect(requestInit?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer summary-secret',
      'x-vercel-protection-bypass': 'bypass-secret',
    })
  })
})
