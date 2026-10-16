// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseLatestMessageTokenStats,
  parseLatestUsageStatsResponse,
  useChatUsageStats,
} from './useChatUsageStats'

const response = (id: string, costUsd = 0.12) => ({
  ok: true,
  json: async () => ({ latestMessage: { id, costUsd } }),
})
const options = { chatId: 'chat-1', enabled: true, initialUsageStats: null }

describe('usage stats payloads', () => {
  it('retains DeepSeek pricing metadata without borrowing missing values', () => {
    expect(
      parseLatestMessageTokenStats({
        provider: 'deepseek',
        pricingPeriod: 'mixed',
        billingModels: ['deepseek-flash'],
      }),
    ).toMatchObject({ pricingPeriod: 'mixed', billingModels: ['deepseek-flash'] })
    expect(
      parseLatestMessageTokenStats({
        provider: 'deepseek',
        pricingPeriod: 'bad',
        billingModels: [1],
      }),
    ).toMatchObject({ pricingPeriod: null, billingModels: null })
  })
  it('preserves Google thinking tokens and the actual service tier without inventing missing counts', () => {
    expect(
      parseLatestMessageTokenStats({
        provider: 'google',
        reasoning: 600,
        serviceTier: 'mixed',
        total: 21300,
      }),
    ).toMatchObject({ reasoning: 600, serviceTier: 'mixed', total: 21300 })
    expect(
      parseLatestMessageTokenStats({ provider: 'google', serviceTier: 'invalid' }),
    ).toMatchObject({ reasoning: null, serviceTier: null, costUsd: null })
  })
  it('preserves Anthropic read/write categories and the API call count', () => {
    expect(
      parseLatestMessageTokenStats({
        id: 'answer',
        provider: 'anthropic',
        modelName: 'claude-opus-4-7',
        callCount: 2,
        prompt: 142244,
        uncachedPrompt: 32691,
        completion: 4128,
        cachedPrompt: 106687,
        cacheWrite5m: 0,
        cacheWrite1h: 2866,
        cacheWrite5mCostUsd: 0,
        cacheWrite1hCostUsd: 0.02866,
        cacheHit: true,
        usageBreakdownAvailable: true,
        costUsd: 0.3486585,
      }),
    ).toMatchObject({
      provider: 'anthropic',
      callCount: 2,
      prompt: 142244,
      uncachedPrompt: 32691,
      cachedPrompt: 106687,
      cacheWrite1h: 2866,
      cacheWrite1hCostUsd: 0.02866,
      usageBreakdownAvailable: true,
    })
  })
  it('does not turn missing or malformed values into zero', () => {
    expect(
      parseLatestMessageTokenStats({ id: 3, costUsd: 'bad', cacheWrite1h: Infinity }),
    ).toMatchObject({ id: null, costUsd: null, cacheWrite1h: null, cacheHit: false })
    expect(parseLatestUsageStatsResponse(null)).toBeNull()
    expect(parseLatestUsageStatsResponse({ latestMessage: 'bad' })).toBeNull()
    expect(parseLatestUsageStatsResponse({ latestMessage: { id: 'answer' } })?.id).toBe('answer')
  })
})

describe('useChatUsageStats', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('does not fetch while stats are disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useChatUsageStats({ ...options, enabled: false }))
    await act(async () => result.current.fetchLatestUsage())
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('loads the small price display on mount without needing an expanded panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('answer-1')))
    const { result } = renderHook(() => useChatUsageStats(options))
    await waitFor(() => expect(result.current.latestUsage?.costUsd).toBe(0.12))
  })
  it('refreshes after a completed answer even while details are collapsed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('answer-1', 0.1))
      .mockResolvedValueOnce(response('answer-2', 0.2))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useChatUsageStats(options))
    await waitFor(() => expect(result.current.latestUsage?.id).toBe('answer-1'))
    act(() =>
      result.current.handleUsageRealtime({
        eventType: 'UPDATE',
        old: { role: 'assistant', message_status: 'generating' },
        new: { role: 'assistant', message_status: 'completed' },
      }),
    )
    await waitFor(() => expect(result.current.latestUsage?.costUsd).toBe(0.2))
  })
  it('refreshes after deleting the last answer and supports manual job-completion refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('answer-2'))
      .mockResolvedValueOnce(response('answer-1'))
      .mockResolvedValueOnce(response('answer-3'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useChatUsageStats(options))
    await waitFor(() => expect(result.current.latestUsage?.id).toBe('answer-2'))
    act(() =>
      result.current.handleUsageRealtime({
        eventType: 'DELETE',
        old: { id: 'answer-2' },
        new: null,
      }),
    )
    await waitFor(() => expect(result.current.latestUsage?.id).toBe('answer-1'))
    await act(async () => result.current.fetchLatestUsage())
    expect(result.current.latestUsage?.id).toBe('answer-3')
  })
  it('stops refreshing when the setting is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('answer'))
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(
      ({ enabled }) => useChatUsageStats({ ...options, enabled }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current.latestUsage?.id).toBe('answer'))
    rerender({ enabled: false })
    await act(async () => result.current.fetchLatestUsage())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.latestUsage).toBeNull()
  })
  it('ignores a slower older response arriving after a newer refresh', async () => {
    let resolveOld!: (v: ReturnType<typeof response>) => void
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce(response('new-answer', 0.4))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useChatUsageStats(options))
    await act(async () => result.current.fetchLatestUsage())
    await act(async () => resolveOld(response('old-answer', 0.1)))
    expect(result.current.latestUsage?.id).toBe('new-answer')
    expect(result.current.latestUsage?.costUsd).toBe(0.4)
  })
  it('does not show a previous chat response after navigating to another chat', async () => {
    let resolveOld!: (v: ReturnType<typeof response>) => void
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve
            }),
        )
        .mockResolvedValueOnce(response('chat-2-answer')),
    )
    const { result, rerender } = renderHook(
      ({ chatId }) => useChatUsageStats({ ...options, chatId }),
      { initialProps: { chatId: 'chat-1' } },
    )
    rerender({ chatId: 'chat-2' })
    await waitFor(() => expect(result.current.latestUsage?.id).toBe('chat-2-answer'))
    await act(async () => resolveOld(response('chat-1-answer')))
    expect(result.current.latestUsage?.id).toBe('chat-2-answer')
  })
  it('logs parsed API errors without replacing the displayed usage', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
        ),
    )
    renderHook(() => useChatUsageStats(options))
    await waitFor(() =>
      expect(log).toHaveBeenCalledWith('Failed to load chat usage stats', 'Unauthorized'),
    )
  })
})
