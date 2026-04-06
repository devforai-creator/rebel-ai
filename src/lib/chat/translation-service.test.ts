import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'

const generateTextMock = vi.fn()
const createGoogleProviderMock = vi.fn()
const createOpenAIProviderMock = vi.fn()
const createOpenRouterProviderMock = vi.fn()
const createAnthropicProviderMock = vi.fn()
const createDeepSeekProviderMock = vi.fn()
const getDefaultModelForProviderMock = vi.fn()

vi.mock('ai', () => ({
  generateText: (...args: Parameters<typeof generateTextMock>) => generateTextMock(...args),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (...args: Parameters<typeof createGoogleProviderMock>) =>
    createGoogleProviderMock(...args),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: Parameters<typeof createOpenRouterProviderMock>) =>
    createOpenRouterProviderMock(...args),
}))

vi.mock('@/lib/openai/service-tier', () => ({
  createOpenAIWithServiceTier: (...args: Parameters<typeof createOpenAIProviderMock>) =>
    createOpenAIProviderMock(...args),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: Parameters<typeof createAnthropicProviderMock>) =>
    createAnthropicProviderMock(...args),
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: (...args: Parameters<typeof createDeepSeekProviderMock>) =>
    createDeepSeekProviderMock(...args),
}))

vi.mock('@/lib/models', () => ({
  getDefaultModelForProvider: (...args: Parameters<typeof getDefaultModelForProviderMock>) =>
    getDefaultModelForProviderMock(...args),
}))

type TranslationRows = {
  profileRow?: Record<string, unknown> | null
  apiKeyRow?: Record<string, unknown> | null
}

function createTranslationClients(
  options: {
    rows?: TranslationRows
    decryptRpc?: () => unknown
  } = {},
) {
  const profileRow = options.rows?.profileRow
  const apiKeyRow = options.rows?.apiKeyRow

  const supabase = createSupabaseMock({
    tables: {
      profiles: {
        rows:
          profileRow === undefined
            ? [{ id: 'user-1', translation_api_key_id: 'key-1' }]
            : profileRow
              ? [profileRow]
              : [],
      },
      api_keys: {
        rows:
          apiKeyRow === undefined
            ? [
                {
                  id: 'key-1',
                  user_id: 'user-1',
                  is_active: true,
                  provider: 'openai',
                  model_preference: 'gpt-4o-mini',
                  vault_secret_name: 'vault-key',
                  service_tier: 'standard',
                },
              ]
            : apiKeyRow
              ? [apiKeyRow]
              : [],
        primaryKeys: ['id'],
      },
      messages: {
        rows: [{ id: 'msg-1', user_id: 'user-1', content_en: null }],
        primaryKeys: ['id'],
      },
    },
  })

  const adminSupabase = createSupabaseMock({
    rpc: {
      get_decrypted_secret: options.decryptRpc ?? (() => 'sk-test'),
    },
  })

  return {
    supabase: supabase as unknown as SupabaseClientType,
    getAdminClient: () => adminSupabase as unknown as SupabaseClientType,
    state: supabase.state,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  createGoogleProviderMock.mockImplementation(() => vi.fn(() => ({ id: 'google-model' })))
  createOpenAIProviderMock.mockImplementation(() => vi.fn(() => ({ id: 'openai-model' })))
  createOpenRouterProviderMock.mockImplementation(() => ({
    chat: vi.fn(() => ({ id: 'openrouter-model' })),
  }))
  createAnthropicProviderMock.mockImplementation(() => vi.fn(() => ({ id: 'anthropic-model' })))
  createDeepSeekProviderMock.mockImplementation(() => vi.fn(() => ({ id: 'deepseek-model' })))
  getDefaultModelForProviderMock.mockReturnValue('default-lightweight-model')
  generateTextMock.mockResolvedValue({ text: 'translated text' })
})

