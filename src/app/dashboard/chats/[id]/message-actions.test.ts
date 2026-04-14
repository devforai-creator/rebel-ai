import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

function buildSupabase({
  user,
  messages,
  turns,
}: {
  user: { id: string } | null
  messages?: Array<Record<string, unknown>>
  turns?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      messages: {
        rows: messages ?? [],
        primaryKeys: ['id'],
      },
      chat_turns: {
        rows: turns ?? [],
        primaryKeys: ['id'],
      },
    },
  })

  Object.assign(supabase, {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  })

  return supabase
}

function getMessageRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.messages as Array<Record<string, unknown>>
}

function getTurnRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.chatTurns as Array<Record<string, unknown>>
}

describe('message actions', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('returns unauthorized when editing without a session', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { editMessage } = await import('./message-actions')

    await expect(editMessage('msg-1', 'hello')).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('trims and saves edited content for an owned message', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      messages: [
        {
          id: 'msg-1',
          chat_id: 'chat-1',
          role: 'assistant',
          turn_id: null,
          content: 'old',
          chats: { user_id: 'user-1' },
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { editMessage } = await import('./message-actions')

    await expect(editMessage('msg-1', '  updated content  ')).resolves.toEqual({ success: true })
    expect(getMessageRows(supabase)).toEqual([
      {
        id: 'msg-1',
        chat_id: 'chat-1',
        role: 'assistant',
        turn_id: null,
        content: 'updated content',
        chats: { user_id: 'user-1' },
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })

  it('returns unauthorized when deleting a message owned by another user', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      messages: [
        {
          id: 'msg-1',
          chat_id: 'chat-1',
          role: 'assistant',
          turn_id: null,
          chats: { user_id: 'user-2' },
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { deleteMessage } = await import('./message-actions')

    await expect(deleteMessage('msg-1')).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('clears the active assistant pointer before deleting the latest assistant message', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      messages: [
        {
          id: 'msg-1',
          chat_id: 'chat-1',
          role: 'assistant',
          turn_id: 'turn-1',
          chats: { user_id: 'user-1' },
        },
      ],
      turns: [
        {
          id: 'turn-1',
          active_assistant_message_id: 'msg-1',
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { deleteMessage } = await import('./message-actions')

    await expect(deleteMessage('msg-1')).resolves.toEqual({
      success: true,
      chatId: 'chat-1',
    })
    expect(getMessageRows(supabase)).toEqual([])
    expect(getTurnRows(supabase)).toEqual([
      {
        id: 'turn-1',
        active_assistant_message_id: null,
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })

  it('deletes the owning turn when deleting a user message', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      messages: [
        {
          id: 'msg-1',
          chat_id: 'chat-1',
          role: 'user',
          turn_id: 'turn-1',
          chats: { user_id: 'user-1' },
        },
      ],
      turns: [
        {
          id: 'turn-1',
          active_assistant_message_id: null,
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { deleteMessage } = await import('./message-actions')

    await expect(deleteMessage('msg-1')).resolves.toEqual({
      success: true,
      chatId: 'chat-1',
    })
    expect(getTurnRows(supabase)).toEqual([])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })
})
