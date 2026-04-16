import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const revalidatePathMock = vi.fn()
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

type DbError = { message: string; code?: string | null }
type RpcError = { message: string; code?: string | null; details?: string | null }

type MutationState = {
  insertPayloads: Array<Record<string, unknown>>
}

type ApiKeysSupabaseOptions = {
  user?: { id: string } | null
  insertApiKeyError?: DbError | null
}

function buildApiKeyFormData(
  overrides: Partial<{
    provider: string
    key_name: string
    api_key: string
    model_preference: string
    service_tier: string
    reasoning_effort: string
    omitProvider: boolean
    omitKeyName: boolean
    omitApiKey: boolean
    omitModelPreference: boolean
    omitServiceTier: boolean
    omitReasoningEffort: boolean
  }> = {},
) {
  const formData = new FormData()

  if (!overrides.omitProvider) {
    formData.set('provider', overrides.provider ?? 'google')
  }

  if (!overrides.omitKeyName) {
    formData.set('key_name', overrides.key_name ?? 'My API Key')
  }

  if (!overrides.omitApiKey) {
    formData.set('api_key', overrides.api_key ?? 'AIzaSyA1234567890abcdefghijklmnopqrstu')
  }

  if (!overrides.omitModelPreference) {
    formData.set('model_preference', overrides.model_preference ?? '')
  }

  if (!overrides.omitServiceTier) {
    formData.set('service_tier', overrides.service_tier ?? 'standard')
  }

  if (!overrides.omitReasoningEffort) {
    formData.set('reasoning_effort', overrides.reasoning_effort ?? 'none')
  }

  return formData
}

