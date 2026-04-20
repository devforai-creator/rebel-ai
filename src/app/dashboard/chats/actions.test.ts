import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()
const redirectMock = vi.fn()
const revalidatePathMock = vi.fn()

const hoistedMocks = vi.hoisted(() => ({
  buildTurnGraphForMessagesMock: vi.fn(),
  fromRisuFormatMock: vi.fn(),
  getMessageCountMock: vi.fn(),
  parseRisuChatJsonMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

vi.mock('@/lib/chat/turns', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat/turns')>('@/lib/chat/turns')

  return {
    ...actual,
    buildTurnGraphForMessages: (...args: unknown[]) =>
      hoistedMocks.buildTurnGraphForMessagesMock(...args),
  }
})

vi.mock('@/lib/chat/risu-converter', () => ({
  fromRisuFormat: (...args: unknown[]) => hoistedMocks.fromRisuFormatMock(...args),
  getMessageCount: (...args: unknown[]) => hoistedMocks.getMessageCountMock(...args),
  parseRisuChatJson: (...args: unknown[]) => hoistedMocks.parseRisuChatJsonMock(...args),
}))

function buildSupabase({
  user,
  chats,
  characters,
  personas,
  turns,
  messages,
}: {
  user: { id: string } | null
  chats?: Array<Record<string, unknown>>
  characters?: Array<Record<string, unknown>>
  personas?: Array<Record<string, unknown>>
  turns?: Array<Record<string, unknown>>
  messages?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      chats: {
        rows: chats ?? [],
        primaryKeys: ['id'],
        transformInsert: (row, current) => ({
          id: `chat-${current.length + 1}`,
          ...row,
        }),
      },
      characters: {
        rows: characters ?? [],
        primaryKeys: ['id'],
      },
      personas: {
        rows: personas ?? [],
        primaryKeys: ['id'],
      },
      chat_turns: {
        rows: turns ?? [],
        primaryKeys: ['id'],
      },
      messages: {
        rows: messages ?? [],
        primaryKeys: ['id'],
      },
    },
  })

  Object.assign(supabase, {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  })

  const baseFrom = supabase.from.bind(supabase)
  supabase.from = ((table: string) => {
    if (table !== 'characters') {
      return baseFrom(table)
    }

    return {
      select() {
        let characterId: string | null = null
        let ownerId: string | null = null

        const builder = {
          eq(field: string, value: unknown) {
            if (field === 'id') {
              characterId = String(value)
            }
            return builder
          },
          or(clause: string) {
            const ownerMatch = clause.match(/^user_id\.eq\.(.+),user_id\.is\.null$/)
            ownerId = ownerMatch?.[1] ?? null
            return builder
          },
          async maybeSingle() {
            const rows = (supabase.state.characters as Array<Record<string, unknown>>).filter(
              (row) =>
                row.id === characterId &&
                (ownerId === null || row.user_id === ownerId || row.user_id === null),
            )
            const character = rows[0] ?? null

            return {
              data: character ?? null,
              error: character ? null : { code: 'PGRST116', message: 'No rows found' },
            }
          },
          async single() {
            const result = await builder.maybeSingle()
            return {
              data: result.data
                ? {
                    id: result.data.id,
                    name: result.data.name,
                  }
                : null,
              error: result.error,
            }
          },
        }

        return builder
      },
    }
  }) as typeof supabase.from

  return supabase
}

function getChatRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.chats as Array<Record<string, unknown>>
}

function getTurnRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.chatTurns as Array<Record<string, unknown>>
}

function getMessageRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.messages as Array<Record<string, unknown>>
}

