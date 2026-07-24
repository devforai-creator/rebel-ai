// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import type { Message } from '@/types/database.types'
import type { DebugInfo, DisplayMessage, MessageChangePayload } from '../utils'

const mocks = vi.hoisted(() => ({
  useChatHistoryMock: vi.fn(),
  combineHistoryWithLiveMessagesMock: vi.fn(),
  useQueuedChatMock: vi.fn(),
  useChatMessageActionsMock: vi.fn(),
  useChatDebugModalMock: vi.fn(),
  useChatRealtimeSubscriptionMock: vi.fn(),
}))

vi.mock('./useChatHistory', () => ({
  useChatHistory: (...args: unknown[]) => mocks.useChatHistoryMock(...args),
  combineHistoryWithLiveMessages: (...args: unknown[]) =>
    mocks.combineHistoryWithLiveMessagesMock(...args),
}))

vi.mock('./useQueuedChat', () => ({
  useQueuedChat: (...args: unknown[]) => mocks.useQueuedChatMock(...args),
}))

vi.mock('./useChatMessageActions', () => ({
  useChatMessageActions: (...args: unknown[]) => mocks.useChatMessageActionsMock(...args),
}))

vi.mock('./useChatDebugModal', () => ({
  useChatDebugModal: (...args: unknown[]) => mocks.useChatDebugModalMock(...args),
}))

vi.mock('./useChatRealtimeSubscription', () => ({
  useChatRealtimeSubscription: (...args: unknown[]) =>
    mocks.useChatRealtimeSubscriptionMock(...args),
}))

import {
  buildInitialChatMessageTrackingState,
  useChatMessageLifecycle,
} from './useChatMessageLifecycle'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    chat_id: 'chat-1',
    role: 'user',
    content: 'hello',
    created_at: '2026-04-19T00:00:00.000Z',
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

