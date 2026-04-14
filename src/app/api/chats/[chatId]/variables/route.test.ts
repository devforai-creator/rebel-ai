import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

function buildContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

function buildSupabase({
  user,
  chats,
  variables,
}: {
  user: { id: string } | null
  chats?: Array<Record<string, unknown>>
  variables?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      chats: { rows: chats ?? [] },
      global_variables: {
        rows: variables ?? [],
        primaryKeys: ['chat_id', 'key'],
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

function buildDeleteErrorBuilder(error: { code: string; message: string }) {
  const builder = {
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: null, error }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error }),
    })),
    then: vi.fn((onfulfilled?: (value: { error: typeof error }) => unknown) =>
      Promise.resolve({ error }).then(onfulfilled),
    ),
  }

  return builder
}

describe('POST /api/chats/[chatId]/variables', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    consoleErrorSpy.mockClear()
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: {} }),
      }),
      buildContext('chat-1'),
    )

    expect(response.status).toBe(401)
  })

  it('returns 404 when chat does not exist for user', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
      }),
    )
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-404/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: {} }),
      }),
      buildContext('chat-404'),
    )

    expect(response.status).toBe(404)
  })

  it('returns 400 for invalid variable payload', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        chats: [{ id: 'chat-1', user_id: 'user-1' }],
      }),
    )
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: null }),
      }),
      buildContext('chat-1'),
    )

    expect(response.status).toBe(400)
  })

  it('accepts booleans, arrays, and nested objects as valid JSON values', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      {
        json: vi.fn().mockResolvedValue({
          variables: {
            enabled: true,
            tags: ['hero', 2, null],
            config: {
              nested: { ready: true },
              optional: undefined,
            },
          },
        }),
      } as unknown as NextRequest,
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, count: 3 })
    expect(supabase.state.globalVariables).toEqual([
      { chat_id: 'chat-1', user_id: 'user-1', key: 'enabled', value: true },
      { chat_id: 'chat-1', user_id: 'user-1', key: 'tags', value: ['hero', 2, null] },
      {
        chat_id: 'chat-1',
        user_id: 'user-1',
        key: 'config',
        value: {
          nested: { ready: true },
          optional: undefined,
        },
      },
    ])
  })

  it('returns 400 when a variable value is not valid JSON', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        chats: [{ id: 'chat-1', user_id: 'user-1' }],
      }),
    )
    const { POST } = await import('./route')

    const response = await POST(
      {
        json: vi.fn().mockResolvedValue({
          variables: {
            invalid: () => 'nope',
          },
        }),
      } as unknown as NextRequest,
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid variable value' })
  })

  it('upserts variables and removes stale keys', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      variables: [{ chat_id: 'chat-1', user_id: 'user-1', key: 'old', value: 'stale' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: { foo: 'bar', answer: 42 } }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, count: 2 })
    expect(supabase.state.globalVariables).toEqual([
      { chat_id: 'chat-1', user_id: 'user-1', key: 'foo', value: 'bar' },
      { chat_id: 'chat-1', user_id: 'user-1', key: 'answer', value: 42 },
    ])
  })

  it('returns 500 when upsert fails', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
    })
    const originalFrom = supabase.from.bind(supabase)

    supabase.from = vi.fn((table: string) => {
      const handler = originalFrom(table)
      if (table !== 'global_variables') {
        return handler
      }

      return {
        ...handler,
        upsert: vi.fn().mockResolvedValue({ error: { code: '500', message: 'boom' } }),
      }
    })

    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: { foo: 'bar' } }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to save variables' })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Variables API] Upsert failed:', {
      code: '500',
      message: 'boom',
    })
  })

  it('clears variables when none provided', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      variables: [{ chat_id: 'chat-1', user_id: 'user-1', key: 'keep', value: 'value' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: {} }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, count: 0 })
    expect(supabase.state.globalVariables).toEqual([])
  })

  it('returns 500 when clearing all variables fails', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      variables: [{ chat_id: 'chat-1', user_id: 'user-1', key: 'keep', value: 'value' }],
    })
    const deleteBuilder = buildDeleteErrorBuilder({ code: '500', message: 'clear failed' })
    const originalFrom = supabase.from.bind(supabase)

    supabase.from = vi.fn((table: string) => {
      const handler = originalFrom(table)
      if (table !== 'global_variables') {
        return handler
      }

      return {
        ...handler,
        delete: vi.fn(() => deleteBuilder),
      }
    })

    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: {} }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to save variables' })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Variables API] Failed to clear variables:', {
      code: '500',
      message: 'clear failed',
    })
  })

  it('returns 500 when stale variable cleanup fails', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      variables: [{ chat_id: 'chat-1', user_id: 'user-1', key: 'old', value: 'stale' }],
    })
    const deleteBuilder = buildDeleteErrorBuilder({ code: '500', message: 'cleanup failed' })
    const originalFrom = supabase.from.bind(supabase)

    supabase.from = vi.fn((table: string) => {
      const handler = originalFrom(table)
      if (table !== 'global_variables') {
        return handler
      }

      return {
        ...handler,
        delete: vi.fn(() => deleteBuilder),
      }
    })

    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/variables', {
        method: 'POST',
        body: JSON.stringify({ variables: { foo: 'bar' } }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to save variables' })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Variables API] Cleanup delete failed:', {
      code: '500',
      message: 'cleanup failed',
    })
  })

  it('returns 400 when the request body cannot be parsed', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        chats: [{ id: 'chat-1', user_id: 'user-1' }],
      }),
    )
    const { POST } = await import('./route')

    const response = await POST(
      {
        json: vi.fn().mockRejectedValue(new Error('bad body')),
      } as unknown as NextRequest,
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ error: 'Invalid request body' })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