describe('translateMessageForUser', () => {
  it('returns missing_profile when profile lookup fails', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({ rows: { profileRow: null } })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toEqual({ status: 'missing_profile' })
  })

  it('returns missing_api_key when profile has no translation key', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({
      rows: { profileRow: { id: 'user-1', translation_api_key_id: null } },
    })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toEqual({ status: 'missing_api_key' })
  })

  it('returns invalid_api_key when key lookup fails', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({ rows: { apiKeyRow: null } })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toEqual({ status: 'invalid_api_key', apiKeyId: 'key-1' })
  })

  it('returns vault_error when secret decrypt RPC fails', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({
      decryptRpc: () => ({ data: null, error: { message: 'vault down' } }),
    })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result.status).toBe('vault_error')
    expect(result).toMatchObject({
      status: 'vault_error',
      error: expect.any(Error),
    })
  })

  it('returns vault_error when vault returns empty decrypted data', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({
      decryptRpc: () => ({ data: null, error: null }),
    })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toMatchObject({
      status: 'vault_error',
      error: expect.any(Error),
    })
  })

  it('returns translation_error when generation fails', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients()
    generateTextMock.mockRejectedValueOnce(new Error('upstream failed'))

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toMatchObject({
      status: 'translation_error',
      error: expect.any(Error),
    })
  })

  it('returns save_error when message update fails', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const clients = createTranslationClients()
    const baseSupabase = clients.supabase as unknown as {
      from: (table: string) => { update?: (payload: Record<string, unknown>) => unknown }
    }
    const originalFrom = baseSupabase.from.bind(baseSupabase)

    const supabaseWithSaveError = {
      ...clients.supabase,
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: { message: 'write failed' } }),
              }),
            }),
          }
        }
        return originalFrom(table)
      },
    } as unknown as SupabaseClientType

    const result = await translateMessageForUser({
      supabase: supabaseWithSaveError,
      getAdminClient: clients.getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toEqual({ status: 'save_error', error: { message: 'write failed' } })
  })

  it('uses default model, trims output, saves translation, and updates key usage', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient, state } = createTranslationClients({
      rows: {
        apiKeyRow: {
          id: 'key-1',
          user_id: 'user-1',
          is_active: true,
          provider: 'google',
          model_preference: null,
          vault_secret_name: 'vault-key',
          service_tier: 'standard',
        },
      },
    })
    generateTextMock.mockResolvedValueOnce({ text: '  translated text  ' })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toEqual({ status: 'success', content: 'translated text' })
    expect(getDefaultModelForProviderMock).toHaveBeenCalledWith('google', { lightweight: true })
    expect(generateTextMock).toHaveBeenCalledTimes(1)

    const messages = state.messages as Array<Record<string, unknown>>
    expect(messages[0].content_en).toBe('translated text')

    const apiKeys = state.apiKeys as Array<Record<string, unknown>>
    expect(apiKeys[0].last_used_at).toEqual(expect.any(String))
  })

  it('preserves whitespace when trimOutput is false', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients()
    generateTextMock.mockResolvedValueOnce({ text: '  spaced text  ' })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: false,
    })

    expect(result).toEqual({ status: 'success', content: '  spaced text  ' })
    expect(createOpenAIProviderMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      serviceTier: 'standard',
    })
  })

  it('uses anthropic provider when configured', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({
      rows: {
        apiKeyRow: {
          id: 'key-1',
          user_id: 'user-1',
          is_active: true,
          provider: 'anthropic',
          model_preference: 'claude-3-7-sonnet',
          vault_secret_name: 'vault-key',
          service_tier: 'standard',
        },
      },
    })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toMatchObject({ status: 'success' })
    expect(createAnthropicProviderMock).toHaveBeenCalledWith({ apiKey: 'sk-test' })
  })

  it('uses deepseek provider when configured', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({
      rows: {
        apiKeyRow: {
          id: 'key-1',
          user_id: 'user-1',
          is_active: true,
          provider: 'deepseek',
          model_preference: 'deepseek-chat',
          vault_secret_name: 'vault-key',
          service_tier: 'standard',
        },
      },
    })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toMatchObject({ status: 'success' })
    expect(createDeepSeekProviderMock).toHaveBeenCalledWith({ apiKey: 'sk-test' })
  })

  it('uses openrouter provider when configured', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({
      rows: {
        apiKeyRow: {
          id: 'key-1',
          user_id: 'user-1',
          is_active: true,
          provider: 'openrouter',
          model_preference: 'z-ai/glm-5',
          vault_secret_name: 'vault-key',
          service_tier: 'standard',
        },
      },
    })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result).toMatchObject({ status: 'success' })
    expect(createOpenRouterProviderMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://openrouter.ai/api/v1',
    })
  })

  it('returns translation_error for unsupported providers', async () => {
    const { translateMessageForUser } = await import('./translation-service')
    const { supabase, getAdminClient } = createTranslationClients({
      rows: {
        apiKeyRow: {
          id: 'key-1',
          user_id: 'user-1',
          is_active: true,
          provider: 'unsupported',
          model_preference: 'custom-model',
          vault_secret_name: 'vault-key',
          service_tier: 'standard',
        },
      },
    })

    const result = await translateMessageForUser({
      supabase,
      getAdminClient,
      userId: 'user-1',
      messageId: 'msg-1',
      messageContent: '안녕',
      trimOutput: true,
    })

    expect(result.status).toBe('translation_error')
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
