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

let adminClient: SupabaseClient<Database>
let authenticatedClient: SupabaseClient<Database>
let tempUserId: string | null = null
const serviceLabel = `test-service-health-${randomUUID()}`

describe.skipIf(shouldSkip)('Service health RPC boundary', () => {
  beforeAll(async () => {
    if (shouldSkip) return

    adminClient = createClient<Database>(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      ...serverSupabaseRealtimeOptions,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    authenticatedClient = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      ...serverSupabaseRealtimeOptions,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const email = `service-health-${randomUUID()}@example.com`
    const password = `Tmp-${randomUUID().slice(0, 8)}!aA`

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (error || !data.user) {
      throw new Error(
        `[Service health RPC test] Failed to create temp user: ${error?.message ?? 'Unknown error'}`,
      )
    }

    tempUserId = data.user.id

    const signIn = await authenticatedClient.auth.signInWithPassword({
      email,
      password,
    })

    if (signIn.error) {
      throw new Error(
        `[Service health RPC test] Failed to sign in temp user: ${signIn.error.message}`,
      )
    }
  })

  afterAll(async () => {
    if (shouldSkip) return

    await authenticatedClient?.auth.signOut().catch(() => undefined)

    await adminClient.from('service_health_status').delete().eq('service_label', serviceLabel)

    if (tempUserId) {
      await adminClient?.auth.admin.deleteUser(tempUserId).catch(() => undefined)
    }
  })

  it('denies record_service_health_status RPC for authenticated users before function execution', async () => {
    const result = await authenticatedClient.rpc('record_service_health_status', {
      p_service_label: serviceLabel,
      p_was_success: false,
      p_error_message: 'network down',
      p_metadata: { stage: 'test' },
    } as never)

    expect(result.error).toBeTruthy()
    expect(result.error?.message.toLowerCase()).toContain('permission denied')
  })

  it('allows record_service_health_status RPC for service role and persists the snapshot', async () => {
    const result = await adminClient.rpc('record_service_health_status', {
      p_service_label: serviceLabel,
      p_was_success: true,
      p_error_message: null,
      p_metadata: { stage: 'test', status: 202 },
    } as never)

    expect(result.error).toBeNull()

    const { data, error } = await adminClient
      .from('service_health_status')
      .select(
        'service_label, total_successes, total_failures, consecutive_failures, last_metadata, last_error_message',
      )
      .eq('service_label', serviceLabel)
      .single()

    expect(error).toBeNull()
    expect(data).toMatchObject({
      service_label: serviceLabel,
      total_successes: 1,
      total_failures: 0,
      consecutive_failures: 0,
      last_error_message: null,
      last_metadata: { stage: 'test', status: 202 },
    })
  })
})