function buildSupabase(options: ApiKeysSupabaseOptions = {}) {
  const user =
    options.user === undefined ? { id: '11111111-1111-1111-1111-111111111111' } : options.user

  const state: MutationState = {
    insertPayloads: [],
  }

  return {
    state,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
    from(table: string) {
      if (table === 'api_keys') {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            state.insertPayloads.push(payload)
            return { error: options.insertApiKeyError ?? null }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

function createAdminSupabase(
  options: {
    createSecretError?: RpcError | null
    deleteSecretError?: RpcError | null
    deleteApiKeyError?: RpcError | null
  } = {},
) {
  return {
    rpc: vi.fn(
      async (
        fn: 'create_secret' | 'delete_secret' | 'delete_api_key',
        args: Record<string, unknown>,
      ): Promise<{ data: string | null; error: RpcError | null }> => {
        if (fn === 'create_secret') {
          return {
            data: typeof args.secret_name === 'string' ? args.secret_name : 'secret-name',
            error: options.createSecretError ?? null,
          }
        }

        if (fn === 'delete_api_key') {
          return {
            data: null,
            error: options.deleteApiKeyError ?? null,
          }
        }

        return {
          data: typeof args.secret_name === 'string' ? args.secret_name : 'secret-name',
          error: options.deleteSecretError ?? null,
        }
      },
    ),
  }
}

const INITIAL_STATE = {
  error: null,
  success: false,
  warning: null,
  rollbackFailed: false,
  cleanupReference: null,
}

describe('api key actions', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    createAdminClientMock.mockReset()
    revalidatePathMock.mockReset()
    consoleErrorSpy.mockClear()
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns login required when unauthenticated', async () => {
    createAdminClientMock.mockReturnValue(createAdminSupabase())
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { createApiKey } = await import('./actions')

    const result = await createApiKey(INITIAL_STATE, buildApiKeyFormData())

    expect(result).toEqual({
      error: '로그인이 필요합니다',
      success: false,
      warning: null,
      rollbackFailed: false,
      cleanupReference: null,
    })
  })

  it('returns a validation error before touching Vault when required fields are missing', async () => {
    const adminSupabase = createAdminSupabase()
    const supabase = buildSupabase()
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(supabase)
    const { createApiKey } = await import('./actions')

    const result = await createApiKey(
      INITIAL_STATE,
      buildApiKeyFormData({
        omitApiKey: true,
      }),
    )

    expect(result).toEqual({
      error: 'API 키를 입력해주세요.',
      success: false,
      warning: null,
      rollbackFailed: false,
      cleanupReference: null,
    })
    expect(adminSupabase.rpc).not.toHaveBeenCalled()
    expect(supabase.state.insertPayloads).toHaveLength(0)
  })

  it('rejects unknown providers during form parsing', async () => {
    const adminSupabase = createAdminSupabase()
    const supabase = buildSupabase()
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(supabase)
    const { createApiKey } = await import('./actions')

    const result = await createApiKey(
      INITIAL_STATE,
      buildApiKeyFormData({
        provider: 'not-a-provider',
      }),
    )

    expect(result).toEqual({
      error: 'Provider를 선택해주세요.',
      success: false,
      warning: null,
      rollbackFailed: false,
      cleanupReference: null,
    })
    expect(adminSupabase.rpc).not.toHaveBeenCalled()
    expect(supabase.state.insertPayloads).toHaveLength(0)
  })

  it('creates an OpenAI key with normalized values', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const adminSupabase = createAdminSupabase()
    const supabase = buildSupabase()
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(supabase)
    const { createApiKey } = await import('./actions')

    const result = await createApiKey(
      INITIAL_STATE,
      buildApiKeyFormData({
        provider: 'openai',
        key_name: '  Personal GPT Key  ',
        api_key: '  sk-1234567890abcdefghijklmn  ',
        model_preference: 'gpt-5',
        service_tier: ' FLEX ',
        reasoning_effort: ' HIGH ',
      }),
    )

    expect(result).toEqual({
      error: null,
      success: true,
      warning: null,
      rollbackFailed: false,
      cleanupReference: null,
    })
    expect(adminSupabase.rpc).toHaveBeenCalledWith('create_secret', {
      secret_name: 'apikey_11111111-1111-1111-1111-111111111111_loyw3v28_openai',
      secret_value: 'sk-1234567890abcdefghijklmn',
      requester: '11111111-1111-1111-1111-111111111111',
    })
    expect(supabase.state.insertPayloads).toEqual([
      {
        user_id: '11111111-1111-1111-1111-111111111111',
        provider: 'openai',
        key_name: 'Personal GPT Key',
        vault_secret_name: 'apikey_11111111-1111-1111-1111-111111111111_loyw3v28_openai',
        model_preference: 'gpt-5',
        service_tier: 'flex',
        reasoning_effort: 'high',
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/api-keys')
    dateNowSpy.mockRestore()
  })

  it('falls back to standard tier and null reasoning for non-openai providers', async () => {
    const adminSupabase = createAdminSupabase()
    const supabase = buildSupabase()
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(supabase)
    const { createApiKey } = await import('./actions')

    const result = await createApiKey(
      INITIAL_STATE,
      buildApiKeyFormData({
        provider: 'google',
        service_tier: 'priority',
        reasoning_effort: 'medium',
      }),
    )

    expect(result).toEqual({
      error: null,
      success: true,
      warning: null,
      rollbackFailed: false,
      cleanupReference: null,
    })
    expect(supabase.state.insertPayloads[0]).toMatchObject({
      provider: 'google',
      service_tier: 'standard',
      reasoning_effort: null,
    })
  })

  it('deletes the Vault secret when metadata persistence fails', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const adminSupabase = createAdminSupabase()
    const supabase = buildSupabase({
      insertApiKeyError: {
        message: 'insert failed',
        code: '23505',
      },
    })
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(supabase)
    const { createApiKey } = await import('./actions')

    const result = await createApiKey(INITIAL_STATE, buildApiKeyFormData())

    expect(result).toEqual({
      error: 'API 키 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      success: false,
      warning: null,
      rollbackFailed: false,
      cleanupReference: null,
    })
    expect(adminSupabase.rpc).toHaveBeenNthCalledWith(1, 'create_secret', {
      secret_name: 'apikey_11111111-1111-1111-1111-111111111111_loyw3v28_google',
      secret_value: 'AIzaSyA1234567890abcdefghijklmnopqrstu',
      requester: '11111111-1111-1111-1111-111111111111',
    })
    expect(adminSupabase.rpc).toHaveBeenNthCalledWith(2, 'delete_secret', {
      secret_name: 'apikey_11111111-1111-1111-1111-111111111111_loyw3v28_google',
      requester: '11111111-1111-1111-1111-111111111111',
    })
    dateNowSpy.mockRestore()
  })

  it('returns an explicit rollback failure signal when Vault cleanup fails after metadata persistence error', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const adminSupabase = createAdminSupabase({
      deleteSecretError: {
        message: 'vault unavailable',
        code: 'XX000',
      },
    })
    const supabase = buildSupabase({
      insertApiKeyError: {
        message: 'insert failed',
        code: '23505',
      },
    })
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(supabase)
    const { createApiKey } = await import('./actions')

    const result = await createApiKey(INITIAL_STATE, buildApiKeyFormData())

    expect(result).toEqual({
      error: 'API 키 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      success: false,
      warning:
        'API 키 등록에 실패했습니다. 다시 시도해주세요. 문제가 계속되면 관리자에게 참조 ID를 전달해주세요.',
      rollbackFailed: true,
      cleanupReference: 'api-key-cleanup-loyw3v28',
    })
    expect(adminSupabase.rpc).toHaveBeenNthCalledWith(2, 'delete_secret', {
      secret_name: 'apikey_11111111-1111-1111-1111-111111111111_loyw3v28_google',
      requester: '11111111-1111-1111-1111-111111111111',
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[API Keys] create_api_key rollback failed', {
      cleanupReference: 'api-key-cleanup-loyw3v28',
      userId: '11111111-1111-1111-1111-111111111111',
      provider: 'google',
      keyName: 'My API Key',
      vaultSecretName: 'apikey_11111111-1111-1111-1111-111111111111_loyw3v28_google',
      insertCode: '23505',
      insertMessage: 'insert failed',
      rollbackCode: 'XX000',
      rollbackMessage: 'vault unavailable',
    })
    expect(revalidatePathMock).not.toHaveBeenCalled()
    dateNowSpy.mockRestore()
  })

  it('returns login required when deleting an API key while unauthenticated', async () => {
    const adminSupabase = createAdminSupabase()
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { deleteApiKey } = await import('./actions')

    const result = await deleteApiKey('key-1')

    expect(result).toEqual({
      error: '로그인이 필요합니다',
    })
    expect(adminSupabase.rpc).not.toHaveBeenCalled()
  })

  it('deletes an API key through the transactional RPC boundary', async () => {
    const adminSupabase = createAdminSupabase()
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(buildSupabase())
    const { deleteApiKey } = await import('./actions')

    const result = await deleteApiKey('key-1')

    expect(result).toEqual({ success: true })
    expect(adminSupabase.rpc).toHaveBeenCalledWith('delete_api_key', {
      api_key_id: 'key-1',
      requester: '11111111-1111-1111-1111-111111111111',
    })
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/api-keys')
  })

  it('returns not found when the transactional delete reports a missing key', async () => {
    const adminSupabase = createAdminSupabase({
      deleteApiKeyError: {
        message: 'API key not found',
        code: 'P0002',
      },
    })
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(buildSupabase())
    const { deleteApiKey } = await import('./actions')

    const result = await deleteApiKey('missing-key')

    expect(result).toEqual({
      error: 'API 키를 찾을 수 없습니다',
    })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('returns a generic error when the transactional delete fails', async () => {
    const adminSupabase = createAdminSupabase({
      deleteApiKeyError: {
        message: 'vault unavailable',
        code: 'XX000',
      },
    })
    createAdminClientMock.mockReturnValue(adminSupabase)
    createClientMock.mockResolvedValue(buildSupabase())
    const { deleteApiKey } = await import('./actions')

    const result = await deleteApiKey('key-1')

    expect(result).toEqual({
      error: 'API 키 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[API Keys] delete_api_key failed', {
      code: 'XX000',
      message: 'vault unavailable',
    })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
