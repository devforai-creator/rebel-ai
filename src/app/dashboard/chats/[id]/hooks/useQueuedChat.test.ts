// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import type { FormEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toastErrorMock, toastInfoMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: toastInfoMock,
  },
}))

import { useQueuedChat } from './useQueuedChat'
import type { DebugInfo, MessageChangePayload } from '../utils'
import type { Message } from '@/types/database.types'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    chat_id: 'chat-1',
    role: 'user',
    content: 'hello',
    created_at: '2026-04-14T00:00:00.000Z',
    user_id: 'user-1',
    model_used: null,
    prompt_tokens: null,
    completion_tokens: null,
    sequence: 1,
    is_hidden: false,
    debug_info: null as Message['debug_info'],
    message_status: 'completed',
    turn_id: null,
    variant_index: null,
    supersedes_message_id: null,
    generation_job_id: null,
    translated_content: null,
    translated_at: null,
    translated_model: null,
    summary_metadata: null,
    moderation_metadata: null,
    ...overrides,
  } as unknown as Message
}

function createHookParams(overrides: Partial<Parameters<typeof useQueuedChat>[0]> = {}) {
  return {
    chatId: 'chat-1',
    initialMessages: [createMessage()],
    historyMessages: [],
    selectedApiKeyId: '',
    fetchLatestUsage: vi.fn(async () => {}),
    debugInfoMap: { current: new Map<string, DebugInfo>() },
    persistedMessageIds: { current: new Set<string>() },
    ...overrides,
  }
}

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: vi.fn(async () => payload),
    text: vi.fn(async () => JSON.stringify(payload)),
  }
}

