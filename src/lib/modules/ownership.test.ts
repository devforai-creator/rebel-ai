/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateModuleOwnership } from './ownership'

function createMockSupabase(overrides?: {
  queryResult?: { data: Array<{ id: string }> | null; error: { message: string } | null }
}) {
  const calls = {
    queries: [] as Array<{ userId: string; moduleIds: string[] }>,
  }

  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, val: string) => ({
          in: vi.fn((_col2: string, vals: string[]) => {
            calls.queries.push({ userId: val, moduleIds: vals })
            const defaultResult = {
              data: vals.map((id) => ({ id })), // Default: all owned
              error: null,
            }
            return Promise.resolve(overrides?.queryResult ?? defaultResult)
          }),
        })),
      })),
    })),
  }

  return { client: client as any, calls }
}

describe('validateModuleOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('valid inputs', () => {
    it('returns all modules as valid when user owns all', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: [{ id: 'mod-1' }, { id: 'mod-2' }, { id: 'mod-3' }],
          error: null,
        },
      })

      const result = await validateModuleOwnership(mock.client, 'user-123', [
        'mod-1',
        'mod-2',
        'mod-3',
      ])

      expect(result.validIds).toEqual(['mod-1', 'mod-2', 'mod-3'])
      expect(result.invalidIds).toEqual([])
    })

    it('returns only owned modules as valid', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: [{ id: 'mod-1' }, { id: 'mod-3' }], // mod-2 not owned
          error: null,
        },
      })

      const result = await validateModuleOwnership(mock.client, 'user-123', [
        'mod-1',
        'mod-2',
        'mod-3',
      ])

      expect(result.validIds).toEqual(['mod-1', 'mod-3'])
      expect(result.invalidIds).toEqual(['mod-2'])
    })

    it('returns all modules as invalid when user owns none', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: [],
          error: null,
        },
      })

      const result = await validateModuleOwnership(mock.client, 'user-123', ['mod-1', 'mod-2'])

      expect(result.validIds).toEqual([])
      expect(result.invalidIds).toEqual(['mod-1', 'mod-2'])
    })
  })

  describe('edge cases', () => {
    it('returns empty arrays for empty input', async () => {
      const mock = createMockSupabase()

      const result = await validateModuleOwnership(mock.client, 'user-123', [])

      expect(result.validIds).toEqual([])
      expect(result.invalidIds).toEqual([])
      // Should not query database
      expect(mock.calls.queries).toHaveLength(0)
    })

    it('deduplicates module IDs', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: [{ id: 'mod-1' }],
          error: null,
        },
      })

      const result = await validateModuleOwnership(mock.client, 'user-123', [
        'mod-1',
        'mod-1',
        'mod-1',
      ])

      expect(result.validIds).toEqual(['mod-1'])
      expect(result.invalidIds).toEqual([])
      // Should only query with unique IDs
      expect(mock.calls.queries[0].moduleIds).toEqual(['mod-1'])
    })

    it('filters out empty strings', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: [{ id: 'mod-1' }],
          error: null,
        },
      })

      await validateModuleOwnership(mock.client, 'user-123', ['mod-1', '', '  ', 'mod-2'])

      // Empty/whitespace strings should be filtered out
      expect(mock.calls.queries[0].moduleIds).toEqual(['mod-1', 'mod-2'])
    })

    it('filters out non-string values', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: [{ id: 'mod-1' }],
          error: null,
        },
      })

      await validateModuleOwnership(mock.client, 'user-123', [
        'mod-1',
        null as any,
        undefined as any,
        123 as any,
      ])

      expect(mock.calls.queries[0].moduleIds).toEqual(['mod-1'])
    })

    it('preserves order of valid IDs', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: [{ id: 'mod-3' }, { id: 'mod-1' }], // DB returns in different order
          error: null,
        },
      })

      const result = await validateModuleOwnership(mock.client, 'user-123', [
        'mod-1',
        'mod-2',
        'mod-3',
      ])

      // Should preserve input order for valid IDs
      expect(result.validIds).toEqual(['mod-1', 'mod-3'])
    })
  })

  describe('error handling', () => {
    it('throws on database error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const mock = createMockSupabase({
        queryResult: {
          data: null,
          error: { message: 'Connection failed' },
        },
      })

      await expect(validateModuleOwnership(mock.client, 'user-123', ['mod-1'])).rejects.toThrow(
        '모듈 소유권을 확인할 수 없습니다',
      )

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Module Ownership] Failed to verify modules',
        expect.objectContaining({ userId: 'user-123', error: 'Connection failed' }),
      )

      consoleErrorSpy.mockRestore()
    })

    it('handles null data as empty result', async () => {
      const mock = createMockSupabase({
        queryResult: {
          data: null,
          error: null,
        },
      })

      const result = await validateModuleOwnership(mock.client, 'user-123', ['mod-1'])

      expect(result.validIds).toEqual([])
      expect(result.invalidIds).toEqual(['mod-1'])
    })
  })

  describe('query construction', () => {
    it('queries with correct user_id and module IDs', async () => {
      const mock = createMockSupabase()

      await validateModuleOwnership(mock.client, 'user-abc', ['mod-x', 'mod-y'])

      expect(mock.calls.queries).toHaveLength(1)
      expect(mock.calls.queries[0]).toEqual({
        userId: 'user-abc',
        moduleIds: ['mod-x', 'mod-y'],
      })
    })
  })
})
