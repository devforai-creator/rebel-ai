import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { MESSAGE_STATUS_COMPLETED, MESSAGE_STATUS_GENERATING } from '@/lib/chat/message-status'
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

let adminClient: SupabaseClient<Database>
const createdUserIds: string[] = []
const createdCharacterIds: string[] = []
const createdChatIds: string[] = []
let userA: TestUser
let userB: TestUser
let characterAId: string
let characterBId: string

async function createTestUser(label: string): Promise<TestUser> {
  const email = `turn-integrity-${label}-${randomUUID()}@test.local`
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
    client: userClient,
  }
}

async function createCharacter(userId: string, label: string): Promise<string> {
  const { data, error } = await adminClient
    .from('characters')
    .insert({
      user_id: userId,
      name: `Turn Integrity ${label}`,
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
      title: `Turn Integrity ${label}`,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create chat: ${error?.message ?? 'unknown error'}`)
  }

  createdChatIds.push(data.id)
  return data.id
}

async function cleanupChats(): Promise<void> {
  while (createdChatIds.length > 0) {
    const chatId = createdChatIds.pop()
    if (!chatId) continue
    await adminClient.from('chats').delete().eq('id', chatId)
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

describe.skipIf(shouldSkip)('Turn/message integrity', () => {
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
    characterAId = await createCharacter(userA.id, 'Character A')
    characterBId = await createCharacter(userB.id, 'Character B')
  })

  afterEach(async () => {
    if (shouldSkip) return
    await cleanupChats()
  })

  afterAll(async () => {
    if (shouldSkip) return

    await cleanupChats()
    await userA?.client.auth.signOut().catch(() => undefined)
    await userB?.client.auth.signOut().catch(() => undefined)

    for (const characterId of createdCharacterIds) {
      await adminClient.from('characters').delete().eq('id', characterId)
    }

    createdCharacterIds.length = 0
    await cleanupUsers()
  })

  it('allows greeting-style assistant pointer reservation before the assistant message exists', async () => {
    const chatId = await createChat(userA.id, characterAId, 'Greeting Flow')
    const turnId = randomUUID()
    const assistantMessageId = randomUUID()

    const turnInsert = await userA.client
      .from('chat_turns')
      .insert({
        id: turnId,
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 1,
        active_assistant_message_id: assistantMessageId,
      })
      .select('id')
      .single()

    expect(turnInsert.error).toBeNull()

    const messageInsert = await userA.client
      .from('messages')
      .insert({
        id: assistantMessageId,
        chat_id: chatId,
        user_id: userA.id,
        role: 'assistant',
        content: 'Hello from the greeting path',
        turn_id: turnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(messageInsert.error).toBeNull()

    const { data: turnState, error: turnStateError } = await adminClient
      .from('chat_turns')
      .select('user_message_id, active_assistant_message_id')
      .eq('id', turnId)
      .single()

    expect(turnStateError).toBeNull()
    expect(turnState).toMatchObject({
      user_message_id: null,
      active_assistant_message_id: assistantMessageId,
    })
  })

  it('promotes the active assistant pointer only after the assistant finishes generation', async () => {
    const chatId = await createChat(userA.id, characterAId, 'Generation Flow')
    const turnId = randomUUID()
    const userMessageId = randomUUID()
    const assistantMessageId = randomUUID()

    const turnInsert = await userA.client
      .from('chat_turns')
      .insert({
        id: turnId,
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 1,
        user_message_id: userMessageId,
      })
      .select('id')
      .single()

    expect(turnInsert.error).toBeNull()

    const userMessageInsert = await userA.client
      .from('messages')
      .insert({
        id: userMessageId,
        chat_id: chatId,
        user_id: userA.id,
        role: 'user',
        content: 'Hello there',
        turn_id: turnId,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(userMessageInsert.error).toBeNull()

    const generatingAssistantInsert = await userA.client
      .from('messages')
      .insert({
        id: assistantMessageId,
        chat_id: chatId,
        user_id: userA.id,
        role: 'assistant',
        content: '',
        turn_id: turnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_GENERATING,
      })
      .select('id')
      .single()

    expect(generatingAssistantInsert.error).toBeNull()

    const { data: beforeFinalize, error: beforeFinalizeError } = await adminClient
      .from('chat_turns')
      .select('user_message_id, active_assistant_message_id')
      .eq('id', turnId)
      .single()

    expect(beforeFinalizeError).toBeNull()
    expect(beforeFinalize).toMatchObject({
      user_message_id: userMessageId,
      active_assistant_message_id: null,
    })

    const finalizeUpdate = await userA.client
      .from('messages')
      .update({
        content: 'Final assistant reply',
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .eq('id', assistantMessageId)

    expect(finalizeUpdate.error).toBeNull()

    const { data: afterFinalize, error: afterFinalizeError } = await adminClient
      .from('chat_turns')
      .select('active_assistant_message_id')
      .eq('id', turnId)
      .single()

    expect(afterFinalizeError).toBeNull()
    expect(afterFinalize?.active_assistant_message_id).toBe(assistantMessageId)
  })

  it('rejects system messages attached to chat turns', async () => {
    const chatId = await createChat(userA.id, characterAId, 'System Turn Guard')
    const turnId = randomUUID()

    const turnInsert = await userA.client
      .from('chat_turns')
      .insert({
        id: turnId,
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 1,
      })
      .select('id')
      .single()

    expect(turnInsert.error).toBeNull()

    const result = await userA.client
      .from('messages')
      .insert({
        chat_id: chatId,
        user_id: userA.id,
        role: 'system',
        content: 'System messages should stay standalone',
        turn_id: turnId,
      })
      .select('id')
      .single()

    expect(result.error).toBeTruthy()
    expect(result.error?.message).toContain('System messages cannot reference chat turns')
  })

  it('rejects assistant messages whose turn belongs to a different chat', async () => {
    const sourceChatId = await createChat(userA.id, characterAId, 'Source Chat')
    const targetChatId = await createChat(userA.id, characterAId, 'Target Chat')
    const turnId = randomUUID()

    const turnInsert = await userA.client
      .from('chat_turns')
      .insert({
        id: turnId,
        chat_id: sourceChatId,
        user_id: userA.id,
        turn_index: 1,
      })
      .select('id')
      .single()

    expect(turnInsert.error).toBeNull()

    const messageInsert = await userA.client
      .from('messages')
      .insert({
        chat_id: targetChatId,
        user_id: userA.id,
        role: 'assistant',
        content: 'Mismatched chat/turn pair',
        turn_id: turnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(messageInsert.error).toBeTruthy()
    expect(messageInsert.error?.message).toContain(
      'Message turn_id must reference a turn in the same chat',
    )
  })

  it('rejects duplicate reserved active assistant pointers across turns', async () => {
    const chatId = await createChat(userA.id, characterAId, 'Duplicate Pointer Guard')
    const reservedAssistantId = randomUUID()

    const firstTurn = await userA.client
      .from('chat_turns')
      .insert({
        id: randomUUID(),
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 1,
        active_assistant_message_id: reservedAssistantId,
      })
      .select('id')
      .single()

    expect(firstTurn.error).toBeNull()

    const secondTurn = await userA.client
      .from('chat_turns')
      .insert({
        id: randomUUID(),
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 2,
        active_assistant_message_id: reservedAssistantId,
      })
      .select('id')
      .single()

    expect(secondTurn.error).toBeTruthy()
  })

  it('rejects duplicate assistant variant indexes within a turn', async () => {
    const chatId = await createChat(userA.id, characterAId, 'Variant Guard')
    const turnId = randomUUID()

    const turnInsert = await userA.client
      .from('chat_turns')
      .insert({
        id: turnId,
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 1,
      })
      .select('id')
      .single()

    expect(turnInsert.error).toBeNull()

    const firstAssistantInsert = await userA.client
      .from('messages')
      .insert({
        id: randomUUID(),
        chat_id: chatId,
        user_id: userA.id,
        role: 'assistant',
        content: 'Variant 1',
        turn_id: turnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(firstAssistantInsert.error).toBeNull()

    const duplicateVariantInsert = await userA.client
      .from('messages')
      .insert({
        id: randomUUID(),
        chat_id: chatId,
        user_id: userA.id,
        role: 'assistant',
        content: 'Variant 1 duplicate',
        turn_id: turnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(duplicateVariantInsert.error).toBeTruthy()
  })

  it('rejects manually pointing a turn at a non-completed assistant message', async () => {
    const chatId = await createChat(userA.id, characterAId, 'Active Pointer Status Guard')
    const turnId = randomUUID()
    const assistantMessageId = randomUUID()

    const turnInsert = await userA.client
      .from('chat_turns')
      .insert({
        id: turnId,
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 1,
      })
      .select('id')
      .single()

    expect(turnInsert.error).toBeNull()

    const assistantInsert = await userA.client
      .from('messages')
      .insert({
        id: assistantMessageId,
        chat_id: chatId,
        user_id: userA.id,
        role: 'assistant',
        content: '',
        turn_id: turnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_GENERATING,
      })
      .select('id')
      .single()

    expect(assistantInsert.error).toBeNull()

    const pointerUpdate = await userA.client
      .from('chat_turns')
      .update({
        active_assistant_message_id: assistantMessageId,
      })
      .eq('id', turnId)

    expect(pointerUpdate.error).toBeTruthy()
    expect(pointerUpdate.error?.message).toContain(
      'active_assistant_message_id must reference a completed assistant message',
    )
  })

  it('clears turn pointers when the referenced messages are deleted', async () => {
    const chatId = await createChat(userA.id, characterAId, 'Delete Pointer Cleanup')
    const turnId = randomUUID()
    const userMessageId = randomUUID()
    const assistantMessageId = randomUUID()

    const turnInsert = await userA.client
      .from('chat_turns')
      .insert({
        id: turnId,
        chat_id: chatId,
        user_id: userA.id,
        turn_index: 1,
        user_message_id: userMessageId,
        active_assistant_message_id: assistantMessageId,
      })
      .select('id')
      .single()

    expect(turnInsert.error).toBeNull()

    const userMessageInsert = await userA.client
      .from('messages')
      .insert({
        id: userMessageId,
        chat_id: chatId,
        user_id: userA.id,
        role: 'user',
        content: 'Original prompt',
        turn_id: turnId,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(userMessageInsert.error).toBeNull()

    const assistantMessageInsert = await userA.client
      .from('messages')
      .insert({
        id: assistantMessageId,
        chat_id: chatId,
        user_id: userA.id,
        role: 'assistant',
        content: 'Original reply',
        turn_id: turnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(assistantMessageInsert.error).toBeNull()

    const assistantDelete = await userA.client
      .from('messages')
      .delete()
      .eq('id', assistantMessageId)

    expect(assistantDelete.error).toBeNull()

    const { data: afterAssistantDelete, error: afterAssistantDeleteError } = await adminClient
      .from('chat_turns')
      .select('user_message_id, active_assistant_message_id')
      .eq('id', turnId)
      .single()

    expect(afterAssistantDeleteError).toBeNull()
    expect(afterAssistantDelete).toMatchObject({
      user_message_id: userMessageId,
      active_assistant_message_id: null,
    })

    const userDelete = await userA.client.from('messages').delete().eq('id', userMessageId)

    expect(userDelete.error).toBeNull()

    const { data: afterUserDelete, error: afterUserDeleteError } = await adminClient
      .from('chat_turns')
      .select('user_message_id, active_assistant_message_id')
      .eq('id', turnId)
      .single()

    expect(afterUserDeleteError).toBeNull()
    expect(afterUserDelete).toMatchObject({
      user_message_id: null,
      active_assistant_message_id: null,
    })
  })

  it('does not leak turn integrity privileges across tenants', async () => {
    const victimChatId = await createChat(userB.id, characterBId, 'Victim Chat')
    const victimTurnId = randomUUID()

    const victimTurnInsert = await userB.client
      .from('chat_turns')
      .insert({
        id: victimTurnId,
        chat_id: victimChatId,
        user_id: userB.id,
        turn_index: 1,
      })
      .select('id')
      .single()

    expect(victimTurnInsert.error).toBeNull()

    const forgedAssistantInsert = await userA.client
      .from('messages')
      .insert({
        chat_id: victimChatId,
        user_id: userA.id,
        role: 'assistant',
        content: 'Cross-tenant assistant injection',
        turn_id: victimTurnId,
        variant_index: 1,
        message_status: MESSAGE_STATUS_COMPLETED,
      })
      .select('id')
      .single()

    expect(forgedAssistantInsert.error).toBeTruthy()
  })
})
