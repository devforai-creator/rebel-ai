import { describe, expect, it } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import {
  MESSAGE_STATUS_COMPLETED,
  MESSAGE_STATUS_GENERATING,
  MESSAGE_STATUS_SUPERSEDED,
} from './message-status'
import {
  buildTurnGraphForMessages,
  countProjectedConversationMessages,
  countProjectedChatMessages,
  createChatTurn,
  loadGenerationTranscript,
  loadLatestProjectedAssistantMessage,
  loadLatestProjectedMessage,
  loadProjectedChatMessages,
  loadProjectedConversationMessages,
  loadProjectedConversationRange,
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

function createTranscriptSupabase() {
  return createSupabaseMock({
    tables: {
      chat_turns: {
        rows: [
          {
            id: 'turn-1',
            chat_id: chatId,
            turn_index: 1,
            user_message_id: 'user-1',
            active_assistant_message_id: 'assistant-1',
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
            user_message_id: 'system-ignored',
            active_assistant_message_id: null,
          },
        ],
      },
      messages: {
        rows: [
          { id: 'user-1', role: 'user', content: 'Hello first' },
          { id: 'assistant-1', role: 'assistant', content: 'Reply first' },
          { id: 'user-2', role: 'user', content: 'Hello second' },
          { id: 'assistant-2', role: 'assistant', content: 'Reply second' },
          { id: 'system-ignored', role: 'system', content: 'skip me' },
        ],
      },
    },
  }) as unknown as SupabaseClientType
}

function createConversationCountSupabase() {
  return createSupabaseMock({
    tables: {
      chat_turns: {
        rows: [
          {
            id: 'turn-1',
            chat_id: chatId,
            turn_index: 1,
            user_message_id: 'user-1',
            active_assistant_message_id: 'assistant-1',
          },
          {
            id: 'turn-2',
            chat_id: chatId,
            turn_index: 2,
            user_message_id: 'user-2',
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
            content: 'visible',
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'system-2',
            chat_id: chatId,
            role: 'system',
            content: 'superseded',
            message_status: MESSAGE_STATUS_SUPERSEDED,
          },
          {
            id: 'system-3',
            chat_id: chatId,
            role: 'system',
            content: 'generating',
            message_status: MESSAGE_STATUS_GENERATING,
          },
          {
            id: 'user-1',
            chat_id: chatId,
            role: 'user',
            content: 'u1',
            sequence: 1,
          },
          {
            id: 'assistant-1',
            chat_id: chatId,
            role: 'assistant',
            content: 'a1',
            sequence: 2,
          },
          {
            id: 'user-2',
            chat_id: chatId,
            role: 'user',
            content: 'u2',
            sequence: 3,
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

describe('buildTurnGraphForMessages', () => {
  it('creates implicit assistant-only turns and supersedes previous assistant variants', () => {
    const { turns, messages } = buildTurnGraphForMessages({
      chatId,
      userId: 'user-1',
      orderedMessages: [
        { id: 'assistant-standalone', role: 'assistant', content: 'cold open' },
        { id: 'system-1', role: 'system', content: 'system note' },
        { id: 'user-1', role: 'user', content: 'hello' },
        { id: 'assistant-1a', role: 'assistant', content: 'draft one' },
        { id: 'assistant-1b', role: 'assistant', content: 'draft two' },
      ],
    })

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      chat_id: chatId,
      user_id: 'user-1',
      turn_index: 1,
      user_message_id: null,
      active_assistant_message_id: 'assistant-standalone',
    })
    expect(turns[1]).toMatchObject({
      chat_id: chatId,
      user_id: 'user-1',
      turn_index: 2,
      user_message_id: 'user-1',
      active_assistant_message_id: 'assistant-1b',
    })

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'assistant-standalone',
        turn_id: turns[0].id,
        variant_index: 1,
        supersedes_message_id: null,
        message_status: MESSAGE_STATUS_COMPLETED,
      }),
      expect.objectContaining({
        id: 'system-1',
        role: 'system',
        message_status: MESSAGE_STATUS_COMPLETED,
      }),
      expect.objectContaining({
        id: 'user-1',
        turn_id: turns[1].id,
        variant_index: null,
        supersedes_message_id: null,
      }),
      expect.objectContaining({
        id: 'assistant-1a',
        turn_id: turns[1].id,
        variant_index: 1,
        supersedes_message_id: null,
        message_status: MESSAGE_STATUS_SUPERSEDED,
      }),
      expect.objectContaining({
        id: 'assistant-1b',
        turn_id: turns[1].id,
        variant_index: 2,
        supersedes_message_id: 'assistant-1a',
        message_status: MESSAGE_STATUS_COMPLETED,
      }),
    ])
  })
})

describe('createChatTurn', () => {
  it('starts at turn 1 when the chat has no prior turns', async () => {
    const supabase = createSupabaseMock({
      tables: {
        chat_turns: {
          rows: [],
        },
      },
    })

    const result = await createChatTurn({
      supabase: supabase as unknown as SupabaseClientType,
      chatId,
      userId: 'user-1',
      turnId: 'turn-new',
      userMessageId: 'user-1',
      activeAssistantMessageId: 'assistant-1',
    })

    expect(result).toEqual({ turnId: 'turn-new', turnIndex: 1 })
    expect(supabase.state.chatTurns).toContainEqual({
      id: 'turn-new',
      chat_id: chatId,
      user_id: 'user-1',
      turn_index: 1,
      user_message_id: 'user-1',
      active_assistant_message_id: 'assistant-1',
    })
  })

  it('throws when loading the latest chat turn fails', async () => {
    const supabase = {
      from(table: string) {
        expect(table).toBe('chat_turns')
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          order() {
            return this
          },
          limit() {
            return this
          },
          maybeSingle: async () => ({
            data: null,
            error: { message: 'db down' },
          }),
        }
      },
    }

    await expect(
      createChatTurn({
        supabase: supabase as unknown as SupabaseClientType,
        chatId,
        userId: 'user-1',
      }),
    ).rejects.toThrow('Failed to load latest chat turn: db down')
  })
})

describe('loadGenerationTranscript', () => {
  it('returns ordered transcript content and can exclude the current assistant response', async () => {
    const supabase = createTranscriptSupabase()

    const result = await loadGenerationTranscript({
      supabase,
      chatId,
      turnId: 'turn-2',
      excludeAssistantForTurnId: 'turn-2',
    })

    expect(result).toEqual([
      { role: 'user', content: 'Hello first', messageId: 'user-1' },
      { role: 'assistant', content: 'Reply first', messageId: 'assistant-1' },
      { role: 'user', content: 'Hello second', messageId: 'user-2' },
    ])
  })

  it('filters out non-conversation roles from the transcript', async () => {
    const supabase = createTranscriptSupabase()

    const result = await loadGenerationTranscript({
      supabase,
      chatId,
      turnId: 'turn-3',
    })

    expect(result).toEqual([
      { role: 'user', content: 'Hello first', messageId: 'user-1' },
      { role: 'assistant', content: 'Reply first', messageId: 'assistant-1' },
      { role: 'user', content: 'Hello second', messageId: 'user-2' },
      { role: 'assistant', content: 'Reply second', messageId: 'assistant-2' },
    ])
  })
})

describe('projected conversation helpers', () => {
  it('loads projected conversation messages without standalone system rows', async () => {
    const supabase = createTurnProjectionSupabase()

    const result = await loadProjectedConversationMessages({
      supabase,
      chatId,
    })

    expect(result.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1b',
      'user-2',
      'assistant-2',
      'user-3',
    ])
  })

  it('slices projected conversation ranges using 1-based ordinals', async () => {
    const supabase = createTurnProjectionSupabase()

    const result = await loadProjectedConversationRange({
      supabase,
      chatId,
      startOrdinal: 0,
      endOrdinal: 2,
    })

    expect(result.map((message) => message.id)).toEqual(['user-1', 'assistant-1b'])
  })

  it('counts conversation and visible system messages separately', async () => {
    const supabase = createConversationCountSupabase()

    const [conversationCount, projectedCount] = await Promise.all([
      countProjectedConversationMessages({ supabase, chatId }),
      countProjectedChatMessages({ supabase, chatId }),
    ])

    expect(conversationCount).toBe(3)
    expect(projectedCount).toBe(4)
  })

  it('returns null when the latest turn has no active assistant message', async () => {
    const supabase = createSupabaseMock({
      tables: {
        chat_turns: {
          rows: [
            {
              id: 'turn-1',
              chat_id: chatId,
              turn_index: 1,
              user_message_id: 'user-1',
              active_assistant_message_id: null,
            },
          ],
        },
        messages: {
          rows: [{ id: 'user-1', chat_id: chatId, role: 'user', content: 'hello' }],
        },
      },
    }) as unknown as SupabaseClientType

    await expect(loadLatestProjectedAssistantMessage({ supabase, chatId })).resolves.toBeNull()
  })
})
