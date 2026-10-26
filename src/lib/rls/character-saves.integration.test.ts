import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { serverSupabaseRealtimeOptions } from '@/lib/supabase/server-realtime'
import type { Database } from '@/types/database.types'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY
const enabled = process.env.RLS_TESTS_ENABLED === 'true' && !!url && !!serviceKey && !!anonKey
type Client = SupabaseClient<Database>
type User = { id: string; client: Client }
let admin: Client
let anon: Client
let a: User
let b: User
let own: string
let foreign: string
let shared: string
let starter: string
let personaA: string
let personaB: string
const users: string[] = []
const cards: string[] = []

async function user(): Promise<User> {
  const email = 'save-' + randomUUID() + '@test.local'
  const password = 'Tmp-' + randomUUID() + '!aA'
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (result.error || !result.data.user) throw new Error('Could not create local test user')
  users.push(result.data.user.id)
  const client = createClient<Database>(url!, anonKey!, {
    ...serverSupabaseRealtimeOptions,
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  return { id: result.data.user.id, client }
}
async function card(owner: string | null, visibility: 'private' | 'public' = 'private') {
  const result = await admin
    .from('characters')
    .insert({
      user_id: owner,
      name: 'Save test card',
      system_prompt: 'Test',
      visibility,
    })
    .select('id')
    .single()
  if (result.error) throw result.error
  cards.push(result.data.id)
  return result.data.id
}
async function save(owner = a, characterId: string | null = own) {
  const result = await owner.client
    .from('character_saves')
    .insert({
      user_id: owner.id,
      character_id: characterId,
      title: 'Playthrough',
      content: 'A promise.',
      default_persona_id: owner.id === a.id ? personaA : personaB,
    })
    .select()
    .single()
  if (result.error) throw result.error
  return result.data
}
async function chat(saveId: string, characterId = own) {
  const result = await a.client
    .from('chats')
    .insert({
      user_id: a.id,
      character_id: characterId,
      save_id: saveId,
    })
    .select('id')
    .single()
  if (result.error) throw result.error
  return result.data.id
}

describe.skipIf(!enabled)('character saves: Data API isolation and lifecycle', () => {
  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!, serverSupabaseRealtimeOptions)
    anon = createClient<Database>(url!, anonKey!, serverSupabaseRealtimeOptions)
    a = await user()
    b = await user()
    own = await card(a.id)
    foreign = await card(b.id)
    shared = await card(b.id, 'public')
    starter = await card(null, 'public')
    const first = await a.client
      .from('personas')
      .insert({ user_id: a.id, name: 'A' })
      .select('id')
      .single()
    const second = await b.client
      .from('personas')
      .insert({ user_id: b.id, name: 'B' })
      .select('id')
      .single()
    if (first.error || second.error) throw new Error('Could not create test personas')
    personaA = first.data.id
    personaB = second.data.id
  }, 30_000)
  afterEach(async () => {
    if (!admin || !users.length) return
    await admin.from('chats').delete().in('user_id', users)
    await admin.from('character_saves').delete().in('user_id', users)
  })
  afterAll(async () => {
    if (!admin) return
    if (cards.length) await admin.from('characters').delete().in('id', cards)
    for (const id of users) await admin.auth.admin.deleteUser(id)
  })

  it('permits owner CRUD and hides saves from other users and anonymous callers', async () => {
    const row = await save()
    expect(
      (await a.client.from('character_saves').select('id').eq('id', row.id)).data,
    ).toHaveLength(1)
    expect((await b.client.from('character_saves').select('id').eq('id', row.id)).data).toEqual([])
    expect((await anon.from('character_saves').select('id')).error).toBeTruthy()
    expect(
      (
        await b.client
          .from('character_saves')
          .update({ content: 'Stolen' })
          .eq('id', row.id)
          .select()
      ).data,
    ).toEqual([])
    expect(
      (await b.client.from('character_saves').delete().eq('id', row.id).select()).data,
    ).toEqual([])
    const updated = await a.client
      .from('character_saves')
      .update({ content: 'New promise' })
      .eq('id', row.id)
      .select()
      .single()
    expect(updated.data?.content).toBe('New promise')
    expect(updated.error).toBeNull()
  })

  it('rejects forged ownership, foreign private cards, and foreign personas', async () => {
    expect(
      (await a.client.from('character_saves').insert({ user_id: b.id, title: 'Forged' })).error,
    ).toBeTruthy()
    expect(
      (
        await a.client
          .from('character_saves')
          .insert({ user_id: a.id, title: 'Private', character_id: foreign })
      ).error,
    ).toBeTruthy()
    expect(
      (
        await a.client
          .from('character_saves')
          .insert({ user_id: a.id, title: 'Foreign persona', default_persona_id: personaB })
      ).error,
    ).toBeTruthy()
    expect(
      (
        await admin
          .from('character_saves')
          .insert({ user_id: a.id, title: 'Server foreign persona', default_persona_id: personaB })
      ).error,
    ).toBeTruthy()
    const row = await save()
    expect(
      (
        await a.client
          .from('character_saves')
          .update({ default_persona_id: personaB })
          .eq('id', row.id)
      ).error,
    ).toBeTruthy()
    expect(
      (await a.client.from('character_saves').update({ user_id: b.id }).eq('id', row.id)).error,
    ).toBeTruthy()
  })

  it('supports independent saves on visible public and starter cards', async () => {
    const publicSave = await save(a, shared)
    const starterSave = await save(a, starter)
    const otherPlaythrough = await save(b, shared)
    expect(publicSave.character_id).toBe(shared)
    expect(starterSave.character_id).toBe(starter)
    expect(otherPlaythrough.id).not.toBe(publicSave.id)
  })

  it('checks save ownership and card compatibility for direct chat inserts and updates', async () => {
    const row = await save()
    const otherSave = await save(b, shared)
    expect(
      (
        await a.client
          .from('chats')
          .insert({ user_id: a.id, character_id: shared, save_id: otherSave.id })
      ).error,
    ).toBeTruthy()
    expect(
      (
        await a.client
          .from('chats')
          .insert({ user_id: a.id, character_id: shared, save_id: row.id })
      ).error,
    ).toBeTruthy()
    const id = await chat(row.id)
    expect(
      (await a.client.from('chats').update({ save_id: otherSave.id }).eq('id', id)).error,
    ).toBeTruthy()
    const detached = await a.client
      .from('chats')
      .update({ save_id: null })
      .eq('id', id)
      .select('save_id')
      .single()
    expect(detached.error).toBeNull()
    expect(detached.data?.save_id).toBeNull()
  })

  it('preserves canon after card deletion and allows relinking to another card', async () => {
    const disposable = await card(a.id)
    const row = await save(a, disposable)
    await admin.from('characters').delete().eq('id', disposable)
    const orphan = await a.client.from('character_saves').select().eq('id', row.id).single()
    expect(orphan.data?.character_id).toBeNull()
    expect(orphan.data?.content).toBe('A promise.')
    const relinked = await a.client
      .from('character_saves')
      .update({ character_id: own })
      .eq('id', row.id)
      .select()
      .single()
    expect(relinked.error).toBeNull()
    expect(relinked.data?.character_id).toBe(own)
  })

  it('preserves chats when a save is deleted and clears deleted default personas', async () => {
    const persona = await a.client
      .from('personas')
      .insert({ user_id: a.id, name: 'Temporary' })
      .select('id')
      .single()
    if (persona.error) throw persona.error
    const row = await save()
    await a.client
      .from('character_saves')
      .update({ default_persona_id: persona.data.id })
      .eq('id', row.id)
    const id = await chat(row.id)
    await a.client.from('personas').delete().eq('id', persona.data.id)
    expect(
      (
        await a.client
          .from('character_saves')
          .select('default_persona_id')
          .eq('id', row.id)
          .single()
      ).data?.default_persona_id,
    ).toBeNull()
    await a.client.from('character_saves').delete().eq('id', row.id)
    const remaining = await a.client.from('chats').select('save_id').eq('id', id).single()
    expect(remaining.error).toBeNull()
    expect(remaining.data?.save_id).toBeNull()
  })

  it('keeps historical attachments when a save is relinked', async () => {
    const row = await save()
    const id = await chat(row.id)
    await a.client.from('character_saves').update({ character_id: shared }).eq('id', row.id)
    const updated = await a.client
      .from('chats')
      .update({ title: 'Historical chat' })
      .eq('id', id)
      .select('save_id')
      .single()
    expect(updated.error).toBeNull()
    expect(updated.data?.save_id).toBe(row.id)
    expect(await chat(row.id, shared)).toBeTruthy()
  })

  it('enforces title and body limits while allowing an empty body', async () => {
    for (const content of ['', '가'.repeat(20_000)]) {
      const result = await a.client
        .from('character_saves')
        .insert({ user_id: a.id, title: 'Valid', content })
      expect(result.error).toBeNull()
    }
    for (const input of [
      { title: ' ' },
      { title: 'x'.repeat(101) },
      { title: 'Large', content: 'x'.repeat(20_001) },
    ]) {
      expect(
        (await a.client.from('character_saves').insert({ user_id: a.id, ...input })).error,
      ).toBeTruthy()
    }
  })
})
