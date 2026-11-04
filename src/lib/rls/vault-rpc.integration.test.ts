import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverSupabaseRealtimeOptions } from '@/lib/supabase/server-realtime'
import type { Database } from '@/types/database.types'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const RLS_TESTS_ENABLED = process.env.RLS_TESTS_ENABLED === 'true'

const shouldSkip =
  !RLS_TESTS_ENABLED || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY

type TestUser = {
  id: string
  email: string
  client: SupabaseClient<Database>
}

let adminClient: SupabaseClient<Database>
const createdUserIds: string[] = []
let userA: TestUser
let userB: TestUser

async function createTestUser(label: string): Promise<TestUser> {
  const email = `vault-rpc-${label}-${randomUUID()}@test.local`
  const password = `Tmp-${randomUUID().slice(0, 8)}!aA`

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    throw new Error(`Failed to create test user: ${authError?.message ?? 'unknown error'}`)
  }

  createdUserIds.push(authData.user.id)

  const userClient = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    ...serverSupabaseRealtimeOptions,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const signIn = await userClient.auth.signInWithPassword({
    email,
    password,
  })

  if (signIn.error) {
    throw new Error(`Failed to sign in test user: ${signIn.error.message}`)
  }

  return {
    id: authData.user.id,
    email,
    client: userClient,
  }
}

async function cleanupUsers(): Promise<void> {
  for (const userId of createdUserIds) {
    await adminClient.from('messages').delete().eq('user_id', userId)
    await adminClient.from('chats').delete().eq('user_id', userId)
    await adminClient.from('api_keys').delete().eq('user_id', userId)
    await adminClient.from('characters').delete().eq('user_id', userId)
    await adminClient.from('profiles').delete().eq('id', userId)
    await adminClient.auth.admin.deleteUser(userId)
  }

  createdUserIds.length = 0
}

