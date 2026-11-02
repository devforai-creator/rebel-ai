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

  it('subscribes to a private stream channel and cleans it up', async () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test' } } }),
      },
      channel: vi.fn().mockReturnValue(channel),
      removeChannel: vi.fn(),
    }
    createSupabaseClientMock.mockReturnValue(client)
    const { unmount } = renderHook(() =>
      useChatRealtimeSubscription({
        chatId: 'chat-1',
        onMessageChange: vi.fn(),
        onAssistantStreamEvent: vi.fn(),
      }),
    )
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled())
    expect(client.channel).toHaveBeenCalledWith('chat-chat-1', {
      config: {
        private: true,
        broadcast: { self: true },
        presence: { key: 'token-stats-chat-1' },
      },
    })
    unmount()
    expect(client.removeChannel).toHaveBeenCalledWith(channel)
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
