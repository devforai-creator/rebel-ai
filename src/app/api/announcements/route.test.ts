import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

type AnnouncementRow = {
  id: string
  message: string
  cta_label: string | null
  cta_url: string | null
  severity: string
  starts_at: string
  ends_at: string | null
  is_active: boolean
}

function buildSupabase(options: {
  user: { id: string } | null
  announcement?: AnnouncementRow | null
  fetchError?: { message: string } | null
}) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: options.announcement ?? null,
      error: options.fetchError ?? null,
    })),
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user },
        error: options.user ? null : { message: 'missing session' },
      }),
    },
    from: vi.fn((table: string) => {
      if (table !== 'announcements') {
        throw new Error(`Unexpected table ${table}`)
      }
      return builder
    }),
  }
}

describe('GET /api/announcements', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
  })

  it('returns 401 when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { GET } = await import('./route')

    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 500 when announcement lookup fails', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        fetchError: { message: 'query failed' },
      }),
    )
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = await import('./route')

    const response = await GET()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'Failed to fetch announcement' })
    consoleSpy.mockRestore()
  })

  it('returns the normalized active announcement payload', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        announcement: {
          id: 'ann-1',
          message: 'Scheduled maintenance',
          cta_label: 'Details',
          cta_url: '/status',
          severity: 'warning',
          starts_at: '2026-04-14T00:00:00.000Z',
          ends_at: null,
          is_active: true,
        },
      }),
    )
    const { GET } = await import('./route')

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      announcement: {
        id: 'ann-1',
        message: 'Scheduled maintenance',
        ctaLabel: 'Details',
        ctaUrl: '/status',
        severity: 'warning',
        startsAt: '2026-04-14T00:00:00.000Z',
        endsAt: null,
      },
    })
  })

  it('returns a null announcement when none is active', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        announcement: null,
      }),
    )
    const { GET } = await import('./route')

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ announcement: null })
  })
})
