import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '@/types/database.types'

const url = process.env.SUPABASE_URL ?? ''
const enabled = process.env.RLS_TESTS_ENABLED === 'true'
const ids: string[] = []
const jobs: string[] = []
const make = (key: string) =>
  createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
let admin: ReturnType<typeof make>
let anon: ReturnType<typeof make>
let owner: string
let other: string
let localJob: string
let cloudJob: string

describe.skipIf(!enabled)('local worker DB boundary (synthetic local DB only)', () => {
  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
      throw new Error('Local DB required')
    admin = make(process.env.SUPABASE_SERVICE_ROLE_KEY!)
    anon = make(process.env.SUPABASE_ANON_KEY!)
    for (let i = 0; i < 2; i++) {
      const { data, error } = await admin.auth.admin.createUser({
        email: 'worker-' + randomUUID() + '@test.local',
        password: randomUUID(),
        email_confirm: true,
      })
      expect(error).toBeNull()
      ids.push(data.user!.id)
    }
    ;[owner, other] = ids
    for (const [user, provider] of [
      [owner, 'local'],
      [other, 'local'],
      [owner, 'google'],
    ] as const) {
      const c = await admin
        .from('characters')
        .insert({
          user_id: user,
          name: 'Synthetic worker fixture',
          system_prompt: 'Fictional fixture',
          visibility: 'private',
        })
        .select('id')
        .single()
      expect(c.error).toBeNull()
      const chat = await admin
        .from('chats')
        .insert({ user_id: user, character_id: c.data!.id, title: 'Synthetic' })
        .select('id')
        .single()
      expect(chat.error).toBeNull()
      const key = await admin
        .from('api_keys')
        .insert({
          user_id: user,
          provider,
          key_name: 'Synthetic-' + provider,
          vault_secret_name: 'synthetic-no-secret-' + randomUUID(),
        })
        .select('id')
        .single()
      expect(key.error).toBeNull()
      const job = await admin
        .from('chat_generation_jobs')
        .insert({
          user_id: user,
          chat_id: chat.data!.id,
          status: 'pending',
          created_at: '1900-01-01T00:00:00Z',
          payload: { provider, apiKeyId: key.data!.id, userId: user, chatId: chat.data!.id },
        })
        .select('id')
        .single()
      expect(job.error).toBeNull()
      jobs.push(job.data!.id)
      if (user === owner && provider === 'local') localJob = job.data!.id
      if (provider === 'google') cloudJob = job.data!.id
    }
  })
  afterAll(async () => {
    if (jobs.length) await admin.from('chat_generation_jobs').delete().in('id', jobs)
    for (const id of ids) await admin.auth.admin.deleteUser(id)
  })
  it('denies unprivileged claim and heartbeat mutation', async () => {
    expect(
      (await anon.rpc('claim_pending_local_chat_job', { p_owner: owner })).error,
    ).not.toBeNull()
    expect(
      (await anon.from('local_chat_worker_status').upsert({ user_id: owner })).error,
    ).not.toBeNull()
  })
  it('cloud claims never take local work', async () => {
    const result = await admin.rpc('claim_pending_chat_job')
    expect(result.error).toBeNull()
    expect(result.data?.map((job) => job.id)).toEqual([cloudJob])
    expect(
      (await admin.from('chat_generation_jobs').select('status').eq('id', localJob).single()).data
        ?.status,
    ).toBe('pending')
  })
  it('only the bound owner is claimed and concurrent claim is unique', async () => {
    const results = await Promise.all([
      admin.rpc('claim_pending_local_chat_job', { p_owner: owner }),
      admin.rpc('claim_pending_local_chat_job', { p_owner: owner }),
    ])
    for (const r of results) expect(r.error).toBeNull()
    expect(results.flatMap((r) => r.data ?? []).map((r) => r.id)).toEqual([localJob])
    const foreign = await admin
      .from('chat_generation_jobs')
      .select('status')
      .eq('user_id', other)
      .single()
    expect(foreign.data?.status).toBe('pending')
  })
})
