import { describe, expect, it } from 'vitest'
import type { Message } from '@/types/database.types'
import { MESSAGE_STATUS_COMPLETED, MESSAGE_STATUS_SUPERSEDED } from '@/lib/chat/message-status'
import type { DisplayMessage } from '../utils'
import { reconcileAssistantMessage } from './reconcile-assistant-message'

function buildAssistantMessage(
  overrides: Partial<Message> & Pick<Message, 'id' | 'content' | 'chat_id'>,
): Message {
  return {
    id: overrides.id,
    chat_id: overrides.chat_id,
    user_id: 'user-1',
    role: 'assistant',
    content: overrides.content,
    sequence: overrides.sequence ?? 2,
    model_used: null,
    prompt_tokens: null,
    completion_tokens: null,
    latency_ms: null,
    error_code: null,
    debug_info: null,
    content_en: null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    turn_id: overrides.turn_id ?? null,
    variant_index: overrides.variant_index ?? 1,
    supersedes_message_id: overrides.supersedes_message_id ?? null,
    message_status: overrides.message_status ?? MESSAGE_STATUS_COMPLETED,
  } as Message
}

describe('reconcileAssistantMessage', () => {
  it('replaces the pending regeneration target with the new assistant variant', () => {
    const prevMessages: DisplayMessage[] = [
      { id: 'user-1', role: 'user', content: 'hello', sequence: 1 },
      { id: 'assistant-old', role: 'assistant', content: 'old answer', sequence: 2 },
    ]

    const result = reconcileAssistantMessage({
      prevMessages,
      assistantMessage: buildAssistantMessage({
        id: 'assistant-new',
        chat_id: 'chat-1',
        content: 'new answer',
        sequence: 3,
        variant_index: 2,
        supersedes_message_id: 'assistant-old',
      }),
      pendingRegenerationTargetId: 'assistant-old',
    })

    expect(result.nextMessages).toEqual([
      { id: 'user-1', role: 'user', content: 'hello', sequence: 1 },
      expect.objectContaining({
        id: 'assistant-new',
        role: 'assistant',
        content: 'new answer',
        sequence: 3,
      }),
    ])
    expect(result.idsToForget).toEqual(['assistant-old'])
  })

  it('ignores hidden updates for the still-visible pending regeneration target', () => {
    const prevMessages: DisplayMessage[] = [
      { id: 'assistant-old', role: 'assistant', content: 'old answer', sequence: 2 },
    ]

    const result = reconcileAssistantMessage({
      prevMessages,
      assistantMessage: buildAssistantMessage({
        id: 'assistant-old',
        chat_id: 'chat-1',
        content: 'old answer',
        message_status: MESSAGE_STATUS_SUPERSEDED,
      }),
      pendingRegenerationTargetId: 'assistant-old',
    })

    expect(result.nextMessages).toEqual(prevMessages)
    expect(result.idsToForget).toEqual([])
  })

  it('removes hidden assistant variants once they are no longer pending', () => {
    const prevMessages: DisplayMessage[] = [
      { id: 'assistant-old', role: 'assistant', content: 'old answer', sequence: 2 },
    ]

    const result = reconcileAssistantMessage({
      prevMessages,
      assistantMessage: buildAssistantMessage({
        id: 'assistant-old',
        chat_id: 'chat-1',
        content: 'old answer',
        message_status: MESSAGE_STATUS_SUPERSEDED,
      }),
      pendingRegenerationTargetId: null,
    })

    expect(result.nextMessages).toEqual([])
    expect(result.idsToForget).toEqual(['assistant-old'])
  })

  it('forgets the pending target even when the replacement is appended', () => {
    const prevMessages: DisplayMessage[] = [
      { id: 'user-1', role: 'user', content: 'hello', sequence: 1 },
    ]

    const result = reconcileAssistantMessage({
      prevMessages,
      assistantMessage: buildAssistantMessage({
        id: 'assistant-new',
        chat_id: 'chat-1',
        content: 'new answer',
        sequence: 3,
      }),
      pendingRegenerationTargetId: 'assistant-old',
    })

    expect(result.nextMessages).toEqual([
      { id: 'user-1', role: 'user', content: 'hello', sequence: 1 },
      expect.objectContaining({
        id: 'assistant-new',
        role: 'assistant',
        content: 'new answer',
        sequence: 3,
      }),
    ])
    expect(result.idsToForget).toEqual(['assistant-old'])
  })
})
