import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoistedMocks = vi.hoisted(() => ({
  buildLanguageModelMock: vi.fn(),
}))

vi.mock('@/lib/llm/model-factory', () => ({
  buildLanguageModel: hoistedMocks.buildLanguageModelMock,
}))

import { createLanguageModelFromSecretConfig } from './language-model-access'

type LanguageModelAccessClient = Parameters<
  typeof createLanguageModelFromSecretConfig
>[0]['supabase']

function createRpcClient(
  result:
    | unknown
    | (() => unknown | Promise<unknown>)
    | { data: unknown; error: unknown }
    | (() => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>),
) {
  const rpc = vi.fn(async () => {
    const value = typeof result === 'function' ? await result() : result
    if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
      return value as { data: unknown; error: unknown }
    }
    return { data: value, error: null }
  })

  return {
    client: { rpc } as unknown as LanguageModelAccessClient,
    rpc,
  }
}

describe('createLanguageModelFromSecretConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoistedMocks.buildLanguageModelMock.mockReturnValue({ id: 'mock-model' })
  })

  it('decrypts the secret and builds the configured model', async () => {
    const { client, rpc } = createRpcClient('sk-test')

    const model = await createLanguageModelFromSecretConfig({
      supabase: client,
      requester: 'user-1',
      config: {
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        serviceTier: 'standard',
        vaultSecretName: 'vault-key',
      },
      logPrefix: '[Test Access]',
    })

    expect(rpc).toHaveBeenCalledWith('get_decrypted_secret', {
      secret_name: 'vault-key',
      requester: 'user-1',
    })
    expect(hoistedMocks.buildLanguageModelMock).toHaveBeenCalledWith({
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      apiKey: 'sk-test',
      serviceTier: 'standard',
    })
    expect(model).toEqual({ id: 'mock-model' })
  })

  it('throws when vault decryption RPC fails', async () => {
    const { client } = createRpcClient({
      data: null,
      error: { message: 'vault down', code: 'PGRST001', details: null },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      createLanguageModelFromSecretConfig({
        supabase: client,
        requester: 'user-1',
        config: {
          provider: 'openai',
          modelName: 'gpt-4o-mini',
          serviceTier: 'standard',
          vaultSecretName: 'vault-key',
        },
        logPrefix: '[Test Access]',
      }),
    ).rejects.toThrow('Vault decryption failed')

    expect(hoistedMocks.buildLanguageModelMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('throws when vault returns an empty secret', async () => {
    const { client } = createRpcClient({ data: null, error: null })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      createLanguageModelFromSecretConfig({
        supabase: client,
        requester: 'user-1',
        config: {
          provider: 'openai',
          modelName: 'gpt-4o-mini',
          serviceTier: 'standard',
          vaultSecretName: 'vault-key',
        },
        logPrefix: '[Test Access]',
      }),
    ).rejects.toThrow('Vault returned empty secret')

    expect(hoistedMocks.buildLanguageModelMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
