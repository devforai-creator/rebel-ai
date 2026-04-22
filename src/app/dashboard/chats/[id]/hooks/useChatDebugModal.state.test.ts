// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DebugInfo, DisplayMessage } from '../utils'
import { useChatDebugModal } from './useChatDebugModal'

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

describe('useChatDebugModal state transitions', () => {
  const messages: DisplayMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'hello',
    },
  ]

  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stores fetched debug info and clears stale errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        debugInfo: {
          cacheHit: true,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const debugInfoMap = { current: new Map<string, DebugInfo>() }
    const { result } = renderHook(() =>
      useChatDebugModal({
        chatId: 'chat-1',
        combinedMessages: messages,
        debugInfoMap,
      }),
    )

    await act(async () => {
      await result.current.openMessageDebug('assistant-1')
    })

    await waitFor(() => {
      expect(result.current.debugModal).toMatchObject({
        isOpen: true,
        messageId: 'assistant-1',
        debugInfo: {
          cacheHit: true,
        },
        errorMessage: null,
        mode: 'message',
      })
    })

    expect(debugInfoMap.current.get('assistant-1')).toEqual({ cacheHit: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/chats/chat-1/messages/assistant-1/debug')
  })

  it('keeps fetch failures distinct from a legitimate no-debug-info response', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createJsonResponse(
          {
            error: 'Unauthorized',
          },
          {
            status: 401,
          },
        ),
      ),
    )

    const { result } = renderHook(() =>
      useChatDebugModal({
        chatId: 'chat-1',
        combinedMessages: messages,
        debugInfoMap: { current: new Map<string, DebugInfo>() },
      }),
    )

    await act(async () => {
      await result.current.openMessageDebug('assistant-1')
    })

    await waitFor(() => {
      expect(result.current.debugModal).toMatchObject({
        isOpen: true,
        messageId: 'assistant-1',
        debugInfo: null,
        errorMessage: 'Unauthorized',
        mode: 'message',
      })
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch debug info:', 401, 'Unauthorized')
  })
})
