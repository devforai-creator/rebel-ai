import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

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

type MessageStatus = 'completed' | 'generating' | 'superseded'

const createdUserIds: string[] = []
const createdCharacterIds: string[] = []
const createdChatIds: string[] = []

let adminClient: SupabaseClient<Database>
let anonymousClient: SupabaseClient<Database>
let userA: TestUser
let userB: TestUser

async function createTestUser(label: string): Promise<TestUser> {
  const email = `recent-characters-${label}-${randomUUID()}@test.local`
  const password = `Tmp-${randomUUID().slice(0, 8)}!aA`
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new Error(`Failed to create test user: ${error?.message ?? 'unknown error'}`)
  }

  createdUserIds.push(data.user.id)

  const client = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    ...serverSupabaseRealtimeOptions,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  const signIn = await client.auth.signInWithPassword({ email, password })

  if (signIn.error) {
    throw new Error(`Failed to sign in test user: ${signIn.error.message}`)
  }

  return { id: data.user.id, client }
}

async function createCharacter(
  userId: string,
  label: string,
  options: { archived?: boolean; id?: string } = {},
): Promise<string> {
  const { data, error } = await adminClient
    .from('characters')
    .insert({
      id: options.id,
      user_id: userId,
      name: `Recent Character ${label}`,
      avatar_url: `avatars/${label}.png`,
      visibility: 'private',
      system_prompt: 'Test prompt',
      archived_at: options.archived ? '2026-01-01T00:00:00.000Z' : null,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create character: ${error?.message ?? 'unknown error'}`)
  }

  createdCharacterIds.push(data.id)
  return data.id
}

async function createChat(
  userId: string,
  characterId: string,
  label: string,
  id = randomUUID(),
  createdAt?: string,
): Promise<string> {
  const { error } = await adminClient.from('chats').insert({
    id,
    user_id: userId,
    character_id: characterId,
    title: `Recent Chat ${label}`,
    created_at: createdAt,
  })

  if (error) {
    throw new Error(`Failed to create chat: ${error.message}`)
  }

  createdChatIds.push(id)
  return id
}

async function createMessage(
  user: TestUser,
  chatId: string,
  content: string,
  options: {
    createdAt: string
    role?: 'user' | 'assistant' | 'system'
    status?: MessageStatus
  },
): Promise<void> {
  const { error } = await user.client.from('messages').insert({
    id: randomUUID(),
    chat_id: chatId,
    user_id: user.id,
    role: options.role ?? 'user',
    content,
    created_at: options.createdAt,
    message_status: options.status ?? 'completed',
  })

  if (error) {
    throw new Error(`Failed to create message: ${error.message}`)
  }
}

async function createRecentCharacter(
  user: TestUser,
  label: string,
  lastMessageAt: string,
  characterId = randomUUID(),
): Promise<string> {
  const id = await createCharacter(user.id, label, { id: characterId })
  const chatId = await createChat(user.id, id, label)
  await createMessage(user, chatId, `${label} message`, { createdAt: lastMessageAt })
  return id
}

async function cleanupRows(): Promise<void> {
  while (createdChatIds.length > 0) {
    const chatId = createdChatIds.pop()
    if (chatId) await adminClient.from('chats').delete().eq('id', chatId)
  }

  while (createdCharacterIds.length > 0) {
    const characterId = createdCharacterIds.pop()
    if (characterId) await adminClient.from('characters').delete().eq('id', characterId)
  }
}

describe.skipIf(shouldSkip)('recent and character chat list RPC integration', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase credentials for RLS integration tests')
    }

    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      ...serverSupabaseRealtimeOptions,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    anonymousClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      ...serverSupabaseRealtimeOptions,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    userA = await createTestUser('user-a')
    userB = await createTestUser('user-b')
  })

  afterEach(cleanupRows)

  afterAll(async () => {
    await cleanupRows()
    await userA?.client.auth.signOut().catch(() => undefined)
    await userB?.client.auth.signOut().catch(() => undefined)

    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop()
      if (!userId) continue
      await adminClient.from('profiles').delete().eq('id', userId)
      await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('groups chats by character and returns only visible completed preview data', async () => {
    const characterAId = await createCharacter(userA.id, 'A')
    const lowerChatId = '10000000-0000-0000-0000-000000000001'
    const representativeChatId = '10000000-0000-0000-0000-000000000002'
    const tiedRecency = '2026-02-01T12:00:00.000Z'
    const lowerChat = await createChat(userA.id, characterAId, 'A Lower', lowerChatId)
    const representativeChat = await createChat(
      userA.id,
      characterAId,
      'A Representative',
      representativeChatId,
    )

    await createMessage(userA, lowerChat, 'lower chat message', { createdAt: tiedRecency })
    await createMessage(userA, representativeChat, 'visible user message', {
      createdAt: '2026-02-01T11:57:00.000Z',
    })
    await createMessage(userA, representativeChat, 'visible assistant preview', {
      createdAt: '2026-02-01T11:58:00.000Z',
      role: 'assistant',
    })
    await createMessage(userA, representativeChat, 'hidden generating message', {
      createdAt: '2026-02-01T11:59:00.000Z',
      role: 'assistant',
      status: 'generating',
    })
    await createMessage(userA, representativeChat, 'hidden superseded message', {
      createdAt: tiedRecency,
      role: 'assistant',
      status: 'superseded',
    })

    const emptyCharacterId = await createCharacter(userA.id, 'Empty')
    await createChat(userA.id, emptyCharacterId, 'Empty')

    const archivedCharacterId = await createCharacter(userA.id, 'Archived', { archived: true })
    const archivedChatId = await createChat(userA.id, archivedCharacterId, 'Archived')
    await createMessage(userA, archivedChatId, 'archived message', {
      createdAt: '2026-02-02T12:00:00.000Z',
    })

    const userBCharacterId = await createRecentCharacter(
      userB,
      'User B',
      '2026-02-03T12:00:00.000Z',
    )

    const result = await userA.client.rpc('list_recent_conversation_characters', {
      p_page_size: 50,
    })

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]).toMatchObject({
      character_id: characterAId,
      latest_chat_id: representativeChatId,
      latest_chat_title: 'Recent Chat A Representative',
      preview_role: 'assistant',
      preview_content: 'visible assistant preview',
    })
    expect(result.data?.some((row) => row.character_id === emptyCharacterId)).toBe(false)
    expect(result.data?.some((row) => row.character_id === archivedCharacterId)).toBe(false)
    expect(result.data?.some((row) => row.character_id === userBCharacterId)).toBe(false)
  })

  it('paginates tied timestamps without duplicate or missing characters', async () => {
    const tiedRecency = '2026-03-01T12:00:00.000Z'
    const characterIds = await Promise.all([
      createRecentCharacter(userA, 'Tie 1', tiedRecency, '20000000-0000-0000-0000-000000000001'),
      createRecentCharacter(userA, 'Tie 2', tiedRecency, '20000000-0000-0000-0000-000000000002'),
      createRecentCharacter(userA, 'Tie 3', tiedRecency, '20000000-0000-0000-0000-000000000003'),
    ])
    const expectedOrder = [...characterIds].sort().reverse()
    const collectedIds: string[] = []
    let cursorLastMessageAt: string | undefined
    let cursorCharacterId: string | undefined

    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const result = await userA.client.rpc('list_recent_conversation_characters', {
        p_page_size: 1,
        p_cursor_last_message_at: cursorLastMessageAt,
        p_cursor_character_id: cursorCharacterId,
      })

      expect(result.error).toBeNull()
      expect(result.data?.length).toBe(pageIndex < 2 ? 2 : 1)

      const row = result.data?.[0]
      expect(row).toBeDefined()
      collectedIds.push(row!.character_id)
      cursorLastMessageAt = row!.last_message_at
      cursorCharacterId = row!.character_id
    }

    expect(collectedIds).toEqual(expectedOrder)
    expect(new Set(collectedIds).size).toBe(3)
  })

  it('rejects anonymous and partial-cursor calls and clamps page sizes', async () => {
    const recency = '2026-04-01T12:00:00.000Z'
    await Promise.all([
      createRecentCharacter(userA, 'Clamp 1', recency),
      createRecentCharacter(userA, 'Clamp 2', recency),
      createRecentCharacter(userA, 'Clamp 3', recency),
    ])

    const anonymousResult = await anonymousClient.rpc('list_recent_conversation_characters', {
      p_page_size: 15,
    })
    expect(anonymousResult.error?.code).toBe('42501')

    const partialCursorResult = await userA.client.rpc('list_recent_conversation_characters', {
      p_page_size: 15,
      p_cursor_character_id: randomUUID(),
    })
    expect(partialCursorResult.error?.code).toBe('22023')

    const minimumResult = await userA.client.rpc('list_recent_conversation_characters', {
      p_page_size: 0,
    })
    expect(minimumResult.error).toBeNull()
    expect(minimumResult.data).toHaveLength(2)

    const maximumResult = await userA.client.rpc('list_recent_conversation_characters', {
      p_page_size: 100,
    })
    expect(maximumResult.error).toBeNull()
    expect(maximumResult.data).toHaveLength(3)
  })

  it('keeps empty chats at created_at and paginates tied chat recency by ID', async () => {
    const characterId = await createCharacter(userA.id, 'Chat List')
    const emptyChatId = await createChat(
      userA.id,
      characterId,
      'Empty Newest',
      '40000000-0000-0000-0000-000000000004',
      '2026-05-04T12:00:00.000Z',
    )
    const tiedLowerChatId = await createChat(
      userA.id,
      characterId,
      'Tie Lower',
      '40000000-0000-0000-0000-000000000002',
      '2026-05-01T12:00:00.000Z',
    )
    const tiedHigherChatId = await createChat(
      userA.id,
      characterId,
      'Tie Higher',
      '40000000-0000-0000-0000-000000000003',
      '2026-05-01T12:00:00.000Z',
    )
    const olderChatId = await createChat(
      userA.id,
      characterId,
      'Older',
      '40000000-0000-0000-0000-000000000001',
      '2026-05-01T12:00:00.000Z',
    )

    await createMessage(userA, tiedLowerChatId, 'tie lower preview', {
      createdAt: '2026-05-03T12:00:00.000Z',
    })
    await createMessage(userA, tiedHigherChatId, 'visible tied preview', {
      createdAt: '2026-05-03T11:59:00.000Z',
      role: 'assistant',
    })
    await createMessage(userA, tiedHigherChatId, 'hidden generating preview', {
      createdAt: '2026-05-03T12:00:00.000Z',
      role: 'assistant',
      status: 'generating',
    })
    await createMessage(userA, olderChatId, 'older preview', {
      createdAt: '2026-05-02T12:00:00.000Z',
    })

    const metadataUpdate = await userA.client
      .from('chats')
      .update({ title: 'Updated metadata only' })
      .eq('id', olderChatId)
    expect(metadataUpdate.error).toBeNull()

    const expectedOrder = [emptyChatId, tiedHigherChatId, tiedLowerChatId, olderChatId]
    const collectedIds: string[] = []
    let cursorRecencyAt: string | undefined
    let cursorChatId: string | undefined

    for (let pageIndex = 0; pageIndex < expectedOrder.length; pageIndex += 1) {
      const result = await userA.client.rpc('list_character_chats', {
        p_character_id: characterId,
        p_page_size: 1,
        p_cursor_recency_at: cursorRecencyAt,
        p_cursor_chat_id: cursorChatId,
      })

      expect(result.error).toBeNull()
      expect(result.data?.length).toBe(pageIndex < expectedOrder.length - 1 ? 2 : 1)

      const row = result.data?.[0]
      expect(row).toBeDefined()
      collectedIds.push(row!.id)
      cursorRecencyAt = row!.recency_at
      cursorChatId = row!.id

      if (pageIndex === 0) {
        expect(row).toMatchObject({
          id: emptyChatId,
          last_message_at: null,
          recency_at: '2026-05-04T12:00:00+00:00',
          preview_role: null,
          preview_content: null,
        })
      }

      if (row?.id === tiedHigherChatId) {
        expect(row).toMatchObject({
          preview_role: 'assistant',
          preview_content: 'visible tied preview',
        })
      }
    }

    expect(collectedIds).toEqual(expectedOrder)
    expect(new Set(collectedIds).size).toBe(expectedOrder.length)
  })

  it('scopes character chat pages to the caller and rejects invalid direct calls', async () => {
    const characterId = await createCharacter(userA.id, 'Owned Chat List')
    const userAChatId = await createChat(userA.id, characterId, 'User A')
    const userBChatId = await createChat(userB.id, characterId, 'User B')
    await createMessage(userA, userAChatId, 'user A message', {
      createdAt: '2026-06-01T12:00:00.000Z',
    })
    await createMessage(userB, userBChatId, 'user B message', {
      createdAt: '2026-06-02T12:00:00.000Z',
    })

    const userAResult = await userA.client.rpc('list_character_chats', {
      p_character_id: characterId,
      p_page_size: 15,
    })
    expect(userAResult.error).toBeNull()
    expect(userAResult.data?.map((row) => row.id)).toEqual([userAChatId])

    const anonymousResult = await anonymousClient.rpc('list_character_chats', {
      p_character_id: characterId,
      p_page_size: 15,
    })
    expect(anonymousResult.error?.code).toBe('42501')

    const partialCursorResult = await userA.client.rpc('list_character_chats', {
      p_character_id: characterId,
      p_page_size: 15,
      p_cursor_chat_id: randomUUID(),
    })
    expect(partialCursorResult.error?.code).toBe('22023')
  })
})