async function flushChatRequestStart() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function flushPendingPollCycle() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useQueuedChat', () => {
  beforeEach(() => {
    toastErrorMock.mockReset()
    toastInfoMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects reload requests for assistant messages that are not persisted yet', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useQueuedChat(createHookParams({ selectedApiKeyId: 'key-1' })),
    )

    act(() => {
      result.current.reload({
        body: {
          isRegeneration: true,
          regenerateAssistantMessageId: 'assistant-pending',
        },
      })
    })

    expect(result.current.error?.message).toBe(
      'Message not yet saved. Please try again in a moment.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removes the temporary user message and surfaces an error when no API key is selected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const initialMessages = [createMessage({ id: 'user-1', content: 'existing message' })]
    const { result } = renderHook(() =>
      useQueuedChat(
        createHookParams({
          initialMessages,
          selectedApiKeyId: '',
        }),
      ),
    )

    act(() => {
      result.current.handleInputChange({
        target: { value: '  queued hello  ' },
      } as unknown as Parameters<typeof result.current.handleInputChange>[0])
    })

    act(() => {
      result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLFormElement>)
    })

    await waitFor(() => {
      expect(result.current.error?.message).toBe('Please select an API key.')
    })

    expect(result.current.input).toBe('')
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({
      id: 'user-1',
      content: 'existing message',
    })
    expect(toastErrorMock).toHaveBeenCalledWith('Please select an API key.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops deleted assistant messages from UI state and bookkeeping refs', () => {
    const assistantDebugInfo = { cacheHit: true } as DebugInfo
    const assistantMessage = createMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'assistant reply',
      sequence: 2,
      debug_info: assistantDebugInfo as unknown as Message['debug_info'],
    })
    const debugInfoMap = {
      current: new Map<string, DebugInfo>([['assistant-1', assistantDebugInfo]]),
    }
    const persistedMessageIds = { current: new Set<string>(['assistant-1']) }

    const { result } = renderHook(() =>
      useQueuedChat(
        createHookParams({
          initialMessages: [createMessage({ id: 'user-1' }), assistantMessage],
          selectedApiKeyId: 'key-1',
          debugInfoMap,
          persistedMessageIds,
        }),
      ),
    )

    act(() => {
      result.current.handleRealtimeMessageChange({
        eventType: 'DELETE',
        old: assistantMessage,
        new: null,
      } as MessageChangePayload)
    })

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1'])
    expect(debugInfoMap.current.has('assistant-1')).toBe(false)
    expect(persistedMessageIds.current.has('assistant-1')).toBe(false)
  })

  it('preserves existing assistant content when realtime updates omit unchanged fields', () => {
    const assistantMessage = createMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'assistant reply',
      sequence: 2,
    })

    const { result } = renderHook(() =>
      useQueuedChat(
        createHookParams({
          initialMessages: [createMessage({ id: 'user-1' }), assistantMessage],
          selectedApiKeyId: 'key-1',
        }),
      ),
    )

    act(() => {
      result.current.handleRealtimeMessageChange({
        eventType: 'UPDATE',
        old: { id: 'assistant-1', role: 'assistant' },
        new: {
          id: 'assistant-1',
          role: 'assistant',
          message_status: 'completed',
        },
      } as MessageChangePayload)
    })

    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'user-1', content: 'hello' }),
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'assistant reply',
        sequence: 2,
      }),
    ])
  })

  it('skips the assistant fallback fetch when realtime already delivered the visible reply', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })

    const fetchLatestUsage = vi.fn(async () => {})
    const latestUser = createMessage({
      id: 'user-2',
      role: 'user',
      content: 'queued hello',
      sequence: 2,
    })
    const assistantMessage = createMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'assistant reply',
      sequence: 3,
    })
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url === '/api/chat') {
        return createJsonResponse({ jobId: 'job-1' })
      }
      if (url === '/api/chats/chat-1/messages/latest') {
        return createJsonResponse(latestUser)
      }
      if (url === '/api/chat/jobs/job-1') {
        return createJsonResponse({ status: 'success' })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useQueuedChat(
        createHookParams({
          initialMessages: [createMessage({ id: 'user-1', content: 'existing message' })],
          selectedApiKeyId: 'key-1',
          fetchLatestUsage,
        }),
      ),
    )

    act(() => {
      result.current.handleInputChange({
        target: { value: 'queued hello' },
      } as Parameters<typeof result.current.handleInputChange>[0])
    })

    act(() => {
      result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLFormElement>)
    })

    await flushChatRequestStart()

    act(() => {
      result.current.handleRealtimeMessageChange({
        eventType: 'INSERT',
        old: null,
        new: assistantMessage,
      } as MessageChangePayload)
    })

    await flushPendingPollCycle()

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/chat',
      '/api/chats/chat-1/messages/latest',
      '/api/chat/jobs/job-1',
    ])
    expect(fetchLatestUsage).toHaveBeenCalledOnce()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.messages.map((message) => message.id)).toContain('assistant-1')
  })

  it('keeps the latest assistant fallback fetch when realtime has not delivered the reply yet', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })

    const fetchLatestUsage = vi.fn(async () => {})
    const latestUser = createMessage({
      id: 'user-2',
      role: 'user',
      content: 'queued hello',
      sequence: 2,
    })
    const latestAssistant = createMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'assistant reply',
      sequence: 3,
    })
    let latestFetchCount = 0
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url === '/api/chat') {
        return createJsonResponse({ jobId: 'job-1' })
      }
      if (url === '/api/chats/chat-1/messages/latest') {
        latestFetchCount += 1
        return createJsonResponse(latestFetchCount === 1 ? latestUser : latestAssistant)
      }
      if (url === '/api/chat/jobs/job-1') {
        return createJsonResponse({ status: 'success' })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useQueuedChat(
        createHookParams({
          initialMessages: [createMessage({ id: 'user-1', content: 'existing message' })],
          selectedApiKeyId: 'key-1',
          fetchLatestUsage,
        }),
      ),
    )

    act(() => {
      result.current.handleInputChange({
        target: { value: 'queued hello' },
      } as Parameters<typeof result.current.handleInputChange>[0])
    })

    act(() => {
      result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLFormElement>)
    })

    await flushChatRequestStart()
    await flushPendingPollCycle()

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/chat',
      '/api/chats/chat-1/messages/latest',
      '/api/chat/jobs/job-1',
      '/api/chats/chat-1/messages/latest',
    ])
    expect(fetchLatestUsage).toHaveBeenCalledOnce()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.messages.map((message) => message.id)).toContain('assistant-1')
  })
})