describe('dashboard chats actions', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    redirectMock.mockReset()
    revalidatePathMock.mockReset()
    hoistedMocks.buildTurnGraphForMessagesMock.mockReset()
    hoistedMocks.fromRisuFormatMock.mockReset()
    hoistedMocks.getMessageCountMock.mockReset()
    hoistedMocks.parseRisuChatJsonMock.mockReset()
  })

  it('returns a login error when creating a chat without a session', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { createChat } = await import('./actions')

    await expect(
      createChat({
        characterId: 'char-1',
        personaId: null,
        greetingIndex: 0,
      }),
    ).resolves.toEqual({ error: '로그인이 필요합니다' })
  })

  it('creates a chat and starter greeting on the server for a valid persona', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characters: [
        {
          id: 'char-1',
          user_id: 'user-1',
          name: 'Guide',
          greeting_message: '안녕, {{user}}',
          metadata: null,
          archived_at: null,
        },
      ],
      personas: [
        {
          id: 'persona-1',
          user_id: 'user-1',
          name: '승엽',
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { createChat } = await import('./actions')

    await expect(
      createChat({
        characterId: 'char-1',
        personaId: 'persona-1',
        greetingIndex: 0,
      }),
    ).resolves.toEqual({ chatId: 'chat-1' })

    expect(getChatRows(supabase)).toEqual([
      expect.objectContaining({
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'char-1',
        persona_id: 'persona-1',
        title: 'Guide와의 대화',
        model_config: {
          memory: {
            mode: 'prefix_live_blocks',
            sealEveryMessages: 100,
            retainTailMessages: 4,
          },
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
              providerAllowlist: ['openai', 'anthropic', 'deepseek', 'openrouter'],
            },
          },
        },
      }),
    ])
    expect(getTurnRows(supabase)).toHaveLength(1)
    expect(getMessageRows(supabase)).toEqual([
      expect.objectContaining({
        chat_id: 'chat-1',
        user_id: 'user-1',
        role: 'assistant',
        content: '안녕, 승엽',
        message_status: MESSAGE_STATUS_COMPLETED,
      }),
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/characters/char-1')
  })

  it('creates a chat without inserting a greeting when the no-greeting option is selected', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characters: [
        {
          id: 'char-1',
          user_id: null,
          name: 'Starter',
          greeting_message: 'Hello there',
          metadata: null,
          archived_at: null,
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { createChat } = await import('./actions')

    await expect(
      createChat({
        characterId: 'char-1',
        personaId: null,
        greetingIndex: 1,
      }),
    ).resolves.toEqual({ chatId: 'chat-1' })

    expect(getChatRows(supabase)).toHaveLength(1)
    expect(getTurnRows(supabase)).toEqual([])
    expect(getMessageRows(supabase)).toEqual([])
  })

  it('returns an error when creating a chat for an unavailable character', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characters: [
        {
          id: 'char-1',
          user_id: 'user-2',
          name: 'Hidden',
          greeting_message: null,
          metadata: null,
          archived_at: null,
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { createChat } = await import('./actions')

    await expect(
      createChat({
        characterId: 'char-1',
        personaId: null,
        greetingIndex: 0,
      }),
    ).resolves.toEqual({ error: '캐릭터를 찾을 수 없습니다' })

    expect(getChatRows(supabase)).toEqual([])
  })

  it('returns login required when deleting a chat without a session', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { deleteChat } = await import('./actions')

    await expect(deleteChat('chat-1')).resolves.toEqual({ error: 'Login required' })
  })

  it('deletes an owned chat, revalidates, and skips redirect when requested', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', character_id: 'char-1', title: 'Chat' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { deleteChat } = await import('./actions')

    await expect(deleteChat('chat-1', false)).resolves.toEqual({ success: true })
    expect(getChatRows(supabase)).toEqual([])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/characters/char-1')
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('redirects after deleting an owned chat by default', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', character_id: 'char-1' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { deleteChat } = await import('./actions')

    await expect(deleteChat('chat-1')).resolves.toEqual({ success: true })
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/characters/char-1')
  })

  it('returns a validation error when imported chat data has no messages', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characters: [{ id: 'char-1', user_id: 'user-1', name: 'Scout' }],
    })
    createClientMock.mockResolvedValue(supabase)
    hoistedMocks.parseRisuChatJsonMock.mockReturnValue({ data: {} })
    hoistedMocks.getMessageCountMock.mockReturnValue(0)
    const { importChat } = await import('./actions')

    await expect(importChat('char-1', '{"data":{}}')).resolves.toEqual({
      success: false,
      error: 'No messages to import',
    })
  })

  it('returns the parser error when the imported JSON is invalid', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characters: [{ id: 'char-1', user_id: 'user-1', name: 'Scout' }],
    })
    createClientMock.mockResolvedValue(supabase)
    hoistedMocks.parseRisuChatJsonMock.mockImplementation(() => {
      throw new Error('Invalid JSON format')
    })
    const { importChat } = await import('./actions')

    await expect(importChat('char-1', '{bad json')).resolves.toEqual({
      success: false,
      error: 'Invalid JSON format',
    })
  })

  it('imports a chat, stores generated turns/messages, and revalidates the character page', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characters: [{ id: 'char-1', user_id: 'user-1', name: 'Scout' }],
    })
    createClientMock.mockResolvedValue(supabase)
    hoistedMocks.parseRisuChatJsonMock.mockReturnValue({ data: {} })
    hoistedMocks.getMessageCountMock.mockReturnValue(2)
    hoistedMocks.fromRisuFormatMock.mockReturnValue([
      {
        id: 'imported-1',
        role: 'user',
        content: 'Hello',
        created_at: '2026-04-14T00:00:00.000Z',
        model_used: null,
        prompt_tokens: null,
        completion_tokens: null,
      },
    ])
    hoistedMocks.buildTurnGraphForMessagesMock.mockReturnValue({
      turns: [{ id: 'turn-1', chat_id: 'chat-1', user_message_id: 'msg-1' }],
      messages: [{ id: 'msg-1', chat_id: 'chat-1', role: 'user', content: 'Hello' }],
    })
    const { importChat } = await import('./actions')

    await expect(importChat('char-1', '{"data":{}}', 'Imported from test')).resolves.toEqual({
      success: true,
      chatId: 'chat-1',
      messageCount: 2,
    })
    expect(getChatRows(supabase)).toEqual([
      expect.objectContaining({
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'char-1',
        title: 'Imported from test',
        model_config: {
          memory: {
            mode: 'prefix_live_blocks',
            sealEveryMessages: 100,
            retainTailMessages: 4,
          },
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
              providerAllowlist: ['openai', 'anthropic', 'deepseek', 'openrouter'],
            },
          },
        },
      }),
    ])
    expect(getTurnRows(supabase)).toEqual([
      {
        id: 'turn-1',
        chat_id: 'chat-1',
        user_message_id: 'msg-1',
      },
    ])
    expect(getMessageRows(supabase)).toEqual([
      {
        id: 'msg-1',
        chat_id: 'chat-1',
        role: 'user',
        content: 'Hello',
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/characters/char-1')
  })
})
