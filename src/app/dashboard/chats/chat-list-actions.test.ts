import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { renameChat, setChatBookmarked } from './chat-list-actions'

const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
const chatId = '10000000-0000-4000-8000-000000000001'
function setup({ owner = 'user-1', signedIn = true } = {}) {
  const db = createSupabaseMock({
    tables: {
      chats: {
        rows: [
          {
            id: chatId,
            user_id: owner,
            character_id: 'char-1',
            title: 'Original',
            is_bookmarked: false,
          },
        ],
      },
    },
  })
  mocks.client.mockResolvedValue({
    ...db,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: signedIn ? { id: 'user-1' } : null } }),
    },
  })
  return db
}
beforeEach(() => vi.clearAllMocks())
describe('chat list actions', () => {
  it('trims a title and updates only the owned room', async () => {
    const db = setup()
    expect(await renameChat(chatId, '  본편  ')).toMatchObject({
      chat: { title: '본편', is_bookmarked: false },
    })
    expect((db.state.chats as Record<string, unknown>[])[0]).toMatchObject({
      title: '본편',
      is_bookmarked: false,
    })
    expect(mocks.revalidate).toHaveBeenCalledWith('/dashboard/characters/char-1')
    expect(mocks.revalidate).toHaveBeenCalledWith(`/dashboard/chats/${chatId}`)
    expect(mocks.revalidate).toHaveBeenCalledWith('/dashboard/chats')
  })
  it('sets bookmarks idempotently and can clear them', async () => {
    const db = setup()
    for (const value of [true, true, false]) {
      expect(await setChatBookmarked(chatId, value)).toMatchObject({
        chat: { is_bookmarked: value },
      })
    }
    expect((db.state.chats as Record<string, unknown>[])[0]).toMatchObject({
      title: 'Original',
      is_bookmarked: false,
    })
  })

  it('returns a safe error and does not revalidate after a database failure', async () => {
    const query = {
      update: () => query,
      eq: () => query,
      select: () => query,
      maybeSingle: async () => ({ data: null, error: { message: 'private database detail' } }),
    }
    mocks.client.mockResolvedValue({
      from: () => query,
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    })
    const result = await setChatBookmarked(chatId, true)
    expect(result).toHaveProperty('error')
    expect(JSON.stringify(result)).not.toContain('private database detail')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(['', '  ', 'a'.repeat(101), 'two\nlines'])(
    'rejects an invalid title %j before accessing the DB',
    async (title) => {
      setup()
      expect(await renameChat(chatId, title)).toHaveProperty('error')
      expect(mocks.client).not.toHaveBeenCalled()
    },
  )
  it('rejects invalid IDs and non-boolean bookmark state', async () => {
    expect(await setChatBookmarked('invalid', true)).toHaveProperty('error')
    expect(await setChatBookmarked(chatId, 'true' as never)).toHaveProperty('error')
    expect(await renameChat('invalid', 'Title')).toHaveProperty('error')
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it.each([renameChat, setChatBookmarked])(
    'requires authentication and denies another owner',
    async (action) => {
      const value = action === renameChat ? 'Changed' : true
      setup({ signedIn: false })
      expect(await action(chatId, value as never)).toHaveProperty('error')
      const db = setup({ owner: 'other-user' })
      expect(await action(chatId, value as never)).toHaveProperty('error')
      expect((db.state.chats as Record<string, unknown>[])[0]).toMatchObject({
        title: 'Original',
        is_bookmarked: false,
      })
      expect(mocks.revalidate).not.toHaveBeenCalled()
    },
  )
})
