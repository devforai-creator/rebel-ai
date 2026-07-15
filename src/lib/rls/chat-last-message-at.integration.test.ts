import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
  client: SupabaseClient<Database>
}

type MessageRole = 'user' | 'assistant' | 'system'

const createdUserIds: string[] = []
const createdCharacterIds: string[] = []
const createdChatIds: string[] = []

let adminClient: SupabaseClient<Database>
let userA: TestUser
let userB: TestUser
let characterAId: string
let characterBId: string

async function createTestUser(label: string): Promise<TestUser> {
  const email = `chat-recency-${label}-${randomUUID()}@test.local`
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

  const client = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    ...serverSupabaseRealtimeOptions,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { error: signInError } = await client.auth.signInWithPassword({ email, password })

  if (signInError) {
    throw new Error(`Failed to sign in test user: ${signInError.message}`)
  }

  return { id: authData.user.id, client }
}

async function createCharacter(userId: string, label: string): Promise<string> {
  const { data, error } = await adminClient
    .from('characters')
    .insert({
      user_id: userId,
      name: `Chat Recency ${label}`,
      visibility: 'private',
      system_prompt: 'Test prompt',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create character: ${error?.message ?? 'unknown error'}`)
  }

  createdCharacterIds.push(data.id)
  return data.id
}

async function createChat(userId: string, characterId: string, label: string): Promise<string> {
  const { data, error } = await adminClient
    .from('chats')
    .insert({
      user_id: userId,
      character_id: characterId,
      title: `Chat Recency ${label}`,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create chat: ${error?.message ?? 'unknown error'}`)
  }

  createdChatIds.push(data.id)
  return data.id
}

