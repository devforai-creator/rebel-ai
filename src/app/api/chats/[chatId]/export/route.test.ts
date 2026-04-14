import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

function buildSupabase(options: {
  user: { id: string } | null
  chats?: Array<Record<string, unknown>>
  messages?: Array<Record<string, unknown>>
  turns?: Array<Record<string, unknown>>
  summaries?: Array<Record<string, unknown>>
  facts?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      chats: {
        rows: options.chats ?? [],
      },
      messages: {
        rows: options.messages ?? [],
      },
      chat_turns: {
        rows: options.turns ?? buildTurns(options.messages ?? []),
      },
      chat_summaries: {
        rows: options.summaries ?? [],
      },
      chat_facts: {
        rows: options.facts ?? [],
      },
    },
  })

  Object.assign(supabase, {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user },
        error: null,
      }),
    },
  })

  return supabase
}

function buildContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

function buildTurns(messages: Array<Record<string, unknown>>) {
  const ordered = [...messages]
    .filter((message) => message.chat_id && typeof message.sequence === 'number')
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))

  const turns: Array<Record<string, unknown>> = []
  let currentTurn: Record<string, unknown> | null = null
  let turnIndex = 0

  for (const message of ordered) {
    if (message.role === 'system') {
      continue
    }

    if (message.role === 'user') {
      turnIndex += 1
      currentTurn = {
        id: `turn-${turnIndex}`,
        chat_id: message.chat_id,
        turn_index: turnIndex,
        user_message_id: message.id,
        active_assistant_message_id: null,
      }
      turns.push(currentTurn)
      continue
    }

    if (!currentTurn || currentTurn.active_assistant_message_id) {
      turnIndex += 1
      currentTurn = {
        id: `turn-${turnIndex}`,
        chat_id: message.chat_id,
        turn_index: turnIndex,
        user_message_id: null,
        active_assistant_message_id: null,
      }
      turns.push(currentTurn)
    }

    currentTurn.active_assistant_message_id = message.id
  }

  return turns
}

function buildMessages(count: number, chatId: string) {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1
    return {
      id: `msg-${sequence}`,
      chat_id: chatId,
      role: sequence % 2 === 0 ? 'assistant' : 'user',
      content: `message-${sequence}`,
      sequence,
      created_at: `2025-01-${String((sequence % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    }
  })
}

describe('GET /api/chats/[chatId]/export', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
  })

  it('returns 401 when user is not authenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/chat-1/export'),
      buildContext('chat-1'),
    )

    expect(response.status).toBe(401)
  })

  it('returns 404 when chat is missing or not owned', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/chat-404/export'),
      buildContext('chat-404'),
    )

    expect(response.status).toBe(404)
  })

  it('returns 500 when message query fails', async () => {
    const chatId = 'chat-err'
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [
        {
          id: chatId,
          user_id: 'user-1',
          title: 'Failure Chat',
          character_id: 'char-1',
          characters: { name: 'Hero' },
        },
      ],
    })

    const originalFrom = supabase.from.bind(supabase)
    supabase.from = ((table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            in: async () => ({
              data: null,
              error: { message: 'message query failed' },
            }),
            eq() {
              return this
            },
            neq() {
              return this
            },
            gte() {
              return this
            },
            lt() {
              return this
            },
            order: async () => ({
              data: null,
              error: { message: 'message query failed' },
            }),
          }),
        } as unknown as ReturnType<typeof supabase.from>
      }
      return originalFrom(table)
    }) as typeof supabase.from

    createClientMock.mockResolvedValue(supabase)
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/chat-err/export'),
      buildContext(chatId),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch messages' })
  })

  it('returns 500 when the chat payload shape is invalid', async () => {
    const chatId = 'chat-invalid'
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        chats: [
          {
            id: chatId,
            user_id: 'user-1',
            title: 'Broken Chat',
            character_id: 'char-1',
            characters: null,
          },
        ],
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/chat-invalid/export'),
      buildContext(chatId),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to load chat metadata' })
  })

  it('exports chat data with summaries and facts', async () => {
    const chatId = 'chat-1'
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        chats: [
          {
            id: chatId,
            user_id: 'user-1',
            title: 'Quest',
            character_id: 'char-1',
            characters: { name: 'Hero' },
          },
        ],
        messages: [
          {
            id: 'msg-2',
            chat_id: chatId,
            role: 'assistant',
            content: 'Reply',
            sequence: 2,
            model_used: 'gpt-4o',
            prompt_tokens: 10,
            completion_tokens: 5,
            created_at: '2025-01-02T00:00:00Z',
          },
          {
            id: 'msg-1',
            chat_id: chatId,
            role: 'user',
            content: 'Hi',
            sequence: 1,
            created_at: '2025-01-01T00:00:00Z',
          },
          { id: 'msg-3', chat_id: chatId, role: 'system', content: 'ignored', sequence: 3 },
        ],
        summaries: [
          {
            chat_id: chatId,
            level: 1,
            start_seq: 1,
            end_seq: 2,
            summary: 'Short summary',
            token_count: 123,
            created_at: '2025-01-02T00:00:00Z',
          },
        ],
        facts: [
          {
            chat_id: chatId,
            start_seq: 1,
            end_seq: 2,
            facts: ['fact-1'],
            created_at: '2025-01-02T00:00:00Z',
          },
        ],
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/chat-1/export'),
      buildContext(chatId),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toContain('Hero_Quest')

    expect(body.type).toBe('risuChat')
    expect(body.data.name).toBe('Quest')
    expect(body.data.message).toHaveLength(2)
    expect(body.data.message.map((msg: { data: string }) => msg.data)).toEqual(['Hi', 'Reply'])
    expect(body.data.message.map((msg: { role: string }) => msg.role)).toEqual(['user', 'char'])

    expect(body.data._rebelai).toBeTruthy()
    expect(body.data._rebelai.summaries).toEqual([
      {
        level: 1,
        start_seq: 1,
        end_seq: 2,
        summary: 'Short summary',
        token_count: 123,
        created_at: '2025-01-02T00:00:00Z',
      },
    ])
    expect(body.data._rebelai.facts).toEqual([
      {
        start_seq: 1,
        end_seq: 2,
        facts: ['fact-1'],
        created_at: '2025-01-02T00:00:00Z',
      },
    ])
  })

  it('exports a large projected transcript and null summary/fact payloads', async () => {
    const chatId = 'chat-paged'
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [
        {
          id: chatId,
          user_id: 'user-1',
          title: null,
          character_id: 'char-1',
          characters: { name: 'Hero' },
        },
      ],
      messages: buildMessages(1000, chatId),
    })

    const originalFrom = supabase.from.bind(supabase)
    supabase.from = ((table: string) => {
      if (table === 'chat_summaries') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: null, error: null }),
            }),
          }),
        } as unknown as ReturnType<typeof supabase.from>
      }

      if (table === 'chat_facts') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: null, error: null }),
            }),
          }),
        } as unknown as ReturnType<typeof supabase.from>
      }

      return originalFrom(table)
    }) as typeof supabase.from

    createClientMock.mockResolvedValue(supabase)
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/chat-paged/export'),
      buildContext(chatId),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.type).toBe('risuChat')
    expect(body.data.message).toHaveLength(1000)
    expect(body.data.name).toBe('Hero')
    expect(response.headers.get('content-disposition')).toContain('Hero_')
    expect(body.data._rebelai).toBeUndefined()
  })
})
