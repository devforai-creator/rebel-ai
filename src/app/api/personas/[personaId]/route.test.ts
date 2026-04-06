import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

function buildContext(personaId: string) {
  return { params: Promise.resolve({ personaId }) }
}

function buildSupabase(options: {
  user: { id: string } | null
  personas?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      personas: {
        rows: options.personas ?? [],
        primaryKeys: ['id'],
      },
    },
  })

  Object.assign(supabase, {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: options.user }, error: null }),
    },
  })

  return supabase
}

describe('PATCH /api/personas/[personaId]', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
  })

  it('returns 401 for anonymous users', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { PATCH } = await import('./route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/personas/p-1', { method: 'PATCH' }),
      buildContext('p-1'),
    )

    expect(response.status).toBe(401)
  })

  it('returns 404 when persona does not belong to user', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: { id: 'user-1' } }))
    const { PATCH } = await import('./route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/personas/p-404', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      buildContext('p-404'),
    )

    expect(response.status).toBe(404)
  })

  it('returns 400 for invalid payload', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        personas: [{ id: 'p-1', user_id: 'user-1', name: 'Old', description: 'desc' }],
      }),
    )
    const { PATCH } = await import('./route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/personas/p-1', { method: 'PATCH', body: 'not-json' }),
      buildContext('p-1'),
    )

    expect(response.status).toBe(400)
  })

  it('returns 400 when nothing to update', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        personas: [{ id: 'p-1', user_id: 'user-1', name: 'Old', description: 'desc' }],
      }),
    )
    const { PATCH } = await import('./route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/personas/p-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      buildContext('p-1'),
    )

    expect(response.status).toBe(400)
  })

  it('updates name and normalizes description', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      personas: [{ id: 'p-1', user_id: 'user-1', name: 'Old', description: 'desc' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { PATCH } = await import('./route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/personas/p-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: '  New Name  ', description: '   ' }),
      }),
      buildContext('p-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.persona).toEqual({
      id: 'p-1',
      name: 'New Name',
      description: null,
    })
    expect(supabase.state.personas).toEqual([
      { id: 'p-1', user_id: 'user-1', name: 'New Name', description: null },
    ])
  })
})