async function createMessage(
  user: TestUser,
  chatId: string,
  role: MessageRole,
  createdAt: string,
): Promise<string> {
  const { data, error } = await user.client
    .from('messages')
    .insert({
      id: randomUUID(),
      chat_id: chatId,
      user_id: user.id,
      role,
      content: `${role} message at ${createdAt}`,
      created_at: createdAt,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create message: ${error?.message ?? 'unknown error'}`)
  }

  return data.id
}

async function expectLastMessageAt(chatId: string, expected: string | null): Promise<void> {
  const { data, error } = await adminClient
    .from('chats')
    .select('last_message_at')
    .eq('id', chatId)
    .single()

  expect(error).toBeNull()
  expect(data).not.toBeNull()

  const actual = data?.last_message_at ? new Date(data.last_message_at).toISOString() : null
  expect(actual).toBe(expected)
}

async function cleanupChats(): Promise<void> {
  while (createdChatIds.length > 0) {
    const chatId = createdChatIds.pop()
    if (!chatId) continue

    const { error } = await adminClient.from('chats').delete().eq('id', chatId)
    if (error) throw new Error(`Failed to clean up chat: ${error.message}`)
  }
}

async function cleanupUsers(): Promise<void> {
  for (const userId of createdUserIds) {
    await adminClient.from('messages').delete().eq('user_id', userId)
    await adminClient.from('chats').delete().eq('user_id', userId)
    await adminClient.from('characters').delete().eq('user_id', userId)
    await adminClient.from('profiles').delete().eq('id', userId)
    await adminClient.auth.admin.deleteUser(userId)
  }

  createdUserIds.length = 0
}

describe.skipIf(shouldSkip)('chat last_message_at integration', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase service credentials for RLS integration tests')
    }

    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      ...serverSupabaseRealtimeOptions,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    userA = await createTestUser('user-a')
    userB = await createTestUser('user-b')
    characterAId = await createCharacter(userA.id, 'Character A')
    characterBId = await createCharacter(userB.id, 'Character B')
  })

  afterEach(async () => {
    await cleanupChats()
  })

  afterAll(async () => {
    await cleanupChats()
    await userA?.client.auth.signOut().catch(() => undefined)
    await userB?.client.auth.signOut().catch(() => undefined)

    for (const characterId of createdCharacterIds) {
      await adminClient.from('characters').delete().eq('id', characterId)
    }

    createdCharacterIds.length = 0
    await cleanupUsers()
  })

  it('tracks the maximum eligible message time across inserts and deletes', async () => {
    const chatId = await createChat(userA.id, characterAId, 'Insert Delete')
    const older = '2026-01-01T10:00:00.000Z'
    const current = '2026-01-01T10:05:00.000Z'
    const newest = '2026-01-01T10:10:00.000Z'

    await expectLastMessageAt(chatId, null)

    await createMessage(userA, chatId, 'system', '2026-01-01T12:00:00.000Z')
    await expectLastMessageAt(chatId, null)

    const currentMessageId = await createMessage(userA, chatId, 'user', current)
    await expectLastMessageAt(chatId, current)

    const olderMessageId = await createMessage(userA, chatId, 'assistant', older)
    await expectLastMessageAt(chatId, current)

    const newestMessageId = await createMessage(userA, chatId, 'assistant', newest)
    await expectLastMessageAt(chatId, newest)

    const newestDelete = await userA.client.from('messages').delete().eq('id', newestMessageId)
    expect(newestDelete.error).toBeNull()
    await expectLastMessageAt(chatId, current)

    const currentDelete = await userA.client.from('messages').delete().eq('id', currentMessageId)
    expect(currentDelete.error).toBeNull()
    await expectLastMessageAt(chatId, older)

    const finalEligibleDelete = await userA.client
      .from('messages')
      .delete()
      .eq('id', olderMessageId)
    expect(finalEligibleDelete.error).toBeNull()
    await expectLastMessageAt(chatId, null)
  })

  it('recalculates affected chats after relevant message updates', async () => {
    const sourceChatId = await createChat(userA.id, characterAId, 'Update Source')
    const targetChatId = await createChat(userA.id, characterAId, 'Update Target')
    const eight = '2026-01-01T08:00:00.000Z'
    const nine = '2026-01-01T09:00:00.000Z'
    const ten = '2026-01-01T10:00:00.000Z'
    const tenOhFive = '2026-01-01T10:05:00.000Z'

    const firstMessageId = await createMessage(userA, sourceChatId, 'user', ten)
    const secondMessageId = await createMessage(userA, sourceChatId, 'assistant', tenOhFive)
    await createMessage(userA, targetChatId, 'user', eight)

    const createdAtUpdate = await userA.client
      .from('messages')
      .update({ created_at: nine })
      .eq('id', secondMessageId)
    expect(createdAtUpdate.error).toBeNull()
    await expectLastMessageAt(sourceChatId, ten)

    const firstRoleUpdate = await userA.client
      .from('messages')
      .update({ role: 'system' })
      .eq('id', firstMessageId)
    expect(firstRoleUpdate.error).toBeNull()
    await expectLastMessageAt(sourceChatId, nine)

    const secondRoleExclusion = await userA.client
      .from('messages')
      .update({ role: 'system' })
      .eq('id', secondMessageId)
    expect(secondRoleExclusion.error).toBeNull()
    await expectLastMessageAt(sourceChatId, null)

    const secondRoleRestoration = await userA.client
      .from('messages')
      .update({ role: 'assistant' })
      .eq('id', secondMessageId)
    expect(secondRoleRestoration.error).toBeNull()
    await expectLastMessageAt(sourceChatId, nine)

    const chatMove = await userA.client
      .from('messages')
      .update({ chat_id: targetChatId })
      .eq('id', secondMessageId)
    expect(chatMove.error).toBeNull()
    await expectLastMessageAt(sourceChatId, null)
    await expectLastMessageAt(targetChatId, nine)
  })

  it("does not let one user change another user's chat recency", async () => {
    const sourceChatId = await createChat(userA.id, characterAId, 'Tenant Source')
    const victimChatId = await createChat(userB.id, characterBId, 'Tenant Victim')
    const sourceTime = '2026-01-01T09:00:00.000Z'
    const victimTime = '2026-01-01T11:00:00.000Z'
    const sourceMessageId = await createMessage(userA, sourceChatId, 'user', sourceTime)

    await createMessage(userB, victimChatId, 'assistant', victimTime)

    const forgedInsert = await userA.client
      .from('messages')
      .insert({
        chat_id: victimChatId,
        user_id: userA.id,
        role: 'user',
        content: 'Cross-tenant insert attempt',
        created_at: '2026-01-01T12:00:00.000Z',
      })
      .select('id')
      .single()

    expect(forgedInsert.error).toBeTruthy()
    await expectLastMessageAt(victimChatId, victimTime)

    const forgedMove = await userA.client
      .from('messages')
      .update({ chat_id: victimChatId })
      .eq('id', sourceMessageId)

    expect(forgedMove.error).toBeTruthy()
    await expectLastMessageAt(sourceChatId, sourceTime)
    await expectLastMessageAt(victimChatId, victimTime)

    const forbiddenRecalculation = await userA.client.rpc('recalculate_chat_last_message_at', {
      p_chat_id: victimChatId,
    })

    expect(forbiddenRecalculation.error).toBeTruthy()
    await expectLastMessageAt(victimChatId, victimTime)
  })
})
