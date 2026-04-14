import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type SupabaseFixtures = {
  chatOwnerId?: string
  chatExists?: boolean
  chatError?: boolean
  apiKeyOwnerId?: string
  apiKeyExists?: boolean
  apiKeyError?: boolean
  apiKeyActive?: boolean
  vaultSecretName?: string | null
  decryptedSecret?: string | null
  decryptError?: boolean
  apiKeyProvider?: string
  modelPreference?: string | null
}

type RpcCall = { name: string; args: Record<string, unknown> }

const validBody = {
  chatId: 'chat-1',
  userId: 'user-1',
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  apiKeyId: 'key-1',
}

let currentSupabase: ReturnType<typeof createSupabaseMock> | null = null
const updateMemoryStateMock = vi.fn()
const hasMemoryUpdateWorkMock = vi.fn()

const googleModelFactoryMock = vi.fn((modelName: string) => ({ provider: 'google', modelName }))
const openAIModelFactoryMock = vi.fn((modelName: string) => ({ provider: 'openai', modelName }))
const openRouterModelFactoryMock = vi.fn((modelName: string) => ({
  provider: 'openrouter',
  modelName,
}))
const anthropicModelFactoryMock = vi.fn((modelName: string) => ({
  provider: 'anthropic',
  modelName,
}))
const deepSeekModelFactoryMock = vi.fn((modelName: string) => ({ provider: 'deepseek', modelName }))

const createGoogleGenerativeAIMock = vi.fn()
const createOpenAIMock = vi.fn()
const createOpenAIWithServiceTierMock = vi.fn()
const createAnthropicMock = vi.fn()
const createDeepSeekMock = vi.fn()

vi.mock('@/lib/chat-memory', () => ({
  hasMemoryUpdateWork: (...args: unknown[]) => hasMemoryUpdateWorkMock(...args),
  updateMemoryState: (...args: unknown[]) => updateMemoryStateMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => currentSupabase ?? createSupabaseMock({})),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (...args: unknown[]) => createGoogleGenerativeAIMock(...args),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => createOpenAIMock(...args),
}))

vi.mock('@/lib/openai/service-tier', () => ({
  createOpenAIWithServiceTier: (...args: unknown[]) => createOpenAIWithServiceTierMock(...args),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: unknown[]) => createAnthropicMock(...args),
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: (...args: unknown[]) => createDeepSeekMock(...args),
}))

function createSupabaseMock({
  chatOwnerId = 'user-1',
  chatExists = true,
  chatError = false,
  apiKeyOwnerId = 'user-1',
  apiKeyExists = true,
  apiKeyError = false,
  apiKeyActive = true,
  vaultSecretName = 'secret-name',
  decryptedSecret = 'sk-test',
  decryptError = false,
  apiKeyProvider = 'openai',
  modelPreference = 'gpt-4o-mini',
}: SupabaseFixtures) {
  const rpcCalls: RpcCall[] = []

  return {
    rpcCalls,
    from(table: string) {
      switch (table) {
        case 'chats':
          return {
            select: () => ({
              eq: () => ({
                single: async () => {
                  if (chatError) {
                    return { data: null, error: { message: 'chat lookup failed' } }
                  }
                  if (!chatExists) {
                    return { data: null, error: null }
                  }

                  return {
                    data: { id: 'chat-1', user_id: chatOwnerId, model_config: null },
                    error: null,
                  }
                },
              }),
            }),
          }
        case 'api_keys':
          return {
            select: () => ({
              eq: () => ({
                single: async () => {
                  if (apiKeyError) {
                    return { data: null, error: { message: 'api key lookup failed' } }
                  }
                  if (!apiKeyExists) {
                    return { data: null, error: null }
                  }

                  return {
                    data: {
                      id: 'key-1',
                      user_id: apiKeyOwnerId,
                      provider: apiKeyProvider,
                      model_preference: modelPreference,
                      vault_secret_name: vaultSecretName,
                      is_active: apiKeyActive,
                      service_tier: 'standard',
                    },
                    error: null,
                  }
                },
              }),
            }),
          }
        default:
          throw new Error(`Unexpected table ${table}`)
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      if (decryptError) {
        return Promise.resolve({ data: null, error: { message: 'decrypt failed' } })
      }
      return Promise.resolve({ data: decryptedSecret, error: null })
    },
  }
}

function buildRequest(body: unknown, auth?: string) {
  return new NextRequest('http://localhost/api/summaries/generate', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  })
}

