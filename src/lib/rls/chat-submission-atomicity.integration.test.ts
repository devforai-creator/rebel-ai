import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadGenerationTranscript } from '@/lib/chat/turns'
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

type SubmissionArgs = Database['public']['Functions']['submit_chat_generation_job']['Args']

let adminClient: SupabaseClient<Database>
let concurrentAdminClient: SupabaseClient<Database>
let anonClient: SupabaseClient<Database>
let userA: TestUser
let userB: TestUser
let characterAId: string
const createdUserIds: string[] = []

function createStatelessClient(key: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL!, key, {
    ...serverSupabaseRealtimeOptions,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function createTestUser(label: string): Promise<TestUser> {
  const email = `chat-submission-${label}-${randomUUID()}@test.local`
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
  const client = createStatelessClient(SUPABASE_ANON_KEY!)
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) {
    throw new Error(`Failed to sign in test user: ${signIn.error.message}`)
  }

  return { id: data.user.id, client }
}

async function createCharacter(userId: string): Promise<string> {
  const { data, error } = await adminClient
    .from('characters')
    .insert({
      user_id: userId,
      name: `Atomic Submission ${randomUUID()}`,
      visibility: 'private',
      system_prompt: 'Atomic submission test prompt',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create character: ${error?.message ?? 'unknown error'}`)
  }

  return data.id
}

async function createChat(label: string): Promise<string> {
  const { data, error } = await adminClient
    .from('chats')
    .insert({
      user_id: userA.id,
      character_id: characterAId,
      title: `Atomic Submission ${label}`,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create chat: ${error?.message ?? 'unknown error'}`)
  }

  return data.id
}

function buildSubmission({
  chatId,
  content,
  isRegeneration = false,
  regenerateAssistantMessageId = null,
}: {
  chatId: string
  content: string
  isRegeneration?: boolean
  regenerateAssistantMessageId?: string | null
}): {
  args: SubmissionArgs
  turnId: string | null
  userMessageId: string | null
} {
  const turnId = isRegeneration ? null : randomUUID()
  const userMessageId = isRegeneration ? null : randomUUID()
  const requestId = randomUUID()

  return {
    turnId,
    userMessageId,
    args: {
      p_chat_id: chatId,
      p_requester: userA.id,
      p_turn_id: turnId,
      p_user_message_id: userMessageId,
      p_user_message_content: isRegeneration ? null : content,
      p_job_payload: {
        version: 1,
        requestId,
        chatId,
        turnId,
        userId: userA.id,
        apiKeyId: randomUUID(),
        provider: 'google',
        modelName: 'gemini-2.5-flash',
        deliveryMode: 'streaming',
        sanitizedMessages: isRegeneration
          ? []
          : [{ role: 'user', content, messageId: userMessageId }],
        isRegeneration,
        regenerateAssistantMessageId,
      },
      p_delivery_mode: 'streaming',
      p_is_regeneration: isRegeneration,
      p_regenerate_assistant_message_id: regenerateAssistantMessageId,
    },
  }
}

async function seedCompletedTurn({
  chatId,
  turnIndex,
  userContent,
  assistantContent,
}: {
  chatId: string
  turnIndex: number
  userContent: string
  assistantContent: string
}): Promise<{ turnId: string; userMessageId: string; assistantMessageId: string }> {
  const turnId = randomUUID()
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()

  const turnInsert = await adminClient.from('chat_turns').insert({
    id: turnId,
    chat_id: chatId,
    user_id: userA.id,
    turn_index: turnIndex,
    user_message_id: userMessageId,
    active_assistant_message_id: assistantMessageId,
  })
  if (turnInsert.error) {
    throw new Error(`Failed to seed turn: ${turnInsert.error.message}`)
  }

  const messageInsert = await adminClient.from('messages').insert([
    {
      id: userMessageId,
      chat_id: chatId,
      user_id: userA.id,
      role: 'user',
      content: userContent,
      turn_id: turnId,
      message_status: 'completed',
    },
    {
      id: assistantMessageId,
      chat_id: chatId,
      user_id: userA.id,
      role: 'assistant',
      content: assistantContent,
      turn_id: turnId,
      variant_index: 1,
      message_status: 'completed',
    },
  ])
  if (messageInsert.error) {
    throw new Error(`Failed to seed messages: ${messageInsert.error.message}`)
  }

  return { turnId, userMessageId, assistantMessageId }
}

describe.skipIf(shouldSkip)('Atomic chat submission RPC', () => {
  beforeAll(async () => {
    if (shouldSkip) return

    adminClient = createStatelessClient(SUPABASE_SERVICE_ROLE_KEY!)
    concurrentAdminClient = createStatelessClient(SUPABASE_SERVICE_ROLE_KEY!)
    anonClient = createStatelessClient(SUPABASE_ANON_KEY!)
    userA = await createTestUser('user-a')
    userB = await createTestUser('user-b')
    characterAId = await createCharacter(userA.id)
  })

  afterEach(async () => {
    if (shouldSkip) return
    await adminClient.from('chats').delete().in('user_id', [userA.id, userB.id])
  })

  afterAll(async () => {
    if (shouldSkip) return

    await adminClient.from('chats').delete().in('user_id', [userA.id, userB.id])
    await adminClient.from('characters').delete().eq('id', characterAId)
    await userA.client.auth.signOut().catch(() => undefined)
    await userB.client.auth.signOut().catch(() => undefined)

    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId)
    }
    createdUserIds.length = 0
  })

  it('commits exactly one complete submission when two requests race on one chat', async () => {
    const chatId = await createChat('Concurrent Race')
    const first = buildSubmission({ chatId, content: 'concurrent message A' })
    const second = buildSubmission({ chatId, content: 'concurrent message B' })

    const results = await Promise.all([
      adminClient.rpc('submit_chat_generation_job', first.args),
      concurrentAdminClient.rpc('submit_chat_generation_job', second.args),
    ])

    const successes = results.filter((result) => result.error === null)
    const conflicts = results.filter(
      (result) =>
        result.error?.code === '23505' &&
        result.error.message.includes('chat_generation_jobs_active_chat_idx'),
    )
    expect(successes).toHaveLength(1)
    expect(conflicts).toHaveLength(1)

    const [{ data: turns }, { data: messages }, { data: jobs }] = await Promise.all([
      adminClient.from('chat_turns').select('id, user_message_id').eq('chat_id', chatId),
      adminClient
        .from('messages')
        .select('id, content, turn_id')
        .eq('chat_id', chatId)
        .eq('role', 'user'),
      adminClient
        .from('chat_generation_jobs')
        .select('id, payload')
        .eq('chat_id', chatId)
        .in('status', ['pending', 'processing']),
    ])

    expect(turns).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(jobs).toHaveLength(1)
    expect(turns?.[0].user_message_id).toBe(messages?.[0].id)
    expect(messages?.[0].turn_id).toBe(turns?.[0].id)

    const storedPayload = jobs?.[0].payload as Record<string, unknown>
    expect(storedPayload.turnId).toBe(turns?.[0].id)
    expect(storedPayload.sanitizedMessages).toEqual([
      {
        role: 'user',
        content: messages?.[0].content,
        messageId: messages?.[0].id,
      },
    ])

    const transcript = await loadGenerationTranscript({
      supabase: adminClient,
      chatId,
      turnId: turns![0].id,
    })
    expect(transcript).toEqual([
      {
        role: 'user',
        content: messages?.[0].content,
        messageId: messages?.[0].id,
      },
    ])
    const losingContent =
      messages?.[0].content === 'concurrent message A'
        ? 'concurrent message B'
        : 'concurrent message A'
    expect(transcript.some((message) => message.content === losingContent)).toBe(false)
  })

  it('rolls back the turn and message when the per-user active-job cap rejects the job', async () => {
    const admittedChatIds = await Promise.all([
      createChat('Cap 1'),
      createChat('Cap 2'),
      createChat('Cap 3'),
    ])

    for (const [index, chatId] of admittedChatIds.entries()) {
      const submission = buildSubmission({ chatId, content: `admitted ${index + 1}` })
      const result = await adminClient.rpc('submit_chat_generation_job', submission.args)
      expect(result.error).toBeNull()
    }

    const rejectedChatId = await createChat('Cap Rejected')
    const rejected = buildSubmission({ chatId: rejectedChatId, content: 'must not persist' })
    const result = await adminClient.rpc('submit_chat_generation_job', rejected.args)

    expect(result.error?.code).toBe('P0001')
    expect(result.error?.message).toContain('active chat generation jobs')

    const [{ data: turns }, { data: messages }, { data: jobs }] = await Promise.all([
      adminClient.from('chat_turns').select('id').eq('chat_id', rejectedChatId),
      adminClient.from('messages').select('id').eq('chat_id', rejectedChatId),
      adminClient.from('chat_generation_jobs').select('id').eq('chat_id', rejectedChatId),
    ])
    expect(turns).toHaveLength(0)
    expect(messages).toHaveLength(0)
    expect(jobs).toHaveLength(0)
  })

  it('queues regeneration without creating another turn or user message', async () => {
    const chatId = await createChat('Regeneration')
    const seeded = await seedCompletedTurn({
      chatId,
      turnIndex: 1,
      userContent: 'original user message',
      assistantContent: 'original assistant message',
    })
    const regeneration = buildSubmission({
      chatId,
      content: '',
      isRegeneration: true,
      regenerateAssistantMessageId: seeded.assistantMessageId,
    })

    const result = await adminClient.rpc('submit_chat_generation_job', regeneration.args)
    expect(result.error).toBeNull()
    expect(result.data?.[0]).toMatchObject({
      turn_id: seeded.turnId,
      user_message_id: null,
    })

    const [{ count: turnCount }, { count: userMessageCount }, { data: jobs }] = await Promise.all([
      adminClient
        .from('chat_turns')
        .select('*', { count: 'exact', head: true })
        .eq('chat_id', chatId),
      adminClient
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('chat_id', chatId)
        .eq('role', 'user'),
      adminClient.from('chat_generation_jobs').select('payload').eq('chat_id', chatId),
    ])
    expect(turnCount).toBe(1)
    expect(userMessageCount).toBe(1)
    expect((jobs?.[0].payload as Record<string, unknown>).turnId).toBe(seeded.turnId)
  })

  it('rejects regeneration of a non-latest assistant without creating a job', async () => {
    const chatId = await createChat('Stale Regeneration')
    const first = await seedCompletedTurn({
      chatId,
      turnIndex: 1,
      userContent: 'first user',
      assistantContent: 'first assistant',
    })
    await seedCompletedTurn({
      chatId,
      turnIndex: 2,
      userContent: 'second user',
      assistantContent: 'second assistant',
    })
    const regeneration = buildSubmission({
      chatId,
      content: '',
      isRegeneration: true,
      regenerateAssistantMessageId: first.assistantMessageId,
    })

    const result = await adminClient.rpc('submit_chat_generation_job', regeneration.args)
    expect(result.error).toMatchObject({
      code: '22023',
      message: 'Only the latest assistant message can be regenerated',
    })

    const { data: jobs } = await adminClient
      .from('chat_generation_jobs')
      .select('id')
      .eq('chat_id', chatId)
    expect(jobs).toHaveLength(0)
  })

  it('keeps the RPC behind the server boundary and verifies requester ownership', async () => {
    const chatId = await createChat('Authorization')
    const submission = buildSubmission({ chatId, content: 'server only' })

    const [anonResult, authenticatedResult] = await Promise.all([
      anonClient.rpc('submit_chat_generation_job', submission.args),
      userA.client.rpc('submit_chat_generation_job', submission.args),
    ])
    expect(anonResult.error?.code).toBe('42501')
    expect(authenticatedResult.error?.code).toBe('42501')

    const wrongRequesterResult = await adminClient.rpc('submit_chat_generation_job', {
      ...submission.args,
      p_requester: userB.id,
      p_job_payload: {
        ...(submission.args.p_job_payload as Record<string, unknown>),
        userId: userB.id,
      },
    })
    expect(wrongRequesterResult.error).toMatchObject({
      code: 'P0002',
      message: 'Chat not found',
    })

    const [{ data: turns }, { data: messages }, { data: jobs }] = await Promise.all([
      adminClient.from('chat_turns').select('id').eq('chat_id', chatId),
      adminClient.from('messages').select('id').eq('chat_id', chatId),
      adminClient.from('chat_generation_jobs').select('id').eq('chat_id', chatId),
    ])
    expect(turns).toHaveLength(0)
    expect(messages).toHaveLength(0)
    expect(jobs).toHaveLength(0)
  })
})
