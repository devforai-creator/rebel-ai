import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

function buildContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

function buildSupabase({
  user,
  chats,
}: {
  user: { id: string } | null
  chats?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      chats: {
        rows: chats ?? [],
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

describe('POST /api/chats/[chatId]/system-prompt', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
  })

  it('returns 401 when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/system-prompt', {
        method: 'POST',
        body: JSON.stringify({ systemPrompt: 'Hello' }),
      }),
      buildContext('chat-1'),
    )

    expect(response.status).toBe(401)
  })

  it('returns 404 when chat does not exist for user', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: { id: 'user-1' } }))
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-404/system-prompt', {
        method: 'POST',
        body: JSON.stringify({ systemPrompt: 'Hello' }),
      }),
      buildContext('chat-404'),
    )

    expect(response.status).toBe(404)
  })

  it('returns 400 for invalid payload', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        chats: [{ id: 'chat-1', user_id: 'user-1', custom_system_prompt: null }],
      }),
    )
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/system-prompt', {
        method: 'POST',
        body: 'not-json',
      }),
      buildContext('chat-1'),
    )

    expect(response.status).toBe(400)
  })

  it('updates the system prompt with a trimmed value', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', custom_system_prompt: null }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/system-prompt', {
        method: 'POST',
        body: JSON.stringify({ systemPrompt: '  New Prompt  ' }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(supabase.state.chats).toEqual([
      { id: 'chat-1', user_id: 'user-1', custom_system_prompt: 'New Prompt' },
    ])
  })

  it('clears the system prompt when null is provided', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', custom_system_prompt: 'Old' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/system-prompt', {
        method: 'POST',
        body: JSON.stringify({ systemPrompt: null }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(supabase.state.chats).toEqual([
      { id: 'chat-1', user_id: 'user-1', custom_system_prompt: null },
    ])
  })

  it('returns 400 for unsupported systemPrompt types', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        chats: [{ id: 'chat-1', user_id: 'user-1', custom_system_prompt: null }],
      }),
    )
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/system-prompt', {
        method: 'POST',
        body: JSON.stringify({ systemPrompt: 123 }),
      }),
      buildContext('chat-1'),
    )

    expect(response.status).toBe(400)
  })

  it('allows template syntax in system prompt', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', custom_system_prompt: 'Old' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost/api/chats/chat-1/system-prompt', {
        method: 'POST',
        body: JSON.stringify({ systemPrompt: 'Hello {{user}}' }),
      }),
      buildContext('chat-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(supabase.state.chats).toEqual([
      { id: 'chat-1', user_id: 'user-1', custom_system_prompt: 'Hello {{user}}' },
    ])
  })
})