describe('useChatMessageLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useChatHistoryMock.mockReturnValue({
      historyMessages: [createMessage({ id: 'history-1', role: 'assistant', content: 'older' })],
      historyHasMore: true,
      isHistoryLoading: false,
      loadOlderMessages: vi.fn(async () => {}),
    })

    mocks.combineHistoryWithLiveMessagesMock.mockReturnValue([
      { id: 'combined-1', role: 'assistant', content: 'combined' },
    ] satisfies DisplayMessage[])

    mocks.useQueuedChatMock.mockReturnValue({
      messages: [{ id: 'live-1', role: 'user', content: 'current' }],
      setMessages: vi.fn(),
      streamingDraft: null,
      input: 'draft input',
      insertInputText: vi.fn(),
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn(),
      isLoading: false,
      error: null,
      reload: vi.fn(),
      handleRealtimeMessageChange: vi.fn(),
      handleAssistantStreamEvent: vi.fn(),
    })

    mocks.useChatMessageActionsMock.mockReturnValue({
      editingMessageId: null,
      editContent: '',
      setEditContent: vi.fn(),
      reprocessingMessageId: null,
      retranslatingMessageId: null,
      pendingDeleteMessage: null,
      deleteDialogDescription: 'delete this',
      startEdit: vi.fn(),
      cancelEdit: vi.fn(),
      saveEdit: vi.fn(),
      requestDelete: vi.fn(),
      closeDeleteDialog: vi.fn(),
      confirmDelete: vi.fn(),
      handleRegenerate: vi.fn(),
      handleReprocess: vi.fn(),
      handleRetranslate: vi.fn(),
    })

    mocks.useChatDebugModalMock.mockReturnValue({
      debugModal: { isOpen: false, messageId: null, debugInfo: undefined, mode: 'message' },
      debugMessage: null,
      openMessageDebug: vi.fn(),
      openAssetDiagnostics: vi.fn(),
      closeDebugModal: vi.fn(),
    })
  })

  it('builds initial tracking state from persisted messages and debug info', () => {
    const debugInfo = { cacheHit: true } as DebugInfo
    const trackingState = buildInitialChatMessageTrackingState([
      createMessage({ id: 'message-1', debug_info: debugInfo as Message['debug_info'] }),
      createMessage({ id: 'message-2', debug_info: null }),
    ])

    expect([...trackingState.persistedMessageIds]).toEqual(['message-1', 'message-2'])
    expect(trackingState.debugInfoMap.get('message-1')).toEqual(debugInfo)
    expect(trackingState.debugInfoMap.has('message-2')).toBe(false)
  })

  it('wires history, queue, realtime, actions, and debug state through one lifecycle hook', () => {
    const usageRealtimeSpy = vi.fn()
    const realtimeMessageSpy = vi.fn()
    const assistantStreamSpy = vi.fn()
    mocks.useQueuedChatMock.mockReturnValue({
      messages: [{ id: 'live-1', role: 'user', content: 'current' }],
      setMessages: vi.fn(),
      streamingDraft: null,
      input: 'draft input',
      insertInputText: vi.fn(),
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn(),
      isLoading: false,
      error: null,
      reload: vi.fn(),
      handleRealtimeMessageChange: realtimeMessageSpy,
      handleAssistantStreamEvent: assistantStreamSpy,
    })

    const initialMessages = [
      createMessage({
        id: 'initial-1',
        role: 'assistant',
        debug_info: { cacheHit: true } as Message['debug_info'],
      }),
    ]

    const { result } = renderHook(() =>
      useChatMessageLifecycle({
        chatId: 'chat-1',
        initialMessages,
        initialActiveJob: {
          id: 'job-restored',
          deliveryMode: 'streaming',
          regenerateAssistantMessageId: null,
        },
        initialHistoryCursor: 10,
        hasMoreHistory: true,
        selectedApiKeyId: 'key-1',
        deliveryMode: 'streaming' satisfies ChatDeliveryMode,
        alternateModels: null,
        fetchLatestUsage: vi.fn(async () => {}),
        onMessageChangeSideEffect: usageRealtimeSpy,
      }),
    )

    const historyArgs = mocks.useChatHistoryMock.mock.calls[0]?.[0] as {
      persistedMessageIds: { current: Set<string> }
      debugInfoMap: { current: Map<string, DebugInfo> }
    }
    expect(historyArgs.persistedMessageIds.current.has('initial-1')).toBe(true)
    expect(historyArgs.debugInfoMap.current.get('initial-1')).toEqual({ cacheHit: true })
    expect(mocks.useQueuedChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialActiveJob: {
          id: 'job-restored',
          deliveryMode: 'streaming',
          regenerateAssistantMessageId: null,
        },
      }),
    )

    expect(result.current.composer.input).toBe('draft input')
    expect(result.current.messageState.combinedMessages).toEqual([
      { id: 'combined-1', role: 'assistant', content: 'combined' },
    ])
    expect(result.current.history.hasMore).toBe(true)
    expect(result.current.messageState.persistedMessageIds.has('initial-1')).toBe(true)

    const realtimeArgs = mocks.useChatRealtimeSubscriptionMock.mock.calls[0]?.[0] as {
      onMessageChange: (payload: MessageChangePayload) => void
      onAssistantStreamEvent: (payload: unknown) => void
    }
    const messagePayload: MessageChangePayload = {
      eventType: 'INSERT',
      new: { id: 'assistant-2' } as Partial<Message>,
      old: null,
    }
    realtimeArgs.onMessageChange(messagePayload)
    expect(usageRealtimeSpy).toHaveBeenCalledWith(messagePayload)
    expect(realtimeMessageSpy).toHaveBeenCalledWith(messagePayload)

    const streamPayload = {
      kind: 'snapshot',
      jobId: 'job-1',
      content: 'stream',
      regenerateAssistantMessageId: null,
    }
    realtimeArgs.onAssistantStreamEvent(streamPayload)
    expect(assistantStreamSpy).toHaveBeenCalledWith(streamPayload)

    expect(mocks.useChatMessageActionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        combinedMessages: [{ id: 'combined-1', role: 'assistant', content: 'combined' }],
      }),
    )
    expect(mocks.useChatDebugModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        combinedMessages: [{ id: 'combined-1', role: 'assistant', content: 'combined' }],
      }),
    )
  })
})
