import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const getDefaultModelForProviderMock = vi.fn()

vi.mock('@/lib/models', () => ({
  getDefaultModelForProvider: (...args: Parameters<typeof getDefaultModelForProviderMock>) =>
    getDefaultModelForProviderMock(...args),
}))

function createResolverSupabase(apiKeys: Array<Record<string, unknown>>) {
  return createSupabaseMock({
    tables: {
      api_keys: {
        rows: apiKeys,
        primaryKeys: ['id'],
      },
    },
  })
}

describe('resolveActiveLlmConfigForUser', () => {
  beforeEach(() => {
    getDefaultModelForProviderMock.mockReset()
    getDefaultModelForProviderMock.mockReturnValue('default-model')
  })

  it('returns missing_api_key when no active user-scoped API key is found', async () => {
    const supabase = createResolverSupabase([])
    const { resolveActiveLlmConfigForUser } = await import('./llm-config-resolver')

    await expect(
      resolveActiveLlmConfigForUser({
        supabase: supabase as never,
        userId: 'user-1',
        apiKeyId: 'key-1',
      }),
    ).resolves.toMatchObject({
      status: 'missing_api_key',
    })
  })

  it('returns unsupported_provider for embedding-only keys', async () => {
    const supabase = createResolverSupabase([
      {
        id: 'key-1',
        user_id: 'user-1',
        is_active: true,
        provider: 'voyage_embeddings',
        model_preference: null,
        service_tier: 'standard',
        vault_secret_name: 'vault-key',
      },
    ])
    const { resolveActiveLlmConfigForUser } = await import('./llm-config-resolver')

    await expect(
      resolveActiveLlmConfigForUser({
        supabase: supabase as never,
        userId: 'user-1',
        apiKeyId: 'key-1',
      }),
    ).resolves.toEqual({
      status: 'unsupported_provider',
      provider: 'voyage_embeddings',
    })
  })

  it('prefers an explicit model name override when provided', async () => {
    const supabase = createResolverSupabase([
      {
        id: 'key-1',
        user_id: 'user-1',
        is_active: true,
        provider: 'openai',
        model_preference: 'stored-model',
        service_tier: 'priority',
        vault_secret_name: 'vault-key',
      },
    ])
    const { resolveActiveLlmConfigForUser } = await import('./llm-config-resolver')

    await expect(
      resolveActiveLlmConfigForUser({
        supabase: supabase as never,
        userId: 'user-1',
        apiKeyId: 'key-1',
        preferredModelName: 'override-model',
      }),
    ).resolves.toEqual({
      status: 'success',
      config: {
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'override-model',
        serviceTier: 'priority',
        vaultSecretName: 'vault-key',
      },
    })
    expect(getDefaultModelForProviderMock).not.toHaveBeenCalled()
  })

  it('falls back to the stored model preference before default resolution', async () => {
    const supabase = createResolverSupabase([
      {
        id: 'key-1',
        user_id: 'user-1',
        is_active: true,
        provider: 'anthropic',
        model_preference: 'stored-model',
        service_tier: 'standard',
        vault_secret_name: 'vault-key',
      },
    ])
    const { resolveActiveLlmConfigForUser } = await import('./llm-config-resolver')

    await expect(
      resolveActiveLlmConfigForUser({
        supabase: supabase as never,
        userId: 'user-1',
        apiKeyId: 'key-1',
      }),
    ).resolves.toMatchObject({
      status: 'success',
      config: expect.objectContaining({
        modelName: 'stored-model',
      }),
    })
    expect(getDefaultModelForProviderMock).not.toHaveBeenCalled()
  })

  it('uses lightweight default models when requested and no override exists', async () => {
    const supabase = createResolverSupabase([
      {
        id: 'key-1',
        user_id: 'user-1',
        is_active: true,
        provider: 'google',
        model_preference: '   ',
        service_tier: 'standard',
        vault_secret_name: 'vault-key',
      },
    ])
    const { resolveActiveLlmConfigForUser } = await import('./llm-config-resolver')

    await expect(
      resolveActiveLlmConfigForUser({
        supabase: supabase as never,
        userId: 'user-1',
        apiKeyId: 'key-1',
        defaultModelMode: 'lightweight',
      }),
    ).resolves.toMatchObject({
      status: 'success',
      config: expect.objectContaining({
        modelName: 'default-model',
      }),
    })
    expect(getDefaultModelForProviderMock).toHaveBeenCalledWith('google', { lightweight: true })
  })
})
