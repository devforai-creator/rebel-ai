// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createSupabaseClientMock, routerRefreshMock } = vi.hoisted(() => ({
  createSupabaseClientMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../summary-actions', () => ({
  deleteSummary: vi.fn().mockResolvedValue({ ok: true }),
  regenerateFacts: vi.fn().mockResolvedValue({ ok: true }),
  regenerateSummary: vi.fn().mockResolvedValue({ ok: true }),
  reembedFact: vi.fn().mockResolvedValue({ ok: true }),
  updateFact: vi.fn().mockResolvedValue({ ok: true }),
  updateSummary: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => createSupabaseClientMock(),
}))

import { useChatSummariesState } from './useChatSummariesState'

describe('useChatSummariesState', () => {
  beforeEach(() => {
    createSupabaseClientMock.mockReset()
    routerRefreshMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed when realtime bootstrap rejects before subscription setup', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const channelMock = vi.fn()
    const hookArgs = {
      chatId: 'chat-1',
      initialSummaries: [],
      initialFacts: [],
      totalMessages: 0,
      latestSequence: 0,
    }

    createSupabaseClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockRejectedValue(new Error('session bootstrap failed')),
      },
      channel: channelMock,
      removeChannel: vi.fn(),
    })

    renderHook(() => useChatSummariesState(hookArgs))

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Chat summaries] Failed to initialize realtime subscription',
        expect.any(Error),
      )
    })

    expect(channelMock).not.toHaveBeenCalled()
  })
})
