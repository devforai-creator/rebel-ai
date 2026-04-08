import { describe, expect, it } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { MESSAGE_STATUS_COMPLETED, MESSAGE_STATUS_SUPERSEDED } from './message-status'
import {
  countProjectedChatMessages,
  loadLatestProjectedAssistantMessage,
  loadLatestProjectedMessage,
  loadProjectedChatMessages,
  loadProjectedChatWindow,
} from './turns'

const chatId = 'chat-1'

function createTurnProjectionSupabase() {
  return createSupabaseMock({
    tables: {
      chat_turns: {
        rows: [
          {
            id: 'turn-1',
            chat_id: chatId,
            turn_index: 1,
            user_message_id: 'user-1',
            active_assistant_message_id: 'assistant-1b',
          },
          {
            id: 'turn-2',
            chat_id: chatId,
            turn_index: 2,
            user_message_id: 'user-2',
            active_assistant_message_id: 'assistant-2',
          },
          {
            id: 'turn-3',
            chat_id: chatId,
            turn_index: 3,
            user_message_id: 'user-3',
            active_assistant_message_id: null,
          },
        ],
      },
      messages: {
        rows: [
          {
            id: 'system-1',
            chat_id: chatId,
            role: 'system',
            content: 'Lead system',
            sequence: 1,
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'user-1',
            chat_id: chatId,
            role: 'user',
            content: 'Hello',
            sequence: 2,
            turn_id: 'turn-1',
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'assistant-1a',
            chat_id: chatId,
            role: 'assistant',
            content: 'Old reply',
            sequence: 3,
            turn_id: 'turn-1',
            variant_index: 1,
            message_status: MESSAGE_STATUS_SUPERSEDED,
          },
          {
            id: 'assistant-1b',
            chat_id: chatId,
            role: 'assistant',
            content: 'Active reply',
            sequence: 4,
            turn_id: 'turn-1',
            variant_index: 2,
            supersedes_message_id: 'assistant-1a',
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'system-2',
            chat_id: chatId,
            role: 'system',
            content: 'Between turn one and two',
            sequence: 5,
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'user-2',
            chat_id: chatId,
            role: 'user',
            content: 'Second turn',
            sequence: 6,
            turn_id: 'turn-2',
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'assistant-2',
            chat_id: chatId,
            role: 'assistant',
            content: 'Second reply',
            sequence: 7,
            turn_id: 'turn-2',
            variant_index: 1,
            message_status: MESSAGE_STATUS_COMPLETED,
            debug_info: {
              cacheHit: true,
            },
          },
          {
            id: 'system-3',
            chat_id: chatId,
            role: 'system',
            content: 'Between turn two and three',
            sequence: 8,
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'user-3',
            chat_id: chatId,
            role: 'user',
            content: 'Latest user turn',
            sequence: 9,
            turn_id: 'turn-3',
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'system-4',
            chat_id: chatId,
            role: 'system',
            content: 'Tail system',
            sequence: 10,
            message_status: MESSAGE_STATUS_COMPLETED,
          },
        ],
      },
    },
  }) as unknown as SupabaseClientType
}

describe('chat turn projections', () => {
  it('loads the latest turn window with interleaved system messages', async () => {
    const supabase = createTurnProjectionSupabase()

    const result = await loadProjectedChatWindow({
      supabase,
      chatId,
      limitTurns: 2,
    })

    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(2)
    expect(result.messages.map((message) => message.id)).toEqual([
      'user-2',
      'assistant-2',
      'system-3',
      'user-3',
      'system-4',
    ])
  })

  it('keeps leading system messages on the final history page', async () => {
    const supabase = createTurnProjectionSupabase()

    const result = await loadProjectedChatWindow({
      supabase,
      chatId,
      beforeTurnIndex: 2,
      limitTurns: 2,
    })

    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
    expect(result.messages.map((message) => message.id)).toEqual([
      'system-1',
      'user-1',
      'assistant-1b',
      'system-2',
    ])
  })

  it('loads all projected messages and projected counters from active variants only', async () => {
    const supabase = createTurnProjectionSupabase()

    const [messages, latestMessage, latestAssistant, messageCount] = await Promise.all([
      loadProjectedChatMessages({ supabase, chatId }),
      loadLatestProjectedMessage({ supabase, chatId }),
      loadLatestProjectedAssistantMessage({ supabase, chatId }),
      countProjectedChatMessages({ supabase, chatId }),
    ])

    expect(messages.map((message) => message.id)).toEqual([
      'system-1',
      'user-1',
      'assistant-1b',
      'system-2',
      'user-2',
      'assistant-2',
      'system-3',
      'user-3',
      'system-4',
    ])
    expect(latestMessage?.id).toBe('system-4')
    expect(latestAssistant?.id).toBe('assistant-2')
    expect(messageCount).toBe(9)
  })
})
