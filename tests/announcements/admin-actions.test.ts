import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

import type { Announcement } from '@/types/database.types'

const {
  revalidatePathMock,
  mockProfileQuery,
  mockUserSupabase,
  mockAdminSupabase,
  createClientMock,
  createAdminClientMock,
} = vi.hoisted(() => {
  const revalidatePathMock = vi.fn()
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

  const mockAdminSupabase = {
    from: vi.fn(),
  }

  const createClientMock = vi.fn(async () => mockUserSupabase)
  const createAdminClientMock = vi.fn(() => mockAdminSupabase)

  return {
    revalidatePathMock,
    mockProfileQuery,
    mockUserSupabase,
    mockAdminSupabase,
    createClientMock,
    createAdminClientMock,
  }
})

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
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

import {
  createAnnouncement,
  updateAnnouncement,
  toggleAnnouncementStatus,
  deleteAnnouncement,
} from '@/app/dashboard/admin/announcements/actions'

const adminUser = { id: 'user-123', email: 'admin@example.com' }

function buildAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'ann-1',
    message: 'base message',
    severity: 'info',
    cta_label: null,
    cta_url: null,
    starts_at: new Date('2025-01-01T00:00:00Z').toISOString(),
    ends_at: null,
    is_active: true,
    author_user_id: adminUser.id,
    created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2025-01-01T00:00:00Z').toISOString(),
    ...overrides,
  }
}

