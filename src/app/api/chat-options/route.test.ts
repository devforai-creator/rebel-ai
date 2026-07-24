import { describe, expect, it, beforeEach, vi } from 'vitest'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

type MockQueryBuilder = {
  select: () => MockQueryBuilder
  eq: (field: string, value: unknown) => MockQueryBuilder
  order: (field: string, options?: { ascending?: boolean }) => MockQueryBuilder
  then: (
    onfulfilled?: (value: MockQueryResult) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>
}

type MockQueryResult = {
  data: Array<Record<string, unknown>> | null
  error: { message: string } | null
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
  const orderCalls: Array<[string, string, { ascending?: boolean } | undefined]> = []

  function createBuilder(table: string, result: MockQueryResult): MockQueryBuilder {
    const builder: MockQueryBuilder = {
      select: () => builder,
      eq: (field: string, value: unknown) => {
        eqCalls.push([table, value, field])
        return builder
      },
      order: (field: string, options?: { ascending?: boolean }) => {
        orderCalls.push([table, field, options])
        return builder
      },
      then: (onfulfilled, onrejected) => Promise.resolve(result).then(onfulfilled, onrejected),
    }

    return builder
  }

  const fromFn = (table: string): MockQueryBuilder => {
    if (table === 'api_keys') {
      return createBuilder(table, {
        data: apiKeys ?? null,
        error: apiKeysError ?? null,
      })
    }

    if (table === 'personas') {
      return createBuilder(table, {
        data: personas ?? null,
        error: personasError ?? null,
      })
    }

    throw new Error(`Unexpected table ${table}`)
  }

  return {
    eqCalls,
    orderCalls,
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
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        { id: 'openai-1', user_id: 'user-1', provider: 'openai', is_active: true },
        { id: 'voyage-1', user_id: 'user-1', provider: 'voyage_embeddings', is_active: true },
      ],
      personas: [{ id: 'persona-1', name: 'Tester' }],
    })
    createClientMock.mockResolvedValue(supabase)

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.apiKeys).toHaveLength(1)
    expect(body.apiKeys[0].provider).toBe('openai')
    expect(body.personas).toHaveLength(1)
    expect(supabase.orderCalls.filter(([table]) => table === 'personas')).toEqual([
      ['personas', 'created_at', { ascending: false }],
      ['personas', 'name', { ascending: true }],
    ])
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