describe.skipIf(shouldSkip)('Vault helper RPC boundary', () => {
  beforeAll(async () => {
    if (shouldSkip) return

    adminClient = createClient<Database>(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      ...serverSupabaseRealtimeOptions,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    userA = await createTestUser('user-a')
    userB = await createTestUser('user-b')
  })

  afterAll(async () => {
    if (shouldSkip) return

    await userA?.client.auth.signOut().catch(() => undefined)
    await userB?.client.auth.signOut().catch(() => undefined)
    await cleanupUsers()
  })

  it('denies create_secret RPC for authenticated users', async () => {
    const result = await userA.client.rpc('create_secret', {
      secret_name: `apikey_${userA.id}_fixture_openai`,
      secret_value: 'test-secret-value',
      requester: userA.id,
    } as never)

    expect(result.error).toBeTruthy()
    expect(result.error?.message.toLowerCase()).toContain('permission denied')
  })

  it('denies delete_secret RPC for authenticated users', async () => {
    const result = await userA.client.rpc('delete_secret', {
      secret_name: `apikey_${userA.id}_fixture_openai`,
      requester: userA.id,
    } as never)

    expect(result.error).toBeTruthy()
    expect(result.error?.message.toLowerCase()).toContain('permission denied')
  })

  it('rejects service-role create_secret when the name prefix does not match the requester', async () => {
    const result = await adminClient.rpc('create_secret', {
      secret_name: `apikey_${userB.id}_fixture_openai`,
      secret_value: 'test-secret-value',
      requester: userA.id,
    } as never)

    expect(result.error).toBeTruthy()
    expect(result.error?.message.toLowerCase()).toContain('not authorized')
  })

  it('allows service-role create_secret and delete_secret for canonical requester-bound names', async () => {
    const secretName = `apikey_${userA.id}_fixture_${Date.now().toString(36)}_openai`

    const createResult = await adminClient.rpc('create_secret', {
      secret_name: secretName,
      secret_value: 'test-secret-value',
      requester: userA.id,
    } as never)

    expect(createResult.error).toBeNull()
    expect(createResult.data).toBeTruthy()

    const deleteResult = await adminClient.rpc('delete_secret', {
      secret_name: secretName,
      requester: userA.id,
    } as never)

    expect(deleteResult.error).toBeNull()
  })

  it('keeps an unbound Vault secret in its owner namespace through registration and deletion', async () => {
    const secretA = `apikey_${userA.id}_own_openai`
    const secretB = `apikey_${userB.id}_own_openai`
    const dummyA = 'local-dummy-a'
    const dummyB = 'local-dummy-b'

    async function createSecretFor(user: TestUser, name: string, value: string) {
      const result = await adminClient.rpc('create_secret', {
        secret_name: name,
        secret_value: value,
        requester: user.id,
      } as never)
      expect(result.error).toBeNull()
    }

    async function register(user: TestUser, name: string) {
      return await user.client
        .from('api_keys')
        .insert({
          user_id: user.id,
          key_name: 'Vault ownership fixture',
          provider: 'openai',
          vault_secret_name: name,
        })
        .select('id')
        .single()
    }

    async function decrypt(user: TestUser, name: string) {
      return await adminClient.rpc('get_decrypted_secret', {
        secret_name: name,
        requester: user.id,
      })
    }

    try {
      await createSecretFor(userA, secretA, dummyA)
      await createSecretFor(userB, secretB, dummyB)

      const keyA = await register(userA, secretA)
      expect(keyA.error).toBeNull()
      expect((await decrypt(userA, secretA)).data).toBe(dummyA)

      // B's secret has no api_keys row yet. A cannot claim it through either write path.
      const foreignInsert = await register(userA, secretB)
      expect(foreignInsert.status).toBe(403)
      expect(foreignInsert.error?.code).toBe('42501')

      const foreignUpdate = await userA.client
        .from('api_keys')
        .update({ vault_secret_name: secretB })
        .eq('id', keyA.data!.id)
      expect(foreignUpdate.status).toBe(403)
      expect(foreignUpdate.error?.code).toBe('42501')
      expect((await decrypt(userA, secretB)).error?.code).toBe('42501')

      const legacyName = `apikey_${userA.id.replaceAll('-', '').slice(0, 12)}_new_openai`
      const newLegacyBinding = await userA.client
        .from('api_keys')
        .update({ vault_secret_name: legacyName })
        .eq('id', keyA.data!.id)
      expect(newLegacyBinding.error?.code).toBe('42501')

      const keyB = await register(userB, secretB)
      expect(keyB.error).toBeNull()
      expect((await decrypt(userB, secretB)).data).toBe(dummyB)

      const unauthorizedDecrypt = await userA.client.rpc('get_decrypted_secret', {
        secret_name: secretB,
        requester: userB.id,
      })
      expect(unauthorizedDecrypt.status).toBe(403)

      const unauthorizedDelete = await userA.client.rpc('delete_api_key', {
        api_key_id: keyB.data!.id,
      })
      expect(unauthorizedDelete.error?.code).toBe('P0002')

      const spoofedRequester = await userA.client.rpc('delete_api_key', {
        api_key_id: keyB.data!.id,
        requester: userB.id,
      })
      expect(spoofedRequester.status).toBe(403)
      expect((await decrypt(userB, secretB)).data).toBe(dummyB)

      const ownerDelete = await userA.client.rpc('delete_api_key', {
        api_key_id: keyA.data!.id,
      })
      expect(ownerDelete.error).toBeNull()
      expect(
        (await userA.client.from('api_keys').select('id').eq('id', keyA.data!.id)).data,
      ).toEqual([])
      const deletedSecret = await adminClient.rpc('delete_secret', {
        secret_name: secretA,
        requester: userA.id,
      } as never)
      expect(deletedSecret.error?.code).toBe('P0002')

      const serverDelete = await adminClient.rpc('delete_api_key', {
        api_key_id: keyB.data!.id,
        requester: userB.id,
      })
      expect(serverDelete.error).toBeNull()
      const deletedBSecret = await adminClient.rpc('delete_secret', {
        secret_name: secretB,
        requester: userB.id,
      } as never)
      expect(deletedBSecret.error?.code).toBe('P0002')
    } finally {
      await adminClient.rpc('delete_secret', { secret_name: secretA, requester: userA.id } as never)
      await adminClient.rpc('delete_secret', { secret_name: secretB, requester: userB.id } as never)
    }
  })
})
