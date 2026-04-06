import { describe, expect, it, beforeEach, vi } from 'vitest'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

type MockQueryBuilder = {
  select: () => MockQueryBuilder
  eq: (field: string, value: unknown) => MockQueryBuilder
  order: () => Promise<{
    data: Array<Record<string, unknown>> | null
    error: { message: string } | null
  }>
}

function createSupabaseMock({
  user,
  apiKeys,
  personas,
  apiKeysError,
  personasError,
}: {
  user: { id: string } | null
  apiKeys?: Array<Record<string, unknown>> | null
  personas?: Array<Record<string, unknown>> | null
  apiKeysError?: { message: string } | null
  personasError?: { message: string } | null
}) {
  const eqCalls: Array<[string, unknown, string]> = []

  const fromFn = (table: string): MockQueryBuilder => {
    switch (table) {
      case 'api_keys': {
        return {
          select: () => fromFn(table),
          eq: (field: string, value: unknown) => {
            eqCalls.push([table, value, field])
            return fromFn(table)
          },
          order: async () => ({
            data: apiKeys ?? null,
            error: apiKeysError ?? null,
          }),
        }
      }
      case 'personas': {
        return {
          select: () => fromFn(table),
          eq: (field: string, value: unknown) => {
            eqCalls.push([table, value, field])
            return fromFn(table)
          },
          order: async () => ({
            data: personas ?? null,
            error: personasError ?? null,
          }),
        }
      }
      default:
        throw new Error(`Unexpected table ${table}`)
    }
  }

  return {
    eqCalls,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: fromFn,
  }
}

describe('GET /api/chat-options', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
  })

  it('returns 401 for anonymous user', async () => {
    createClientMock.mockResolvedValue(
      createSupabaseMock({
        user: null,
      }),
    )
    const { GET } = await import('./route')

    const response = await GET()

    expect(response.status).toBe(401)
  })

  it('filters out non-LLM providers', async () => {
    createClientMock.mockResolvedValue(
      createSupabaseMock({
        user: { id: 'user-1' },
        apiKeys: [
          { id: 'openai-1', user_id: 'user-1', provider: 'openai', is_active: true },
          { id: 'voyage-1', user_id: 'user-1', provider: 'voyage_embeddings', is_active: true },
        ],
        personas: [{ id: 'persona-1', name: 'Tester' }],
      }),
    )

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.apiKeys).toHaveLength(1)
    expect(body.apiKeys[0].provider).toBe('openai')
    expect(body.personas).toHaveLength(1)
  })

  it('logs query errors and falls back to empty lists', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createClientMock.mockResolvedValue(
      createSupabaseMock({
        user: { id: 'user-1' },
        apiKeys: null,
        personas: null,
        apiKeysError: { message: 'api_keys failed' },
        personasError: { message: 'personas failed' },
      }),
    )

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ apiKeys: [], personas: [] })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Chat options] Failed to load API keys',
      expect.objectContaining({ message: 'api_keys failed' }),
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Chat options] Failed to load personas',
      expect.objectContaining({ message: 'personas failed' }),
    )

    consoleErrorSpy.mockRestore()
  })
})
