import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProfileQuery, mockUserSupabase, createClientMock, createAdminClientMock } = vi.hoisted(
  () => {
    const mockProfileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }

    const mockUserSupabase = {
      auth: {
        getUser: vi.fn(),
      },
      from: vi.fn(),
    }

    const createClientMock = vi.fn(async () => mockUserSupabase)
    const createAdminClientMock = vi.fn()

    return {
      mockProfileQuery,
      mockUserSupabase,
      createClientMock,
      createAdminClientMock,
    }
  },
)

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

mockUserSupabase.from.mockImplementation((table: string) => {
  if (table === 'profiles') {
    return mockProfileQuery
  }
  throw new Error(`Unexpected table: ${table}`)
})

function createToggleAdminClient() {
  const eq = vi.fn(async () => ({ error: null }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))

  return {
    from,
    update,
    eq,
  }
}

describe('announcements admin action fresh-client behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    createAdminClientMock.mockReset()
    mockProfileQuery.select.mockReturnThis()
    mockProfileQuery.eq.mockReturnThis()
    mockProfileQuery.single.mockResolvedValue({ data: { is_admin: true }, error: null })
    mockUserSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
  })

  it('does not create an admin client while importing the actions module', async () => {
    const actions = await import('@/app/dashboard/admin/announcements/actions')

    expect(actions).toHaveProperty('createAnnouncement')
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('creates a fresh admin client for each action invocation', async () => {
    const firstClient = createToggleAdminClient()
    const secondClient = createToggleAdminClient()

    createAdminClientMock.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient)

    const { toggleAnnouncementStatus } = await import('@/app/dashboard/admin/announcements/actions')

    await expect(toggleAnnouncementStatus('ann-1', false)).resolves.toEqual({ success: true })
    await expect(toggleAnnouncementStatus('ann-2', true)).resolves.toEqual({ success: true })

    expect(createAdminClientMock).toHaveBeenCalledTimes(2)
    expect(firstClient.from).toHaveBeenCalledWith('announcements')
    expect(secondClient.from).toHaveBeenCalledWith('announcements')
  })
})
