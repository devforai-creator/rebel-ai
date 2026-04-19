// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  parseLatestMessageTokenStats,
  parseLatestUsageStatsResponse,
  useChatUsageStats,
} from './useChatUsageStats'

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

describe('useChatUsageStats', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not fetch on mount when the usage panel is disabled', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() =>
      useChatUsageStats({
        chatId: 'chat-1',
        initialUsageStats: null,
        enabled: false,
        active: false,
      }),
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fetch on mount when the panel is enabled but collapsed', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() =>
      useChatUsageStats({
        chatId: 'chat-1',
        initialUsageStats: null,
        enabled: true,
        active: false,
      }),
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches only after the panel becomes active', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latestMessage: {
          id: 'message-1',
          costUsd: 0.12,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ enabled, active }) =>
        useChatUsageStats({
          chatId: 'chat-1',
          initialUsageStats: null,
          enabled,
          active,
        }),
      {
        initialProps: {
          enabled: true,
          active: false,
        },
      },
    )

    expect(fetchMock).not.toHaveBeenCalled()

    rerender({ enabled: true, active: true })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(result.current.latestUsage).toMatchObject({
        id: 'message-1',
        costUsd: 0.12,
      })
    })
  })

  it('skips manual refreshes and realtime updates while the panel is collapsed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useChatUsageStats({
        chatId: 'chat-1',
        initialUsageStats: null,
        enabled: true,
        active: false,
      }),
    )

    await act(async () => {
      await result.current.fetchLatestUsage()
    })

    act(() => {
      result.current.handleUsageRealtime({
        eventType: 'INSERT',
        old: null,
        new: {
          role: 'assistant',
        },
      })
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