function buildRawRequest(rawBody: string, auth?: string) {
  return new NextRequest('http://localhost/api/summaries/generate', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
    body: rawBody,
  })
}

describe('POST /api/summaries/generate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    currentSupabase = null

    updateMemoryStateMock.mockReset()
    updateMemoryStateMock.mockResolvedValue(undefined)
    hasMemoryUpdateWorkMock.mockReset()
    hasMemoryUpdateWorkMock.mockResolvedValue(true)

    googleModelFactoryMock.mockReset()
    openAIModelFactoryMock.mockReset()
    openRouterModelFactoryMock.mockReset()
    anthropicModelFactoryMock.mockReset()
    deepSeekModelFactoryMock.mockReset()

    createGoogleGenerativeAIMock.mockReset()
    createOpenAIMock.mockReset()
    createOpenAIWithServiceTierMock.mockReset()
    createAnthropicMock.mockReset()
    createDeepSeekMock.mockReset()

    createGoogleGenerativeAIMock.mockReturnValue(googleModelFactoryMock)
    createOpenAIMock.mockReturnValue({ chat: openRouterModelFactoryMock })
    createOpenAIWithServiceTierMock.mockReturnValue(openAIModelFactoryMock)
    createAnthropicMock.mockReturnValue(anthropicModelFactoryMock)
    createDeepSeekMock.mockReturnValue(deepSeekModelFactoryMock)

    vi.stubEnv('SUMMARY_GENERATION_SECRET', 'summary-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 500 when SUMMARY_GENERATION_SECRET is not configured', async () => {
    vi.stubEnv('SUMMARY_GENERATION_SECRET', '')
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('rejects unauthorized requests', async () => {
    const { POST } = await import('./route')
    const response = await POST(buildRequest(validBody))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          chatId: 'chat-1',
          userId: 'user-1',
          provider: 'openai',
          apiKeyId: 'key-1',
        },
        'Bearer summary-secret',
      ),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid request body')
  })

  it('returns 404 when chat lookup returns an error', async () => {
    currentSupabase = createSupabaseMock({ chatError: true })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(404)
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('returns 404 when chat is missing', async () => {
    currentSupabase = createSupabaseMock({ chatExists: false })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(404)
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('rejects when chat is not owned by requester', async () => {
    currentSupabase = createSupabaseMock({ chatOwnerId: 'other-user' })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Forbidden')
  })

  it('returns 404 when API key lookup errors', async () => {
    currentSupabase = createSupabaseMock({ apiKeyError: true })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(404)
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('returns 404 when API key is missing', async () => {
    currentSupabase = createSupabaseMock({ apiKeyExists: false })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(404)
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('returns 403 when API key belongs to a different user', async () => {
    currentSupabase = createSupabaseMock({ apiKeyOwnerId: 'other-user' })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(403)
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('returns 403 when API key is inactive', async () => {
    currentSupabase = createSupabaseMock({ apiKeyActive: false })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(403)
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('returns 500 when API key vault secret reference is missing', async () => {
    currentSupabase = createSupabaseMock({ vaultSecretName: '' })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('API key misconfigured')
  })

  it('returns 500 when decryption fails', async () => {
    currentSupabase = createSupabaseMock({ decryptError: true })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(500)
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('returns 400 for unsupported provider', async () => {
    currentSupabase = createSupabaseMock({ apiKeyProvider: 'voyage' })
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Unsupported provider: voyage')
  })

  it('returns 200 and calls updateMemoryState on openai success', async () => {
    currentSupabase = createSupabaseMock({})
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(200)
    expect(createOpenAIWithServiceTierMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      serviceTier: 'standard',
    })
    expect(openAIModelFactoryMock).toHaveBeenCalledWith('gpt-4o-mini')
    expect(updateMemoryStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        userId: 'user-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
      }),
    )
    expect(hasMemoryUpdateWorkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        modelConfig: {},
      }),
    )
    expect(currentSupabase?.rpcCalls).toContainEqual({
      name: 'get_decrypted_secret',
      args: expect.objectContaining({
        secret_name: 'secret-name',
        requester: 'user-1',
      }),
    })
  })

  it('skips API key decryption and model creation when no summary work is pending', async () => {
    currentSupabase = createSupabaseMock({})
    hasMemoryUpdateWorkMock.mockResolvedValueOnce(false)
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      skipped: true,
    })
    expect(currentSupabase?.rpcCalls).toEqual([])
    expect(createOpenAIWithServiceTierMock).not.toHaveBeenCalled()
    expect(updateMemoryStateMock).not.toHaveBeenCalled()
  })

  it('uses anthropic provider model creation', async () => {
    currentSupabase = createSupabaseMock({ apiKeyProvider: 'anthropic' })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          ...validBody,
          provider: 'anthropic',
          modelName: 'claude-3-7-sonnet',
        },
        'Bearer summary-secret',
      ),
    )

    expect(response.status).toBe(200)
    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: 'sk-test' })
    expect(anthropicModelFactoryMock).toHaveBeenCalledWith('claude-3-7-sonnet')
  })

  it('uses deepseek provider model creation', async () => {
    currentSupabase = createSupabaseMock({ apiKeyProvider: 'deepseek' })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          ...validBody,
          provider: 'deepseek',
          modelName: 'deepseek-chat',
        },
        'Bearer summary-secret',
      ),
    )

    expect(response.status).toBe(200)
    expect(createDeepSeekMock).toHaveBeenCalledWith({ apiKey: 'sk-test' })
    expect(deepSeekModelFactoryMock).toHaveBeenCalledWith('deepseek-chat')
  })

  it('uses openrouter provider model creation', async () => {
    currentSupabase = createSupabaseMock({ apiKeyProvider: 'openrouter' })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          ...validBody,
          provider: 'openrouter',
          modelName: 'z-ai/glm-5',
        },
        'Bearer summary-secret',
      ),
    )

    expect(response.status).toBe(200)
    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://openrouter.ai/api/v1',
    })
    expect(openRouterModelFactoryMock).toHaveBeenCalledWith('z-ai/glm-5')
  })

  it('falls back to stored provider when payload provider differs', async () => {
    currentSupabase = createSupabaseMock({
      apiKeyProvider: 'google',
      modelPreference: 'gemini-2.0-flash',
    })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          ...validBody,
          provider: 'openai',
          modelName: 'wrong-model',
        },
        'Bearer summary-secret',
      ),
    )

    expect(response.status).toBe(200)
    expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith({ apiKey: 'sk-test' })
    expect(googleModelFactoryMock).toHaveBeenCalledWith('wrong-model')
    expect(updateMemoryStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        modelName: 'wrong-model',
      }),
    )
  })

  it('normalizes regenerate ranges before calling updateMemoryState', async () => {
    currentSupabase = createSupabaseMock({})
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          ...validBody,
          regenerate: {
            chunkRanges: [
              { startSeq: 1, endSeq: 2 },
              { startSeq: 1, endSeq: 2 },
              { startSeq: 0, endSeq: 2 },
              null,
              { startSeq: Number.NaN, endSeq: 3 },
              { startSeq: 7, endSeq: 8 },
            ],
            factRanges: [
              { startSeq: 1, endSeq: 2 },
              { startSeq: 2, endSeq: 3 },
              { startSeq: 2, endSeq: 3 },
              { startSeq: 3, endSeq: 2 },
            ],
            metaRanges: [
              { startSeq: 10, endSeq: 12 },
              { startSeq: 10, endSeq: 12 },
            ],
          },
        },
        'Bearer summary-secret',
      ),
    )

    expect(response.status).toBe(200)
    expect(updateMemoryStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        regenerate: {
          chunkRanges: [
            { startSeq: 1, endSeq: 2 },
            { startSeq: 7, endSeq: 8 },
          ],
          factRanges: [{ startSeq: 2, endSeq: 3 }],
          metaRanges: [{ startSeq: 10, endSeq: 12 }],
        },
      }),
    )
  })

  it('returns 500 without exposing internal error details when summary generation throws Error', async () => {
    currentSupabase = createSupabaseMock({})
    updateMemoryStateMock.mockRejectedValueOnce(new Error('summary pipeline failed'))
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({
      error: 'Summary generation failed',
    })
    expect(body).not.toHaveProperty('details')
  })

  it('returns 500 without details when summary generation throws non-Error', async () => {
    currentSupabase = createSupabaseMock({})
    updateMemoryStateMock.mockRejectedValueOnce('boom')
    const { POST } = await import('./route')

    const response = await POST(buildRequest(validBody, 'Bearer summary-secret'))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({
      error: 'Summary generation failed',
    })
    expect(body).not.toHaveProperty('details')
  })

  it('returns 400 for malformed JSON body', async () => {
    const { POST } = await import('./route')

    const response = await POST(buildRawRequest('{ invalid-json', 'Bearer summary-secret'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid request body')
  })
})
