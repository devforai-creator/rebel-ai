import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { serverSupabaseRealtimeOptions } from '@/lib/supabase/server-realtime'
import type { Database } from '@/types/database.types'

import 'dotenv/config'

const requiredEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
}

const missingKeys = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missingKeys.length > 0) {
  describe.skip('Vault RPC security', () => {
    it.skip(`skipped because missing env: ${missingKeys.join(', ')}`, () => {
      expect(true).toBe(true)
    })
  })
} else {
  const supabaseUrl = requiredEnv.NEXT_PUBLIC_SUPABASE_URL as string
  const anonKey = requiredEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
  const serviceRoleKey = requiredEnv.SUPABASE_SERVICE_ROLE_KEY as string

  describe('Vault RPC security', () => {
    let adminClient: SupabaseClient<Database>
    let authenticatedClient: SupabaseClient<Database>
    let tempUserId: string | null = null
    const tempEmail = `vault-test-${randomUUID()}@example.com`
    const tempPassword = `Tmp-${randomUUID().slice(0, 8)}!aA`

    beforeAll(async () => {
      adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
        ...serverSupabaseRealtimeOptions,
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })

      authenticatedClient = createClient<Database>(supabaseUrl, anonKey, {
        ...serverSupabaseRealtimeOptions,
      })

      const { data, error } = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: tempPassword,
        email_confirm: true,
      })

      if (error || !data.user) {
        throw new Error(
          `[Vault RPC test] Failed to create temp user: ${error?.message ?? 'Unknown error'}`,
        )
      }

      tempUserId = data.user.id

      const signIn = await authenticatedClient.auth.signInWithPassword({
        email: tempEmail,
        password: tempPassword,
      })

      if (signIn.error) {
        throw new Error(`[Vault RPC test] Failed to sign in temp user: ${signIn.error.message}`)
      }
    }, 20_000)

    afterAll(async () => {
      await authenticatedClient?.auth.signOut().catch(() => undefined)

      if (tempUserId) {
        await adminClient?.auth.admin.deleteUser(tempUserId).catch(() => undefined)
      }
    })

    it('denies get_decrypted_secret RPC for authenticated users', async () => {
      // Type assertion required because supabase-js client in this test context
      // cannot infer typed RPC arguments when instantiated outside Next.js runtime.
      const result = await authenticatedClient.rpc('get_decrypted_secret', {
        secret_name: `api_key_${randomUUID()}`,
        requester: tempUserId,
      } as never)

      expect(result.error).toBeTruthy()
      expect(result.error?.message.toLowerCase()).toContain('permission denied')
    }, 20_000)
  })
}