describe('announcements admin actions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    revalidatePathMock.mockClear()
    mockProfileQuery.select.mockReturnThis()
    mockProfileQuery.eq.mockReturnThis()
    mockProfileQuery.single.mockResolvedValue({ data: { is_admin: true }, error: null })
    mockUserSupabase.auth.getUser.mockResolvedValue({ data: { user: adminUser }, error: null })
    mockAdminSupabase.from.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects unauthenticated users', async () => {
    mockUserSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const result = await createAnnouncement({
      message: 'test',
      severity: 'info',
    })

    expect(result).toEqual({ error: '로그인이 필요합니다.' })
    expect(mockAdminSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects when profile lookup fails', async () => {
    mockProfileQuery.single.mockResolvedValue({
      data: null,
      error: { message: 'lookup failed' },
    })

    const result = await createAnnouncement({
      message: 'test',
      severity: 'info',
    })

    expect(result).toEqual({ error: '프로필 정보를 불러오지 못했습니다.' })
    expect(mockAdminSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects when the user is not an admin', async () => {
    mockProfileQuery.single.mockResolvedValue({
      data: { is_admin: false },
      error: null,
    })

    const result = await createAnnouncement({
      message: 'test',
      severity: 'info',
    })

    expect('error' in result && result.error).toBe('관리자 권한이 필요합니다.')
    expect(mockAdminSupabase.from).not.toHaveBeenCalled()
  })

  it('validates CTA URL format', async () => {
    const result = await createAnnouncement({
      message: 'Check link',
      severity: 'warning',
      ctaUrl: 'javascript:alert(1)',
    })

    expect('error' in result && result.error).toBe(
      'CTA URL은 http(s):// 혹은 / 로 시작해야 합니다.',
    )
  })

  it('validates required message for create', async () => {
    const result = await createAnnouncement({
      message: '    ',
      severity: 'info',
    })

    expect(result).toEqual({ error: '공지 내용을 입력해주세요.' })
  })

  it('rejects overlength announcement message', async () => {
    const result = await createAnnouncement({
      message: 'a'.repeat(1501),
      severity: 'info',
    })

    expect(result).toEqual({ error: '공지 내용은 1500자 이하여야 합니다.' })
  })

  it('rejects invalid severity', async () => {
    const result = await createAnnouncement({
      message: 'valid',
      severity: 'invalid' as never,
    })

    expect(result).toEqual({ error: '유효하지 않은 중요도입니다.' })
  })

  it('rejects invalid start and end date formats', async () => {
    const invalidStart = await createAnnouncement({
      message: 'test',
      severity: 'info',
      startsAt: 'not-a-date',
    })
    expect(invalidStart).toEqual({ error: '날짜 형식이 올바르지 않습니다.' })

    const invalidEnd = await createAnnouncement({
      message: 'test',
      severity: 'info',
      endsAt: 'still-not-a-date',
    })
    expect(invalidEnd).toEqual({ error: '날짜 형식이 올바르지 않습니다.' })
  })

  it('rejects when end time is earlier than start time', async () => {
    const result = await createAnnouncement({
      message: 'schedule',
      severity: 'info',
      startsAt: '2025-01-02T00:00:00Z',
      endsAt: '2025-01-01T00:00:00Z',
    })

    expect(result).toEqual({ error: '종료 시각은 시작 시각보다 이후여야 합니다.' })
  })

  it('creates announcement with trimmed payload and default schedule', async () => {
    const insertedRecord = buildAnnouncement({
      message: 'trimmed',
    })

    let capturedPayload: Record<string, unknown> | null = null

    mockAdminSupabase.from.mockImplementation(() => ({
      insert: (payload: Record<string, unknown>) => {
        capturedPayload = payload
        return {
          select: () => ({
            single: () => Promise.resolve({ data: insertedRecord, error: null }),
          }),
        }
      },
    }))

    const result = await createAnnouncement({
      message: '  trimmed ',
      severity: 'info',
      isActive: true,
    })

    expect('announcement' in result && result.announcement?.id).toBe('ann-1')
    expect(capturedPayload).toMatchObject({
      message: 'trimmed',
      severity: 'info',
      is_active: true,
      author_user_id: adminUser.id,
    })
    expect(capturedPayload?.['starts_at']).toBe('2025-01-01T00:00:00.000Z')
    expect(capturedPayload?.['ends_at']).toBeNull()
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/admin/announcements')
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard')
  })

  it('returns create error when insert fails', async () => {
    mockAdminSupabase.from.mockImplementation(() => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }),
        }),
      }),
    }))

    const result = await createAnnouncement({
      message: 'will fail',
      severity: 'info',
    })

    expect(result).toEqual({ error: '공지 생성 중 오류가 발생했습니다.' })
  })

  it('validates update message when explicitly blank', async () => {
    const result = await updateAnnouncement('ann-1', { message: '  ' })
    expect(result).toEqual({ error: '공지 내용은 비워둘 수 없습니다.' })
  })

  it('validates update start date format', async () => {
    const result = await updateAnnouncement('ann-1', { startsAt: 'not-a-date' })
    expect(result).toEqual({ error: '날짜 형식이 올바르지 않습니다.' })
  })

  it('updates announcement with normalized payload', async () => {
    const updatedRecord = buildAnnouncement({
      id: 'ann-2',
      message: 'updated',
      severity: 'critical',
      cta_label: 'Docs',
      cta_url: '/docs',
      starts_at: '2025-01-03T00:00:00.000Z',
      ends_at: null,
      is_active: false,
    })

    let capturedPayload: Record<string, unknown> | null = null
    let capturedId: string | null = null

    mockAdminSupabase.from.mockImplementation(() => ({
      update: (payload: Record<string, unknown>) => {
        capturedPayload = payload
        return {
          eq: (_field: string, value: string) => {
            capturedId = value
            return {
              select: () => ({
                single: () => Promise.resolve({ data: updatedRecord, error: null }),
              }),
            }
          },
        }
      },
    }))

    const result = await updateAnnouncement('ann-2', {
      message: '  updated ',
      severity: 'critical',
      ctaLabel: ' Docs ',
      ctaUrl: '/docs ',
      startsAt: '2025-01-03T00:00:00Z',
      endsAt: '',
      isActive: false,
    })

    expect('announcement' in result && result.announcement?.id).toBe('ann-2')
    expect(capturedId).toBe('ann-2')
    expect(capturedPayload).toMatchObject({
      message: 'updated',
      severity: 'critical',
      cta_label: 'Docs',
      cta_url: '/docs',
      starts_at: '2025-01-03T00:00:00.000Z',
      ends_at: null,
      is_active: false,
    })
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/admin/announcements')
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard')
  })

  it('returns update error when update query fails', async () => {
    mockAdminSupabase.from.mockImplementation(() => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: 'update failed' } }),
          }),
        }),
      }),
    }))

    const result = await updateAnnouncement('ann-1', { message: 'updated' })
    expect(result).toEqual({ error: '공지 수정 중 오류가 발생했습니다.' })
  })

  it('toggles announcement status and revalidates paths', async () => {
    let capturedPayload: Record<string, unknown> | null = null
    let capturedId: string | null = null

    mockAdminSupabase.from.mockImplementation(() => ({
      update: (payload: Record<string, unknown>) => {
        capturedPayload = payload
        return {
          eq: (_field: string, value: string) => {
            capturedId = value
            return Promise.resolve({ error: null })
          },
        }
      },
    }))

    const result = await toggleAnnouncementStatus('ann-5', false)

    expect(result).toEqual({ success: true })
    expect(capturedPayload).toEqual({ is_active: false })
    expect(capturedId).toBe('ann-5')
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/admin/announcements')
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard')
  })

  it('returns toggle error when update fails', async () => {
    mockAdminSupabase.from.mockImplementation(() => ({
      update: () => ({
        eq: () => Promise.resolve({ error: { message: 'toggle failed' } }),
      }),
    }))

    const result = await toggleAnnouncementStatus('ann-1', true)
    expect(result).toEqual({ error: '상태 변경 중 문제가 발생했습니다.' })
  })

  it('deletes announcement and revalidates paths', async () => {
    let capturedId: string | null = null

    mockAdminSupabase.from.mockImplementation(() => ({
      delete: () => ({
        eq: (_field: string, value: string) => {
          capturedId = value
          return Promise.resolve({ error: null })
        },
      }),
    }))

    const result = await deleteAnnouncement('ann-9')

    expect(result).toEqual({ success: true })
    expect(capturedId).toBe('ann-9')
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/admin/announcements')
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard')
  })

  it('returns delete error when query fails', async () => {
    mockAdminSupabase.from.mockImplementation(() => ({
      delete: () => ({
        eq: () => Promise.resolve({ error: { message: 'delete failed' } }),
      }),
    }))

    const result = await deleteAnnouncement('ann-1')
    expect(result).toEqual({ error: '공지 삭제 중 오류가 발생했습니다.' })
  })
})
