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

type DbError = { message: string }

type ApiKeyRow = {
  id: string
  provider: string
  is_active: boolean
}

type AccountSupabaseOptions = {
  user?: { id: string } | null
  apiKeys?: ApiKeyRow[]
  profileUpdateError?: DbError | null
  updateUserError?: DbError | null
}

type UpdateCall = {
  table: 'profiles'
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

type AccountDeleteSupabaseOptions = {
  user?: { id: string } | null
  apiKeys?: Array<{ vault_secret_name: string | null }>
  characterAssetPaths?: string[]
  moduleAssetPaths?: string[]
  importUploadPaths?: string[]
  queryErrors?: {
    apiKeys?: DbError | null
    characterAssets?: DbError | null
    moduleAssets?: DbError | null
    importJobs?: DbError | null
  }
  signOutError?: DbError | null
}

type AccountDeleteAdminOptions = {
  deleteUserError?: DbError | null
  deleteSecretErrors?: Record<string, DbError | null>
}

function buildFormData(entries: Record<string, string | undefined>) {
  const formData = new FormData()

  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      formData.set(key, value)
    }
  }

  return formData
}

function createThenableMutation(
  commit: (
    filters: Array<[string, unknown]>,
  ) => { error: DbError | null } | Promise<{ error: DbError | null }>,
) {
  const filters: Array<[string, unknown]> = []
  let settled = false

  const builder = {
    eq(field: string, value: unknown) {
      filters.push([field, value])
      return builder
    },
    then<TResult1 = { error: DbError | null }, TResult2 = never>(
      onfulfilled?: ((value: { error: DbError | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (settled) {
        return Promise.resolve({ error: null }).then(onfulfilled, onrejected)
      }

      settled = true
      return Promise.resolve(commit([...filters])).then(onfulfilled, onrejected)
    },
  }

  return builder
}

function createThenableQuery<T>(
  resolve: (
    filters: Array<[string, unknown]>,
  ) => { data: T; error: DbError | null } | Promise<{ data: T; error: DbError | null }>,
) {
  const filters: Array<[string, unknown]> = []
  let settled = false

  const builder = {
    eq(field: string, value: unknown) {
      filters.push([field, value])
      return builder
    },
    then<TResult1 = { data: T; error: DbError | null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: T; error: DbError | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (settled) {
        return Promise.resolve({ data: [] as T, error: null }).then(onfulfilled, onrejected)
      }

      settled = true
      return Promise.resolve(resolve([...filters])).then(onfulfilled, onrejected)
    },
  }

  return builder
}

function buildSupabase(options: AccountSupabaseOptions = {}) {
  const user = options.user === undefined ? { id: 'user-1' } : options.user
  const userId = user?.id ?? 'user-1'
  const apiKeys = options.apiKeys ?? [
    { id: 'voyage-key', provider: 'voyage_embeddings', is_active: true },
    { id: 'llm-key', provider: 'openai', is_active: true },
  ]

  const state = {
    profileUpdateCalls: [] as UpdateCall[],
  }

  return {
    state,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
      updateUser: vi.fn().mockResolvedValue({
        error: options.updateUserError ?? null,
      }),
    },
    from(table: string) {
      if (table === 'api_keys') {
        const filters: Array<[string, unknown]> = []

        const builder = {
          select() {
            return builder
          },
          eq(field: string, value: unknown) {
            filters.push([field, value])
            return builder
          },
          async single() {
            const key = apiKeys.find(
              (item) =>
                item.id === filters.find(([field]) => field === 'id')?.[1] &&
                userId === filters.find(([field]) => field === 'user_id')?.[1],
            )

            return {
              data: key ?? null,
              error: key ? null : { message: 'not found' },
            }
          },
          async maybeSingle() {
            const key = apiKeys.find(
              (item) =>
                item.id === filters.find(([field]) => field === 'id')?.[1] &&
                userId === filters.find(([field]) => field === 'user_id')?.[1],
            )

            return {
              data: key ?? null,
              error: null,
            }
          },
        }

        return builder
      }

      if (table === 'profiles') {
        return {
          update(payload: Record<string, unknown>) {
            return createThenableMutation((filters) => {
              state.profileUpdateCalls.push({
                table: 'profiles',
                payload,
                filters,
              })

              return {
                error: options.profileUpdateError ?? null,
              }
            })
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

function buildDeleteAccountSupabase(options: AccountDeleteSupabaseOptions = {}) {
  const user = options.user === undefined ? { id: 'user-1' } : options.user
  const state = {
    signOutCalls: 0,
  }

  return {
    state,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'No session' },
      }),
      signOut: vi.fn().mockImplementation(async () => {
        state.signOutCalls += 1
        return { error: options.signOutError ?? null }
      }),
    },
    from(table: string) {
      if (table === 'api_keys') {
        return {
          select() {
            return createThenableQuery((filters) => {
              if (options.queryErrors?.apiKeys) {
                return { data: null as never, error: options.queryErrors.apiKeys }
              }

              const targetUserId = filters.find(([field]) => field === 'user_id')?.[1]
              const rows = targetUserId === user?.id ? (options.apiKeys ?? []) : []
              return { data: rows, error: null }
            })
          },
        }
      }

      if (table === 'character_assets') {
        return {
          select() {
            return createThenableQuery((filters) => {
              if (options.queryErrors?.characterAssets) {
                return { data: null as never, error: options.queryErrors.characterAssets }
              }

              const targetUserId = filters.find(([field]) => field === 'user_id')?.[1]
              const rows =
                targetUserId === user?.id
                  ? (options.characterAssetPaths ?? []).map((storage_path) => ({ storage_path }))
                  : []
              return { data: rows, error: null }
            })
          },
        }
      }

      if (table === 'module_assets') {
        return {
          select() {
            return createThenableQuery((filters) => {
              if (options.queryErrors?.moduleAssets) {
                return { data: null as never, error: options.queryErrors.moduleAssets }
              }

              const targetUserId = filters.find(([field]) => field === 'user_id')?.[1]
              const rows =
                targetUserId === user?.id
                  ? (options.moduleAssetPaths ?? []).map((storage_path) => ({ storage_path }))
                  : []
              return { data: rows, error: null }
            })
          },
        }
      }

      if (table === 'charx_import_jobs') {
        return {
          select() {
            return createThenableQuery((filters) => {
              if (options.queryErrors?.importJobs) {
                return { data: null as never, error: options.queryErrors.importJobs }
              }

              const targetUserId = filters.find(([field]) => field === 'user_id')?.[1]
              const rows =
                targetUserId === user?.id
                  ? (options.importUploadPaths ?? []).map((storage_path) => ({ storage_path }))
                  : []
              return { data: rows, error: null }
            })
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

function buildDeleteAccountAdmin(options: AccountDeleteAdminOptions = {}) {
  const state = {
    events: [] as string[],
    deleteSecretCalls: [] as string[],
    storageRemoveCalls: [] as Array<{ bucket: string; paths: string[] }>,
  }

  return {
    state,
    auth: {
      admin: {
        deleteUser: vi.fn(async (userId: string) => {
          state.events.push(`deleteUser:${userId}`)
          return { error: options.deleteUserError ?? null }
        }),
      },
    },
    rpc: vi.fn(async (name: string, params?: { secret_name?: string }) => {
      if (name !== 'delete_secret') {
        throw new Error(`Unexpected rpc: ${name}`)
      }

      const secretName = params?.secret_name ?? ''
      state.events.push(`delete_secret:${secretName}`)
      state.deleteSecretCalls.push(secretName)

      return {
        data: null,
        error: options.deleteSecretErrors?.[secretName] ?? null,
      }
    }),
    storage: {
      from: vi.fn((bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          state.events.push(`remove:${bucket}`)
          state.storageRemoveCalls.push({ bucket, paths })
          return { data: [], error: null }
        }),
      })),
    },
  }
}

describe('account actions', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    createAdminClientMock.mockReset()
    revalidatePathMock.mockReset()
    consoleErrorSpy.mockClear()
    createAdminClientMock.mockReturnValue({
      auth: { admin: { deleteUser: vi.fn() } },
    })
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns login required for account actions when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { updateRagSettings } = await import('./actions')

    const result = await updateRagSettings(
      { error: null, success: false },
      buildFormData({
        enable_rag: 'false',
        voyage_key_id: '',
      }),
    )

    expect(result).toEqual({ error: 'Login required.', success: false })
  })

  it('updates RAG settings with a validated voyage key', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { updateRagSettings } = await import('./actions')

    const result = await updateRagSettings(
      { error: null, success: false },
      buildFormData({
        enable_rag: 'true',
        voyage_key_id: '  voyage-key  ',
      }),
    )

    expect(result).toEqual({ error: null, success: true })
    expect(supabase.state.profileUpdateCalls).toEqual([
      {
        table: 'profiles',
        payload: {
          enable_episodic_rag: true,
          voyage_embedding_api_key_id: 'voyage-key',
        },
        filters: [['id', 'user-1']],
      },
    ])
  })

  it('normalizes blank summary model selection to null', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { updateSummaryModelPreference } = await import('./actions')

    const result = await updateSummaryModelPreference(
      { error: null, success: false },
      buildFormData({
        summary_key_id: '   ',
      }),
    )

    expect(result).toEqual({ error: null, success: true })
    expect(supabase.state.profileUpdateCalls).toEqual([
      {
        table: 'profiles',
        payload: {
          summary_api_key_id: null,
        },
        filters: [['id', 'user-1']],
      },
    ])
  })

  it('normalizes reprocess settings before saving', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { updateReprocessSettings } = await import('./actions')

    const result = await updateReprocessSettings(
      { error: null, success: false },
      buildFormData({
        reprocess_prompt: '  Rewrite this naturally.  ',
        reprocess_key_id: '  llm-key  ',
      }),
    )

    expect(result).toEqual({ error: null, success: true })
    expect(supabase.state.profileUpdateCalls).toEqual([
      {
        table: 'profiles',
        payload: {
          reprocess_prompt: 'Rewrite this naturally.',
          reprocess_api_key_id: 'llm-key',
        },
        filters: [['id', 'user-1']],
      },
    ])
  })

  it('normalizes blank translation model selection to null', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { updateTranslationModelPreference } = await import('./actions')

    const result = await updateTranslationModelPreference(
      { error: null, success: false },
      buildFormData({
        translation_key_id: '',
      }),
    )

    expect(result).toEqual({ error: null, success: true })
    expect(supabase.state.profileUpdateCalls).toEqual([
      {
        table: 'profiles',
        payload: {
          translation_api_key_id: null,
        },
        filters: [['id', 'user-1']],
      },
    ])
  })

  it('returns a validation error when the password field is missing', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { changePassword } = await import('./actions')

    const result = await changePassword(new FormData())

    expect(result).toEqual({ error: 'Password must be at least 6 characters.' })
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
  })

  it('updates the password when the form is valid', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { changePassword } = await import('./actions')

    const result = await changePassword(
      buildFormData({
        new_password: 'updated-password',
      }),
    )

    expect(result).toEqual({ success: true })
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      password: 'updated-password',
    })
  })

  it('does not clean up storage or vault secrets when deleteUser fails', async () => {
    const supabase = buildDeleteAccountSupabase({
      apiKeys: [{ vault_secret_name: 'secret-1' }],
      characterAssetPaths: ['user-1/char-1/a.webp'],
      moduleAssetPaths: ['user-1/mod-1/a.webp'],
      importUploadPaths: ['user-1/imports/a.rbx'],
    })
    const admin = buildDeleteAccountAdmin({
      deleteUserError: { message: 'delete user failed' },
    })
    createClientMock.mockResolvedValue(supabase)
    createAdminClientMock.mockReturnValue(admin)
    const { deleteAccount } = await import('./actions')

    const result = await deleteAccount()

    expect(result).toEqual({
      error: 'An error occurred while deleting account. Please try again later.',
    })
    expect(admin.state.events).toEqual(['deleteUser:user-1'])
    expect(admin.state.storageRemoveCalls).toEqual([])
    expect(admin.state.deleteSecretCalls).toEqual([])
    expect(supabase.auth.signOut).not.toHaveBeenCalled()
  })

  it('deletes storage objects and vault secrets only after deleteUser succeeds', async () => {
    const supabase = buildDeleteAccountSupabase({
      apiKeys: [{ vault_secret_name: 'secret-1' }, { vault_secret_name: 'secret-2' }],
      characterAssetPaths: ['user-1/char-1/a.webp', 'user-1/char-1/b.png'],
      moduleAssetPaths: ['user-1/mod-1/module.webp'],
      importUploadPaths: ['user-1/imports/a.rbx'],
    })
    const admin = buildDeleteAccountAdmin()
    createClientMock.mockResolvedValue(supabase)
    createAdminClientMock.mockReturnValue(admin)
    const { deleteAccount } = await import('./actions')

    const result = await deleteAccount()

    expect(result).toEqual({ success: true })
    expect(admin.state.events).toEqual([
      'deleteUser:user-1',
      'remove:character-assets',
      'remove:module-assets',
      'remove:charx-uploads',
      'delete_secret:secret-1',
      'delete_secret:secret-2',
    ])
    expect(admin.state.storageRemoveCalls).toEqual([
      {
        bucket: 'character-assets',
        paths: ['user-1/char-1/a.webp', 'user-1/char-1/b.png'],
      },
      {
        bucket: 'module-assets',
        paths: ['user-1/mod-1/module.webp'],
      },
      {
        bucket: 'charx-uploads',
        paths: ['user-1/imports/a.rbx'],
      },
    ])
    expect(admin.state.deleteSecretCalls).toEqual(['secret-1', 'secret-2'])
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1)
  })
})
