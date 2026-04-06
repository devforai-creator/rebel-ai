/**
 * API Route Authentication Pattern Tests
 *
 * Verifies that API routes correctly implement authentication guards.
 * Tests focus on the authentication flow, not business logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================================
// Mock Setup
// ============================================================================

const mockUser = { id: 'test-user-id', email: 'test@example.com' }

// Mock Supabase client factory
const createMockSupabaseClient = (authenticated: boolean, user = mockUser) => {
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue(
          authenticated
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: 'No session' } },
        ),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('API Authentication Patterns', () => {
  beforeEach(() => {
    vi.resetModules()
    // Ensure test environment
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  describe('GET /api/modules', () => {
    it('returns 401 when not authenticated', async () => {
      // Mock unauthenticated client
      vi.doMock('@/lib/supabase/server', () => ({
        createClient: vi.fn().mockResolvedValue(createMockSupabaseClient(false)),
      }))

      const { GET } = await import('@/app/api/modules/route')
      const response = await GET()

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    it('returns 200 when authenticated', async () => {
      const mockClient = createMockSupabaseClient(true)
      // Mock successful module fetch
      mockClient.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: vi.fn().mockResolvedValue(mockClient),
      }))

      const { GET } = await import('@/app/api/modules/route')
      const response = await GET()

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.modules).toBeDefined()
    })

    it('queries with user_id filter', async () => {
      const mockClient = createMockSupabaseClient(true)
      const eqMock = vi.fn().mockReturnThis()

      mockClient.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: vi.fn().mockResolvedValue(mockClient),
      }))

      const { GET } = await import('@/app/api/modules/route')
      await GET()

      // Verify user_id filter was applied
      expect(eqMock).toHaveBeenCalledWith('user_id', mockUser.id)
    })
  })

  describe('DELETE /api/modules', () => {
    const createDeleteRequest = (moduleId?: string) => {
      const url = moduleId
        ? new URL(`http://localhost/api/modules?id=${moduleId}`)
        : new URL('http://localhost/api/modules')
      return new NextRequest(url, { method: 'DELETE' })
    }

    it('returns 401 when not authenticated', async () => {
      vi.doMock('@/lib/supabase/server', () => ({
        createClient: vi.fn().mockResolvedValue(createMockSupabaseClient(false)),
      }))

      const { DELETE } = await import('@/app/api/modules/route')
      const response = await DELETE(createDeleteRequest('test-id'))

      expect(response.status).toBe(401)
    })

    it('returns 400 when module ID is missing', async () => {
      vi.doMock('@/lib/supabase/server', () => ({
        createClient: vi.fn().mockResolvedValue(createMockSupabaseClient(true)),
      }))

      const { DELETE } = await import('@/app/api/modules/route')
      const response = await DELETE(createDeleteRequest()) // No ID

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Missing module ID')
    })

    it('applies user_id filter on delete', async () => {
      const mockClient = createMockSupabaseClient(true)
      const eqMock = vi.fn().mockReturnThis()

      mockClient.from = vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: eqMock.mockReturnValue({
          eq: eqMock.mockResolvedValue({ error: null }),
        }),
      })

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: vi.fn().mockResolvedValue(mockClient),
      }))

      const { DELETE } = await import('@/app/api/modules/route')
      await DELETE(createDeleteRequest('test-module-id'))

      // Verify both id and user_id filters were applied
      expect(eqMock).toHaveBeenCalledWith('id', 'test-module-id')
      expect(eqMock).toHaveBeenCalledWith('user_id', mockUser.id)
    })
  })
})

describe('Protected Route Pattern Compliance', () => {
  /**
   * This test documents the expected authentication pattern for all protected routes.
   *
   * Every protected API route MUST:
   * 1. Call `supabase.auth.getUser()` before any data access
   * 2. Return 401 if user is not authenticated
   * 3. Include `.eq('user_id', user.id)` on all data queries
   *
   * Routes that use CHAT_ADMIN_SECRET or CRON_SECRET for service-to-service auth
   * are excluded from this pattern as they use different auth mechanisms.
   */

  it('documents authentication pattern requirements', () => {
    const requiredPatterns = [
      'await supabase.auth.getUser()',
      'if (userError || !user) { return ... status: 401 }',
      ".eq('user_id', user.id)",
    ]

    // This test serves as documentation
    expect(requiredPatterns).toHaveLength(3)
  })

  it('documents service-to-service auth pattern', () => {
    const serviceAuthPatterns = [
      'CHAT_ADMIN_SECRET - For internal chat job runner',
      'CRON_SECRET - For Vercel cron triggers',
      'SUMMARY_GENERATION_SECRET - For summary generation bridge',
    ]

    // Routes using these secrets don't require user auth
    expect(serviceAuthPatterns).toHaveLength(3)
  })
})
