import { describe, expect, it } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import {
  MESSAGE_STATUS_COMPLETED,
  MESSAGE_STATUS_GENERATING,
  MESSAGE_STATUS_SUPERSEDED,
} from './message-status'
import {
  ConcurrentChatTurnConflictError,
  buildTurnGraphForMessages,
  countProjectedConversationMessages,
  countProjectedChatMessages,
  createChatTurn,
  loadGenerationTranscript,
  loadLatestProjectedAssistantMessage,
  loadLatestProjectedConversationMessage,
  loadLatestProjectedMessage,
  loadProjectedChatMessages,
  loadProjectedConversationMessages,
  loadProjectedConversationRange,
  loadProjectedConversationTail,
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

function createCounterQueryShapeSupabase() {
  const chatTurnCalls: Array<{
    columns?: string
    options?: { count?: string; head?: boolean }
    filters: Array<{ method: string; field: string; value: unknown; operator?: string }>
  }> = []
  const messageCalls: Array<{
    columns?: string
    options?: { count?: string; head?: boolean }
    filters: Array<{ method: string; field: string; value: unknown; operator?: string }>
  }> = []

  const supabase = {
    from(table: string) {
      const call = {
        columns: undefined as string | undefined,
        options: undefined as { count?: string; head?: boolean } | undefined,
        filters: [] as Array<{ method: string; field: string; value: unknown; operator?: string }>,
      }

      const builder = {
        select(columns?: string, options?: { count?: string; head?: boolean }) {
          call.columns = columns
          call.options = options
          return this
        },
        eq(field: string, value: unknown) {
          call.filters.push({ method: 'eq', field, value })
          return this
        },
        neq(field: string, value: unknown) {
          call.filters.push({ method: 'neq', field, value })
          return this
        },
        not(field: string, operator: string, value: unknown) {
          call.filters.push({ method: 'not', field, operator, value })
          return this
        },
        then(onfulfilled?: (value: { data: unknown[]; error: null; count?: number }) => unknown) {
          const isUserCount = call.filters.some(
            (filter) => filter.field === 'user_message_id' && filter.method === 'not',
          )
          const isAssistantCount = call.filters.some(
            (filter) => filter.field === 'active_assistant_message_id' && filter.method === 'not',
          )
          const count = table === 'chat_turns' ? (isUserCount ? 2 : isAssistantCount ? 1 : 0) : 1
          const result = { data: [], error: null, count }
          ;(table === 'chat_turns' ? chatTurnCalls : messageCalls).push(call)
          return Promise.resolve(onfulfilled ? onfulfilled(result) : result)
        },
      }

      return builder
    },
  }

  return {
    supabase: supabase as unknown as SupabaseClientType,
    chatTurnCalls,
    messageCalls,
  }
}

function createLatestAssistantQueryShapeSupabase() {
  const chatTurnCalls: Array<{
    columns?: string
    filters: Array<{ method: string; field: string; value: unknown; operator?: string }>
    order?: { field: string; ascending: boolean }
    limit?: number
  }> = []
  const messageCalls: Array<{
    columns?: string
    ids?: unknown[]
  }> = []

  const supabase = {
    from(table: string) {
      if (table === 'chat_turns') {
        const call = {
          columns: undefined as string | undefined,
          filters: [] as Array<{
            method: string
            field: string
            value: unknown
            operator?: string
          }>,
          order: undefined as { field: string; ascending: boolean } | undefined,
          limit: undefined as number | undefined,
        }

        return {
          select(columns?: string) {
            call.columns = columns
            return this
          },
          eq(field: string, value: unknown) {
            call.filters.push({ method: 'eq', field, value })
            return this
          },
          not(field: string, operator: string, value: unknown) {
            call.filters.push({ method: 'not', field, operator, value })
            return this
          },
          order(field: string, options?: { ascending?: boolean }) {
            call.order = { field, ascending: options?.ascending ?? true }
            return this
          },
          limit(count: number) {
            call.limit = count
            return this
          },
          maybeSingle() {
            chatTurnCalls.push(call)
            return Promise.resolve({
              data: { active_assistant_message_id: 'assistant-2' },
              error: null,
            })
          },
        }
      }

      const call = {
        columns: undefined as string | undefined,
        ids: undefined as unknown[] | undefined,
      }

      return {
        select(columns?: string) {
          call.columns = columns
          return this
        },
        in(_field: string, ids: unknown[]) {
          call.ids = ids
          return this
        },
        then(
          onfulfilled?: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
        ) {
          messageCalls.push(call)
          const result = {
            data: [
              {
                id: 'assistant-2',
                role: 'assistant',
                content: 'Second reply',
                chat_id: chatId,
                user_id: 'user-1',
                sequence: 7,
                model_used: null,
                prompt_tokens: null,
                completion_tokens: null,
                latency_ms: null,
                error_code: null,
                debug_info: null,
                content_en: null,
                created_at: null,
                turn_id: 'turn-2',
                variant_index: 1,
                supersedes_message_id: null,
                message_status: MESSAGE_STATUS_COMPLETED,
              },
            ],
            error: null,
          }
          return Promise.resolve(onfulfilled ? onfulfilled(result) : result)
        },
      }
    },
  }

  return {
    supabase: supabase as unknown as SupabaseClientType,
    chatTurnCalls,
    messageCalls,
  }
}

function createChunkedTranscriptQueryShapeSupabase(turnCount = 120) {
  const turns = Array.from({ length: turnCount }, (_, index) => {
    const turnIndex = index + 1
    return {
      id: `turn-${turnIndex}`,
      chat_id: chatId,
      turn_index: turnIndex,
      user_message_id: `user-${turnIndex}`,
      active_assistant_message_id: `assistant-${turnIndex}`,
    }
  })

  const messages = turns.flatMap((turn) => [
    {
      id: turn.user_message_id,
      role: 'user',
      content: `User ${turn.turn_index}`,
      chat_id: chatId,
      sequence: turn.turn_index * 2 - 1,
      turn_id: turn.id,
      message_status: MESSAGE_STATUS_COMPLETED,
    },
    {
      id: turn.active_assistant_message_id,
      role: 'assistant',
      content: `Assistant ${turn.turn_index}`,
      chat_id: chatId,
      sequence: turn.turn_index * 2,
      turn_id: turn.id,
      variant_index: 1,
      supersedes_message_id: null,
      message_status: MESSAGE_STATUS_COMPLETED,
    },
  ])

  const messageCalls: Array<{ ids: unknown[] }> = []

  const supabase = {
    from(table: string) {
      if (table === 'chat_turns') {
        const filters: Array<{ method: string; field: string; value: unknown }> = []
        let order: { field: string; ascending: boolean } | null = null
        let limit: number | null = null
        let columns: string | undefined

        const builder = {
          select(nextColumns?: string) {
            columns = nextColumns
            return builder
          },
          eq(field: string, value: unknown) {
            filters.push({ method: 'eq', field, value })
            return builder
          },
          lte(field: string, value: unknown) {
            filters.push({ method: 'lte', field, value })
            return builder
          },
          order(field: string, options?: { ascending?: boolean }) {
            order = { field, ascending: options?.ascending ?? true }
            return builder
          },
          limit(count: number) {
            limit = count
            return builder
          },
          single() {
            const idFilter = filters.find(
              (filter) => filter.field === 'id' && filter.method === 'eq',
            )
            const row = turns.find((turn) => turn.id === idFilter?.value) ?? null

            return Promise.resolve({
              data: row,
              error: row ? null : { code: 'PGRST116', message: 'Not found' },
            })
          },
          then(
            onfulfilled?: (value: {
              data: Array<Record<string, unknown>>
              error: null
              count?: number
            }) => unknown,
          ) {
            let rows = turns.slice()

            for (const filter of filters) {
              if (filter.method === 'eq') {
                rows = rows.filter(
                  (row) => row[filter.field as keyof (typeof turns)[number]] === filter.value,
                )
              }
              if (filter.method === 'lte') {
                rows = rows.filter(
                  (row) =>
                    Number(row[filter.field as keyof (typeof turns)[number]]) <=
                    Number(filter.value),
                )
              }
            }

            if (order) {
              const currentOrder = order
              rows.sort((left, right) =>
                currentOrder.ascending
                  ? Number(left[currentOrder.field as keyof typeof left]) -
                    Number(right[currentOrder.field as keyof typeof right])
                  : Number(right[currentOrder.field as keyof typeof right]) -
                    Number(left[currentOrder.field as keyof typeof left]),
              )
            }

            if (typeof limit === 'number') {
              rows = rows.slice(0, limit)
            }

            const result = {
              data: rows.map((row) => {
                if (!columns) {
                  return row
                }

                return columns.split(',').reduce<Record<string, unknown>>((acc, column) => {
                  const key = column.trim() as keyof typeof row
                  acc[key] = row[key]
                  return acc
                }, {})
              }),
              error: null,
            }

            return Promise.resolve(onfulfilled ? onfulfilled(result) : result)
          },
        }

        return builder
      }

      const messageCall = { ids: [] as unknown[] }

      const builder = {
        select() {
          return builder
        },
        in(_field: string, ids: unknown[]) {
          messageCall.ids = ids
          return builder
        },
        then(
          onfulfilled?: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
        ) {
          messageCalls.push(messageCall)
          const idSet = new Set(messageCall.ids)
          const result = {
            data: messages.filter((message) => idSet.has(message.id)),
            error: null,
          }
          return Promise.resolve(onfulfilled ? onfulfilled(result) : result)
        },
      }

      return builder
    },
  }

  return {
    supabase: supabase as unknown as SupabaseClientType,
    messageCalls,
  }
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

    const [messages, latestMessage, latestConversationMessage, latestAssistant, messageCount] =
      await Promise.all([
        loadProjectedChatMessages({ supabase, chatId }),
        loadLatestProjectedMessage({ supabase, chatId }),
        loadLatestProjectedConversationMessage({ supabase, chatId }),
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
    expect(latestConversationMessage?.id).toBe('user-3')
    expect(latestAssistant?.id).toBe('assistant-2')
    expect(messageCount).toBe(9)
  })

  it('chunks projected conversation message id fetches for large chats', async () => {
    const { supabase, messageCalls } = createChunkedTranscriptQueryShapeSupabase(130)

    const result = await loadProjectedConversationMessages({
      supabase,
      chatId,
    })

    expect(result).toHaveLength(260)
    expect(messageCalls.length).toBe(3)
    expect(messageCalls.map((call) => call.ids.length)).toEqual([100, 100, 60])
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

  it('retries a transient turn-index race and uses the next available index', async () => {
    let latestTurnReads = 0
    let insertAttempts = 0
    const insertedTurns: Array<Record<string, unknown>> = []

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
          maybeSingle: async () => {
            latestTurnReads += 1

            if (latestTurnReads === 1) {
              return {
                data: null,
                error: { code: 'PGRST116', message: 'No rows found' },
              }
            }

            return {
              data: { turn_index: 1 },
              error: null,
            }
          },
          insert(payload: Record<string, unknown>) {
            return {
              select() {
                return {
                  single: async () => {
                    insertAttempts += 1

                    if (insertAttempts === 1) {
                      return {
                        data: null,
                        error: {
                          code: '23505',
                          message:
                            'duplicate key value violates unique constraint "chat_turns_chat_id_turn_index_key"',
                        },
                      }
                    }

                    insertedTurns.push(payload)
                    return {
                      data: { id: payload.id },
                      error: null,
                    }
                  },
                }
              },
            }
          },
        }
      },
    }

    const result = await createChatTurn({
      supabase: supabase as unknown as SupabaseClientType,
      chatId,
      userId: 'user-1',
      turnId: 'turn-race',
      userMessageId: 'user-race',
    })

    expect(result).toEqual({ turnId: 'turn-race', turnIndex: 2 })
    expect(insertAttempts).toBe(2)
    expect(insertedTurns).toContainEqual(
      expect.objectContaining({
        id: 'turn-race',
        chat_id: chatId,
        user_id: 'user-1',
        turn_index: 2,
        user_message_id: 'user-race',
      }),
    )
  })

  it('throws a conflict error when turn-index races keep colliding', async () => {
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
            data: { turn_index: 3 },
            error: null,
          }),
          insert() {
            return {
              select() {
                return {
                  single: async () => ({
                    data: null,
                    error: {
                      code: '23505',
                      message:
                        'duplicate key value violates unique constraint "chat_turns_chat_id_turn_index_key"',
                    },
                  }),
                }
              },
            }
          },
        }
      },
    }

    await expect(
      createChatTurn({
        supabase: supabase as unknown as SupabaseClientType,
        chatId,
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ConcurrentChatTurnConflictError)
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

  it('chunks transcript message id fetches for large chats', async () => {
    const { supabase, messageCalls } = createChunkedTranscriptQueryShapeSupabase(120)

    const result = await loadGenerationTranscript({
      supabase,
      chatId,
      turnId: 'turn-120',
    })

    expect(result).toHaveLength(240)
    expect(messageCalls.length).toBe(3)
    expect(messageCalls.map((call) => call.ids.length)).toEqual([100, 100, 40])
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

  it('loads the latest projected conversation tail without scanning the full transcript', async () => {
    const supabase = createTurnProjectionSupabase()

    const result = await loadProjectedConversationTail({
      supabase,
      chatId,
      limitMessages: 3,
    })

    expect(result.map((message) => message.id)).toEqual(['user-2', 'assistant-2', 'user-3'])
  })

  it('excludes the regenerated assistant from the projected conversation tail', async () => {
    const supabase = createTurnProjectionSupabase()

    const result = await loadProjectedConversationTail({
      supabase,
      chatId,
      limitMessages: 2,
      excludeAssistantForTurnId: 'turn-2',
    })

    expect(result.map((message) => message.id)).toEqual(['user-2', 'user-3'])
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

  it('uses exact count queries instead of loading all chat turn rows for counters', async () => {
    const { supabase, chatTurnCalls, messageCalls } = createCounterQueryShapeSupabase()

    const [conversationCount, projectedCount] = await Promise.all([
      countProjectedConversationMessages({ supabase, chatId }),
      countProjectedChatMessages({ supabase, chatId }),
    ])

    expect(conversationCount).toBe(3)
    expect(projectedCount).toBe(4)
    expect(chatTurnCalls).toEqual([
      expect.objectContaining({
        columns: 'id',
        options: { count: 'exact', head: true },
        filters: expect.arrayContaining([
          { method: 'eq', field: 'chat_id', value: chatId },
          { method: 'not', field: 'user_message_id', operator: 'is', value: null },
        ]),
      }),
      expect.objectContaining({
        columns: 'id',
        options: { count: 'exact', head: true },
        filters: expect.arrayContaining([
          { method: 'eq', field: 'chat_id', value: chatId },
          { method: 'not', field: 'active_assistant_message_id', operator: 'is', value: null },
        ]),
      }),
      expect.objectContaining({
        columns: 'id',
        options: { count: 'exact', head: true },
        filters: expect.arrayContaining([
          { method: 'eq', field: 'chat_id', value: chatId },
          { method: 'not', field: 'user_message_id', operator: 'is', value: null },
        ]),
      }),
      expect.objectContaining({
        columns: 'id',
        options: { count: 'exact', head: true },
        filters: expect.arrayContaining([
          { method: 'eq', field: 'chat_id', value: chatId },
          { method: 'not', field: 'active_assistant_message_id', operator: 'is', value: null },
        ]),
      }),
    ])
    expect(messageCalls).toEqual([
      expect.objectContaining({
        columns: 'id',
        options: { count: 'exact', head: true },
        filters: expect.arrayContaining([
          { method: 'eq', field: 'chat_id', value: chatId },
          { method: 'eq', field: 'role', value: 'system' },
          { method: 'neq', field: 'message_status', value: MESSAGE_STATUS_SUPERSEDED },
          { method: 'neq', field: 'message_status', value: MESSAGE_STATUS_GENERATING },
        ]),
      }),
    ])
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

  it('loads the latest assistant message from the latest assistant turn only', async () => {
    const { supabase, chatTurnCalls, messageCalls } = createLatestAssistantQueryShapeSupabase()

    const result = await loadLatestProjectedAssistantMessage({ supabase, chatId })

    expect(result?.id).toBe('assistant-2')
    expect(chatTurnCalls).toEqual([
      expect.objectContaining({
        columns: 'active_assistant_message_id',
        order: { field: 'turn_index', ascending: false },
        limit: 1,
        filters: expect.arrayContaining([
          { method: 'eq', field: 'chat_id', value: chatId },
          {
            method: 'not',
            field: 'active_assistant_message_id',
            operator: 'is',
            value: null,
          },
        ]),
      }),
    ])
    expect(messageCalls).toEqual([
      expect.objectContaining({
        ids: ['assistant-2'],
      }),
    ])
  })
})
