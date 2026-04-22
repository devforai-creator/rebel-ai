// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createSupabaseClientMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => createSupabaseClientMock(),
}))

import { useChatRealtimeSubscription } from './useChatRealtimeSubscription'

describe('useChatRealtimeSubscription', () => {
  beforeEach(() => {
    createSupabaseClientMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed when session bootstrap rejects before subscription setup', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const channelMock = vi.fn()

    createSupabaseClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockRejectedValue(new Error('session bootstrap failed')),
      },
      channel: channelMock,
      removeChannel: vi.fn(),
    })

    renderHook(() =>
      useChatRealtimeSubscription({
        chatId: 'chat-1',
        onMessageChange: vi.fn(),
        onAssistantStreamEvent: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Chat realtime] Failed to initialize subscription',
        expect.any(Error),
      )
    })

    expect(channelMock).not.toHaveBeenCalled()
  })
})
