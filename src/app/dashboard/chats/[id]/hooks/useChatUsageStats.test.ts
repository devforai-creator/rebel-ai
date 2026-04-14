import { describe, expect, it } from 'vitest'

import { parseLatestMessageTokenStats, parseLatestUsageStatsResponse } from './useChatUsageStats'

describe('parseLatestMessageTokenStats', () => {
  it('parses valid latest-message usage payloads', () => {
    expect(
      parseLatestMessageTokenStats({
        id: 'message-1',
        createdAt: '2026-04-14T00:00:00.000Z',
        total: 100,
        prompt: 40,
        completion: 60,
        cachedPrompt: 10,
        cacheHit: true,
        cacheKey: 'cache-key',
        cacheRetention: '5m',
        costUsd: 0.1234,
        promptCostUsd: 0.01,
        completionCostUsd: 0.02,
        cachedPromptCostUsd: 0.003,
        reasoningCostUsd: 0.004,
      }),
    ).toEqual({
      id: 'message-1',
      createdAt: '2026-04-14T00:00:00.000Z',
      total: 100,
      prompt: 40,
      completion: 60,
      cachedPrompt: 10,
      cacheHit: true,
      cacheKey: 'cache-key',
      cacheRetention: '5m',
      costUsd: 0.1234,
      promptCostUsd: 0.01,
      completionCostUsd: 0.02,
      cachedPromptCostUsd: 0.003,
      reasoningCostUsd: 0.004,
    })
  })

  it('normalizes malformed fields to null/false', () => {
    expect(
      parseLatestMessageTokenStats({
        id: 123,
        total: 'bad',
        cacheHit: 'yes',
      }),
    ).toEqual({
      id: null,
      createdAt: null,
      total: null,
      prompt: null,
      completion: null,
      cachedPrompt: null,
      cacheHit: false,
      cacheKey: null,
      cacheRetention: null,
      costUsd: null,
      promptCostUsd: null,
      completionCostUsd: null,
      cachedPromptCostUsd: null,
      reasoningCostUsd: null,
    })
  })
})

describe('parseLatestUsageStatsResponse', () => {
  it('extracts the latestMessage field from stats responses', () => {
    expect(
      parseLatestUsageStatsResponse({
        latestMessage: {
          id: 'message-1',
        },
      }),
    ).toMatchObject({
      id: 'message-1',
    })
  })

  it('returns null for invalid stats responses', () => {
    expect(parseLatestUsageStatsResponse(null)).toBeNull()
    expect(parseLatestUsageStatsResponse({ latestMessage: 'bad' })).toBeNull()
  })
})
