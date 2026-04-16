import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const hoistedMocks = vi.hoisted(() => {
  const createClientMock = vi.fn()
  const createAdminClientMock = vi.fn()
  const checkUserRateLimitMock = vi.fn()
  const streamTextMock = vi.fn()
  const buildLanguageModelMock = vi.fn()
  return {
    createClientMock,
    createAdminClientMock,
    checkUserRateLimitMock,
    streamTextMock,
    buildLanguageModelMock,
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => hoistedMocks.createClientMock(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => hoistedMocks.createAdminClientMock(),
}))

vi.mock('@/lib/chat/rate-limiter', () => ({
  checkUserRateLimit: hoistedMocks.checkUserRateLimitMock,
}))

vi.mock('ai', () => ({
  streamText: hoistedMocks.streamTextMock,
}))

vi.mock('@/lib/llm/model-factory', () => ({
  buildLanguageModel: hoistedMocks.buildLanguageModelMock,
}))

import { POST } from './route'

type TableName = 'messages' | 'profiles' | 'api_keys'

type MessageRow = {
  id: string
  chat_id: string
  role: string
  content: string
  user_id: string
  model_used?: string | null
}

type ProfileRow = {
  id: string
  reprocess_prompt: string | null
  reprocess_api_key_id: string | null
}

type ApiKeyRow = {
  id: string
  user_id: string
  is_active: boolean
  provider: string
  model_preference: string | null
  vault_secret_name: string
  service_tier: string | null
}

type SelectErrorMap = Partial<Record<TableName, { message: string; code?: string }>>
type UpdateResult = { error: { message: string } | null }
type UpdateCall = {
  table: TableName
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

type RouteSupabaseOptions = {
  user?: { id: string } | null
  messageRows?: MessageRow[]
  profileRows?: ProfileRow[]
  apiKeyRows?: ApiKeyRow[]
  selectErrors?: SelectErrorMap
  onUpdate?: (args: UpdateCall & { callIndex: number }) => UpdateResult | Promise<UpdateResult>
}

function buildRequest(body: unknown) {
  return new Request('http://localhost:3000/api/messages/reprocess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function* createTextStream(chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

function createAdminSupabase(result: unknown | (() => unknown | Promise<unknown>) = 'sk-test') {
  return {
    rpc: vi.fn(async () => {
      const value = typeof result === 'function' ? await result() : result
      if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
        return value as { data: unknown; error: unknown }
      }
      return { data: value, error: null }
    }),
  }
}

function createRouteSupabase(options: RouteSupabaseOptions = {}) {
  const user = options.user === undefined ? { id: 'user-1' } : options.user
  const userId = user?.id ?? 'user-1'

  const state = {
    messages: options.messageRows?.map((row) => ({ ...row })) ?? [
      {
        id: 'assistant-msg-1',
        chat_id: 'chat-1',
        role: 'assistant',
        content: 'Original assistant reply',
        user_id: userId,
        model_used: null,
      },
    ],
    profiles: options.profileRows?.map((row) => ({ ...row })) ?? [
      {
        id: userId,
        reprocess_prompt: 'Rewrite the text more naturally.',
        reprocess_api_key_id: 'key-1',
      },
    ],
    apiKeys: options.apiKeyRows?.map((row) => ({ ...row })) ?? [
      {
        id: 'key-1',
        user_id: userId,
        is_active: true,
        provider: 'openai',
        model_preference: 'gpt-reprocess',
        vault_secret_name: 'vault-key',
        service_tier: 'standard',
      },
    ],
    updateCalls: [] as UpdateCall[],
  }

  const getRows = (table: TableName) => {
    switch (table) {
      case 'messages':
        return state.messages
      case 'profiles':
        return state.profiles
      case 'api_keys':
        return state.apiKeys
    }
  }

  const matchesFilters = (row: Record<string, unknown>, filters: Array<[string, unknown]>) =>
    filters.every(([field, value]) => row[field] === value)

  function createSelectBuilder(table: TableName) {
    const filters: Array<[string, unknown]> = []

    return {
      eq(field: string, value: unknown) {
        filters.push([field, value])
        return this
      },
      async single() {
        const selectError = options.selectErrors?.[table]
        if (selectError) {
          return { data: null, error: selectError }
        }

        const row = getRows(table).find((item) =>
          matchesFilters(item as Record<string, unknown>, filters),
        )

        return {
          data: row ?? null,
          error: null,
        }
      },
    }
  }

  function createUpdateBuilder(table: TableName, payload: Record<string, unknown>) {
    const filters: Array<[string, unknown]> = []
    let settled = false

    const builder = {
      eq(field: string, value: unknown) {
        filters.push([field, value])
        return builder
      },
      then<TResult1 = UpdateResult, TResult2 = never>(
        onfulfilled?: ((value: UpdateResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        const promise = (async () => {
          if (settled) {
            return { error: null }
          }
          settled = true

          const call: UpdateCall = {
            table,
            payload,
            filters: [...filters],
          }
          state.updateCalls.push(call)

          const result = (await options.onUpdate?.({
            ...call,
            callIndex: state.updateCalls.length,
          })) ?? {
            error: null,
          }

          if (!result.error) {
            const rows = getRows(table)
            for (const row of rows) {
              if (matchesFilters(row as Record<string, unknown>, filters)) {
                Object.assign(row, payload)
              }
            }
          }

          return result
        })()

        return promise.then(onfulfilled, onrejected)
      },
    }

    return builder
  }

  return {
    state,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'Not authenticated' },
      }),
    },
    from(table: string) {
      if (!['messages', 'profiles', 'api_keys'].includes(table)) {
        throw new Error(`Unexpected table: ${table}`)
      }

      const tableName = table as TableName
      return {
        select: () => createSelectBuilder(tableName),
        update: (payload: Record<string, unknown>) => createUpdateBuilder(tableName, payload),
      }
    },
  }
}

describe('POST /api/messages/reprocess', () => {
  beforeEach(() => {
    restoreEnv()
    vi.clearAllMocks()

    hoistedMocks.checkUserRateLimitMock.mockResolvedValue({ allowed: true, retryAfter: null })
    hoistedMocks.buildLanguageModelMock.mockReturnValue({ id: 'mock-model' })
    hoistedMocks.streamTextMock.mockResolvedValue({
      textStream: createTextStream(['reprocessed output']),
    })
    hoistedMocks.createAdminClientMock.mockReturnValue(createAdminSupabase())
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 401 before parsing invalid JSON when unauthenticated', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase({ user: null }))

    const response = await POST(
      new Request('http://localhost:3000/api/messages/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('X-RebelAI-Support-Tier')).toBe('experimental')
    expect(await response.text()).toBe('Unauthorized')
    expect(hoistedMocks.checkUserRateLimitMock).not.toHaveBeenCalled()
  })

  it('returns 429 before parsing invalid JSON when rate limited', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase())
    hoistedMocks.checkUserRateLimitMock.mockResolvedValue({ allowed: false, retryAfter: 25 })

    const response = await POST(
      new Request('http://localhost:3000/api/messages/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('25')
    expect(response.headers.get('X-RebelAI-Support-Tier')).toBe('experimental')
    expect(await response.text()).toBe('Too many requests')
  })

  it('falls back to Retry-After 60 when the limiter omits retryAfter', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase())
    hoistedMocks.checkUserRateLimitMock.mockResolvedValue({ allowed: false, retryAfter: null })

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
  })

  it('returns 400 when messageId is missing after rate limit passes', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase())

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Missing messageId')
    expect(hoistedMocks.checkUserRateLimitMock).toHaveBeenCalledWith('user-1')
  })

  it('returns 404 when the target message is missing', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase({ messageRows: [] }))

    const response = await POST(buildRequest({ messageId: 'missing-msg' }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Message not found')
  })

  it('returns 404 when the message lookup errors', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createRouteSupabase({
        selectErrors: {
          messages: { message: 'message query failed', code: 'XX001' },
        },
      }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Message not found')
  })

  it('returns 403 when the message belongs to a different user', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createRouteSupabase({
        messageRows: [
          {
            id: 'assistant-msg-1',
            chat_id: 'chat-1',
            role: 'assistant',
            content: 'Original assistant reply',
            user_id: 'other-user',
          },
        ],
      }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 400 when the target message is not an assistant message', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createRouteSupabase({
        messageRows: [
          {
            id: 'assistant-msg-1',
            chat_id: 'chat-1',
            role: 'user',
            content: 'Original user message',
            user_id: 'user-1',
          },
        ],
      }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Only assistant messages can be reprocessed')
  })

  it('returns 404 when the user profile is missing', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase({ profileRows: [] }))

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Profile not found')
  })

  it('returns 404 when the profile lookup errors', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createRouteSupabase({
        selectErrors: {
          profiles: { message: 'profile query failed', code: 'XX002' },
        },
      }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Profile not found')
  })

  it('returns 400 when the reprocess prompt is missing', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createRouteSupabase({
        profileRows: [
          {
            id: 'user-1',
            reprocess_prompt: null,
            reprocess_api_key_id: 'key-1',
          },
        ],
      }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Reprocess settings not configured')
  })

  it('returns 400 when the reprocess API key id is missing', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createRouteSupabase({
        profileRows: [
          {
            id: 'user-1',
            reprocess_prompt: 'Rewrite it better.',
            reprocess_api_key_id: null,
          },
        ],
      }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Reprocess settings not configured')
  })

  it('returns 400 when the configured API key is missing or inactive', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase({ apiKeyRows: [] }))

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('API key not found or inactive')
  })

  it('returns 400 when the API key lookup errors', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createRouteSupabase({
        selectErrors: {
          api_keys: { message: 'api key lookup failed', code: 'XX003' },
        },
      }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('API key not found or inactive')
  })

  it('returns 500 when Vault decryption fails', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createRouteSupabase())
    hoistedMocks.createAdminClientMock.mockReturnValue(
      createAdminSupabase({ data: null, error: { message: 'vault down' } }),
    )

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Failed to decrypt API key')
    expect(hoistedMocks.streamTextMock).not.toHaveBeenCalled()
  })

  it('updates the message content and usage metadata when reprocessing succeeds', async () => {
    const supabase = createRouteSupabase()
    hoistedMocks.createClientMock.mockReturnValue(supabase)
    hoistedMocks.streamTextMock.mockResolvedValue({
      textStream: createTextStream(['rewritten once']),
    })

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('X-RebelAI-Support-Tier')).toBe('experimental')
    expect(body).toEqual({ success: true, content: 'rewritten once' })
    expect(hoistedMocks.buildLanguageModelMock).toHaveBeenCalledWith({
      provider: 'openai',
      modelName: 'gpt-reprocess',
      apiKey: 'sk-test',
      serviceTier: 'standard',
    })
    expect(hoistedMocks.streamTextMock.mock.calls[0][0]).not.toHaveProperty('temperature')

    expect(supabase.state.messages[0]).toMatchObject({
      id: 'assistant-msg-1',
      content: 'rewritten once',
      model_used: 'gpt-reprocess',
    })

    expect(supabase.state.updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'messages',
          payload: { content: 'rewritten once' },
        }),
        expect.objectContaining({
          table: 'messages',
          payload: {
            content: 'rewritten once',
            model_used: 'gpt-reprocess',
          },
        }),
        expect.objectContaining({
          table: 'api_keys',
          payload: {
            last_used_at: expect.any(String),
          },
        }),
      ]),
    )
  })

  it('falls back to the provider default model and flushes queued incremental updates', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(250).mockReturnValueOnce(500)

    const supabase = createRouteSupabase({
      apiKeyRows: [
        {
          id: 'key-1',
          user_id: 'user-1',
          is_active: true,
          provider: 'openai',
          model_preference: null,
          vault_secret_name: 'vault-key',
          service_tier: 'flex',
        },
      ],
      onUpdate: ({ table, payload, callIndex }) => {
        if (table === 'messages' && callIndex === 1 && 'content' in payload) {
          return new Promise<UpdateResult>((resolve) => {
            setTimeout(() => resolve({ error: null }), 0)
          })
        }
        return { error: null }
      },
    })

    hoistedMocks.createClientMock.mockReturnValue(supabase)
    hoistedMocks.streamTextMock.mockResolvedValue({
      textStream: createTextStream(['Hello', ' world']),
    })

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))
    const body = await response.json()

    dateNowSpy.mockRestore()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, content: 'Hello world' })

    const modelName = hoistedMocks.buildLanguageModelMock.mock.calls.at(-1)?.[0]?.modelName
    expect(modelName).toBeTruthy()
    expect(hoistedMocks.buildLanguageModelMock).toHaveBeenLastCalledWith({
      provider: 'openai',
      modelName,
      apiKey: 'sk-test',
      serviceTier: 'flex',
    })

    const messageUpdates = supabase.state.updateCalls.filter((call) => call.table === 'messages')
    expect(messageUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: { content: 'Hello' } }),
        expect.objectContaining({ payload: { content: 'Hello world' } }),
        expect.objectContaining({
          payload: {
            content: 'Hello world',
            model_used: modelName,
          },
        }),
      ]),
    )
  })

  it('returns 500 when an incremental message update fails during streaming', async () => {
    const supabase = createRouteSupabase({
      onUpdate: ({ table, payload }) => {
        if (table === 'messages' && 'content' in payload) {
          return { error: { message: 'incremental update failed' } }
        }
        return { error: null }
      },
    })
    hoistedMocks.createClientMock.mockReturnValue(supabase)
    hoistedMocks.streamTextMock.mockResolvedValue({
      textStream: createTextStream(['Hello']),
    })

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(500)
    expect(response.headers.get('X-RebelAI-Support-Tier')).toBe('experimental')
    expect(await response.text()).toBe('Failed to reprocess message')
  })

  it('returns 500 when the final message update fails', async () => {
    const supabase = createRouteSupabase({
      onUpdate: ({ table, payload }) => {
        if (table === 'messages' && 'model_used' in payload) {
          return { error: { message: 'final update failed' } }
        }
        return { error: null }
      },
    })
    hoistedMocks.createClientMock.mockReturnValue(supabase)
    hoistedMocks.streamTextMock.mockResolvedValue({
      textStream: createTextStream(['Hello']),
    })

    const response = await POST(buildRequest({ messageId: 'assistant-msg-1' }))

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Failed to save reprocessed message')
  })
})
