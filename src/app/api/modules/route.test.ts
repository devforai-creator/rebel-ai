import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

function buildSupabase(options: {
  user: { id: string } | null
  modules?: Array<Record<string, unknown>>
  moduleAssets?: Array<Record<string, unknown>>
  storageRemoveError?: { message: string } | null
}) {
  const supabase = createSupabaseMock({
    tables: {
      modules: {
        rows: options.modules ?? [],
      },
      module_assets: {
        rows: options.moduleAssets ?? [],
      },
    },
  })

  Object.assign(supabase, {
    state: {
      ...supabase.state,
      storageRemoveCalls: [] as Array<{ bucket: string; paths: string[] }>,
    },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: options.user }, error: null }),
    },
    storage: {
      from: vi.fn((bucket: string) => ({
        remove: vi.fn((paths: string[]) => {
          ;(
            supabase.state.storageRemoveCalls as Array<{
              bucket: string
              paths: string[]
            }>
          ).push({ bucket, paths })
          return Promise.resolve({ data: [], error: options.storageRemoveError ?? null })
        }),
      })),
    },
  })

  return supabase
}

describe('/api/modules', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      createClientMock.mockResolvedValue(buildSupabase({ user: null }))
      const { GET } = await import('./route')

      const response = await GET()

      expect(response.status).toBe(401)
    })

    it('returns 500 when fetch fails', async () => {
      const supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
        },
        from: (table: string) => {
          if (table !== 'modules') throw new Error(`Unexpected table ${table}`)
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: null,
                  error: { message: 'fail' },
                }),
              }),
            }),
          }
        },
      }
      createClientMock.mockResolvedValue(supabase)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { GET } = await import('./route')

      const response = await GET()

      expect(response.status).toBe(500)
      consoleSpy.mockRestore()
    })

    it('returns modules with counts for authenticated user', async () => {
      const supabase = buildSupabase({
        user: { id: 'user-1' },
        modules: [
          {
            id: 'mod-1',
            user_id: 'user-1',
            name: 'Alpha',
            lorebook: [{ id: 1 }],
            regex: [],
            assets: ['a1'],
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
          {
            id: 'mod-2',
            user_id: 'user-1',
            name: 'Beta',
            lorebook: [],
            regex: ['r'],
            assets: [],
            created_at: '2025-02-01T00:00:00Z',
            updated_at: '2025-02-01T00:00:00Z',
          },
        ],
      })
      createClientMock.mockResolvedValue(supabase)
      const { GET } = await import('./route')

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.modules).toHaveLength(2)
      expect(body.modules[0].id).toBe('mod-2') // ordered desc by created_at
      expect(body.modules[0].counts).toEqual({
        lorebook: 0,
        regex: 1,
        assets: 0,
      })
      expect(body.modules[1].counts).toEqual({
        lorebook: 1,
        regex: 0,
        assets: 1,
      })
    })
  })

  describe('DELETE', () => {
    it('returns 401 when unauthenticated', async () => {
      createClientMock.mockResolvedValue(buildSupabase({ user: null }))
      const { DELETE } = await import('./route')

      const response = await DELETE(
        new NextRequest('http://localhost/api/modules?id=mod-1', { method: 'DELETE' }),
      )

      expect(response.status).toBe(401)
    })

    it('returns 400 when module id missing', async () => {
      createClientMock.mockResolvedValue(buildSupabase({ user: { id: 'user-1' } }))
      const { DELETE } = await import('./route')

      const response = await DELETE(
        new NextRequest('http://localhost/api/modules', { method: 'DELETE' }),
      )

      expect(response.status).toBe(400)
    })

    it('deletes module for owner', async () => {
      const supabase = buildSupabase({
        user: { id: 'user-1' },
        modules: [{ id: 'mod-1', user_id: 'user-1' }],
      })
      createClientMock.mockResolvedValue(supabase)
      const { DELETE } = await import('./route')

      const response = await DELETE(
        new NextRequest('http://localhost/api/modules?id=mod-1', { method: 'DELETE' }),
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(supabase.state.modules).toEqual([])
    })

    it('removes module-assets storage after deleting the module', async () => {
      const supabase = buildSupabase({
        user: { id: 'user-1' },
        modules: [{ id: 'mod-1', user_id: 'user-1' }],
        moduleAssets: [
          {
            id: 'asset-1',
            module_id: 'mod-1',
            user_id: 'user-1',
            storage_path: 'user-1/mod-1/bg.webp',
          },
          {
            id: 'asset-2',
            module_id: 'mod-1',
            user_id: 'user-1',
            storage_path: 'user-1/mod-1/pose.png',
          },
        ],
      })
      createClientMock.mockResolvedValue(supabase)
      const { DELETE } = await import('./route')

      const response = await DELETE(
        new NextRequest('http://localhost/api/modules?id=mod-1', { method: 'DELETE' }),
      )

      expect(response.status).toBe(200)
      expect(supabase.state.storageRemoveCalls).toEqual([
        {
          bucket: 'module-assets',
          paths: ['user-1/mod-1/bg.webp', 'user-1/mod-1/pose.png'],
        },
      ])
    })

    it('returns success with a warning when module asset cleanup fails after delete', async () => {
      const supabase = buildSupabase({
        user: { id: 'user-1' },
        modules: [{ id: 'mod-1', user_id: 'user-1' }],
        moduleAssets: [
          {
            id: 'asset-1',
            module_id: 'mod-1',
            user_id: 'user-1',
            storage_path: 'user-1/mod-1/bg.webp',
          },
        ],
        storageRemoveError: { message: 'storage remove failed' },
      })
      createClientMock.mockResolvedValue(supabase)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { DELETE } = await import('./route')

      const response = await DELETE(
        new NextRequest('http://localhost/api/modules?id=mod-1', { method: 'DELETE' }),
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        success: true,
        warning:
          'Module deleted, but some asset cleanup failed. The storage janitor can remove leftovers.',
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Modules API] Module deleted but storage cleanup failed:',
        expect.objectContaining({
          moduleId: 'mod-1',
          userId: 'user-1',
        }),
      )
      consoleSpy.mockRestore()
    })

    it('returns 500 when delete fails', async () => {
      const supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
        },
        from: (table: string) => {
          if (table !== 'modules') throw new Error(`Unexpected table ${table}`)
          return {
            delete: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: { message: 'fail' } }),
              }),
            }),
          }
        },
      }
      createClientMock.mockResolvedValue(supabase)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { DELETE } = await import('./route')

      const response = await DELETE(
        new NextRequest('http://localhost/api/modules?id=mod-1', { method: 'DELETE' }),
      )

      expect(response.status).toBe(500)
      consoleSpy.mockRestore()
    })
  })
})
