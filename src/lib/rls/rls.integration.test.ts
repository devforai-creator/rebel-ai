/**
 * RLS (Row Level Security) Integration Tests
 *
 * These tests verify that RLS policies work correctly by running queries
 * against a real Supabase instance. They require:
 * - Local Supabase running (`supabase start`)
 * - Test environment variables set
 *
 * Run with: npm run test:rls
 * Skip in regular test runs if env not configured
 */

import { randomUUID } from 'node:crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'

// Skip all tests if RLS test env is not configured
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const RLS_TESTS_ENABLED = process.env.RLS_TESTS_ENABLED === 'true'

const shouldSkip =
  !RLS_TESTS_ENABLED || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY

interface TestUser {
  id: string
  email: string
  client: SupabaseClient
}

interface TestData {
  userA: TestUser
  userB: TestUser
  characterA: { id: string }
  characterB: { id: string }
  publicCharacter: { id: string }
  chatA: { id: string }
  chatB: { id: string }
  apiKeyA: { id: string }
}

// Admin client for setup/teardown
let adminClient: SupabaseClient
let testData: TestData

// Track created user IDs for cleanup (avoids listUsers pagination issues)
const createdUserIds: string[] = []

async function createTestUser(email: string, password: string): Promise<TestUser> {
  // Create user via admin API
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    throw new Error(`Failed to create test user: ${authError?.message}`)
  }

  // Track for cleanup
  createdUserIds.push(authData.user.id)

  // Create a client with anon key (simulates real user access with RLS)
  const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  // Sign in as the user to get a proper JWT
  const { error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    throw new Error(`Failed to sign in test user: ${signInError.message}`)
  }

  return {
    id: authData.user.id,
    email,
    client: userClient,
  }
}

async function cleanupTestData() {
  if (!adminClient) return

  // Delete test data using stored user IDs (avoids pagination issues)
  for (const userId of createdUserIds) {
    // Delete user's data first (cascade should handle most)
    await adminClient.from('messages').delete().eq('user_id', userId)
    await adminClient.from('chats').delete().eq('user_id', userId)
    await adminClient.from('api_keys').delete().eq('user_id', userId)
    await adminClient.from('characters').delete().eq('user_id', userId)
    await adminClient.from('profiles').delete().eq('id', userId)

    // Delete the auth user
    await adminClient.auth.admin.deleteUser(userId)
  }

  // Clear the tracking array
  createdUserIds.length = 0
}

describe.skipIf(shouldSkip)('RLS Policy Tests', () => {
  beforeAll(async () => {
    if (shouldSkip) return

    // Initialize admin client (service role bypasses RLS)
    adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Clean up any leftover test data from previous runs
    // Try to find and delete by email pattern (best effort)
    const { data: users } = await adminClient.auth.admin.listUsers()
    const testUsers =
      users?.users?.filter((u) => u.email?.endsWith('@test.local') && u.email?.includes('rls-')) ||
      []
    for (const user of testUsers) {
      await adminClient.from('messages').delete().eq('user_id', user.id)
      await adminClient.from('chats').delete().eq('user_id', user.id)
      await adminClient.from('api_keys').delete().eq('user_id', user.id)
      await adminClient.from('characters').delete().eq('user_id', user.id)
      await adminClient.from('profiles').delete().eq('id', user.id)
      await adminClient.auth.admin.deleteUser(user.id)
    }

    // Create test users (clients use anon key for real RLS testing)
    const userA = await createTestUser('rls-test-user-a@test.local', 'test-password-123!')
    const userB = await createTestUser('rls-test-user-b@test.local', 'test-password-456!')

    // Create test data using admin client (bypasses RLS)

    // User A's private character
    const { data: characterA } = await adminClient
      .from('characters')
      .insert({
        user_id: userA.id,
        name: 'User A Private Character',
        visibility: 'private',
        system_prompt: 'Test prompt',
      })
      .select('id')
      .single()

    // User B's private character
    const { data: characterB } = await adminClient
      .from('characters')
      .insert({
        user_id: userB.id,
        name: 'User B Private Character',
        visibility: 'private',
        system_prompt: 'Test prompt',
      })
      .select('id')
      .single()

    // Public character (no owner)
    const { data: publicCharacter } = await adminClient
      .from('characters')
      .insert({
        user_id: null,
        name: 'Public Starter Character',
        visibility: 'public',
        system_prompt: 'Test prompt',
      })
      .select('id')
      .single()

    // User A's chat
    const { data: chatA } = await adminClient
      .from('chats')
      .insert({
        user_id: userA.id,
        character_id: characterA!.id,
        title: 'User A Chat',
      })
      .select('id')
      .single()

    // User B's chat
    const { data: chatB } = await adminClient
      .from('chats')
      .insert({
        user_id: userB.id,
        character_id: characterB!.id,
        title: 'User B Chat',
      })
      .select('id')
      .single()

    // User A's API key
    const { data: apiKeyA } = await adminClient
      .from('api_keys')
      .insert({
        user_id: userA.id,
        provider: 'google',
        key_name: 'Test API Key A',
        vault_secret_name: 'test-secret',
        is_active: true,
      })
      .select('id')
      .single()

    testData = {
      userA,
      userB,
      characterA: characterA!,
      characterB: characterB!,
      publicCharacter: publicCharacter!,
      chatA: chatA!,
      chatB: chatB!,
      apiKeyA: apiKeyA!,
    }
  })

  afterAll(async () => {
    if (shouldSkip) return

    // Clean up public character separately (not tied to a user)
    if (testData?.publicCharacter?.id) {
      await adminClient.from('characters').delete().eq('id', testData.publicCharacter.id)
    }

    await cleanupTestData()
  })

  describe('profiles table RLS', () => {
    it('does not allow users to grant themselves admin privileges', async () => {
      const attempt = await testData.userA.client
        .from('profiles')
        .update({ is_admin: true })
        .eq('id', testData.userA.id)

      expect(attempt.error).toBeTruthy()

      const { data, error } = await adminClient
        .from('profiles')
        .select('is_admin')
        .eq('id', testData.userA.id)
        .single()

      expect(error).toBeNull()
      expect(data?.is_admin).toBe(false)
    })
  })

  describe('characters table RLS', () => {
    it('user can see their own private characters', async () => {
      const { data, error } = await testData.userA.client
        .from('characters')
        .select('id, name')
        .eq('id', testData.characterA.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].id).toBe(testData.characterA.id)
    })

    it('user cannot see other users private characters', async () => {
      const { data, error } = await testData.userA.client
        .from('characters')
        .select('id, name')
        .eq('id', testData.characterB.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(0) // RLS should filter it out
    })

    it('user can see public characters', async () => {
      const { data, error } = await testData.userA.client
        .from('characters')
        .select('id, name')
        .eq('id', testData.publicCharacter.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it('user cannot update other users characters', async () => {
      await testData.userA.client
        .from('characters')
        .update({ name: 'Hacked Name' })
        .eq('id', testData.characterB.id)

      // RLS typically returns success but affects 0 rows
      const { data: checkData } = await adminClient
        .from('characters')
        .select('name')
        .eq('id', testData.characterB.id)
        .single()

      expect(checkData?.name).toBe('User B Private Character') // Unchanged
    })

    it('user cannot delete other users characters', async () => {
      await testData.userA.client.from('characters').delete().eq('id', testData.characterB.id)

      // Verify it still exists
      const { data: checkData } = await adminClient
        .from('characters')
        .select('id')
        .eq('id', testData.characterB.id)

      expect(checkData).toHaveLength(1) // Still exists
    })
  })

  describe('chats table RLS', () => {
    it('user can see their own chats', async () => {
      const { data, error } = await testData.userA.client
        .from('chats')
        .select('id, title')
        .eq('id', testData.chatA.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it('user cannot see other users chats', async () => {
      // Create a chat for user B
      const { data: chatB } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userB.id,
          character_id: testData.characterB.id,
          title: 'User B Chat',
        })
        .select('id')
        .single()

      const { data, error } = await testData.userA.client
        .from('chats')
        .select('id, title')
        .eq('id', chatB!.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(0) // RLS filters it out

      // Cleanup
      await adminClient.from('chats').delete().eq('id', chatB!.id)
    })

    it('user cannot update other users chats', async () => {
      // Create a chat for user B
      const { data: chatB } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userB.id,
          character_id: testData.characterB.id,
          title: 'User B Original Title',
        })
        .select('id')
        .single()

      // User A tries to update user B's chat
      await testData.userA.client
        .from('chats')
        .update({ title: 'Hacked Title' })
        .eq('id', chatB!.id)

      // Verify title unchanged
      const { data: checkData } = await adminClient
        .from('chats')
        .select('title')
        .eq('id', chatB!.id)
        .single()

      expect(checkData?.title).toBe('User B Original Title')

      // Cleanup
      await adminClient.from('chats').delete().eq('id', chatB!.id)
    })

    it('user cannot delete other users chats', async () => {
      // Create a chat for user B
      const { data: chatB } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userB.id,
          character_id: testData.characterB.id,
          title: 'User B Chat To Delete',
        })
        .select('id')
        .single()

      // User A tries to delete user B's chat
      await testData.userA.client.from('chats').delete().eq('id', chatB!.id)

      // Verify it still exists
      const { data: checkData } = await adminClient.from('chats').select('id').eq('id', chatB!.id)

      expect(checkData).toHaveLength(1)

      // Cleanup
      await adminClient.from('chats').delete().eq('id', chatB!.id)
    })

    // Positive-path tests: user CAN modify their own data
    it('user can create their own chats', async () => {
      const { data, error } = await testData.userA.client
        .from('chats')
        .insert({
          user_id: testData.userA.id,
          character_id: testData.characterA.id,
          title: 'User A New Chat',
        })
        .select('id')
        .single()

      expect(error).toBeNull()
      expect(data).not.toBeNull()

      // Cleanup
      await adminClient.from('chats').delete().eq('id', data!.id)
    })

    it('user can update their own chats', async () => {
      const { error } = await testData.userA.client
        .from('chats')
        .update({ title: 'Updated Title' })
        .eq('id', testData.chatA.id)

      expect(error).toBeNull()

      // Verify update worked
      const { data: checkData } = await adminClient
        .from('chats')
        .select('title')
        .eq('id', testData.chatA.id)
        .single()

      expect(checkData?.title).toBe('Updated Title')

      // Restore original
      await adminClient.from('chats').update({ title: 'User A Chat' }).eq('id', testData.chatA.id)
    })

    it('user can delete their own chats', async () => {
      // Create a chat to delete
      const { data: newChat } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userA.id,
          character_id: testData.characterA.id,
          title: 'Chat To Delete',
        })
        .select('id')
        .single()

      const { error } = await testData.userA.client.from('chats').delete().eq('id', newChat!.id)

      expect(error).toBeNull()

      // Verify deleted
      const { data: checkData } = await adminClient.from('chats').select('id').eq('id', newChat!.id)

      expect(checkData).toHaveLength(0)
    })
  })

  describe('api_keys table RLS', () => {
    it('user can see their own API keys', async () => {
      const { data, error } = await testData.userA.client
        .from('api_keys')
        .select('id, provider')
        .eq('id', testData.apiKeyA.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it('user cannot see other users API keys', async () => {
      // Create an API key for user B
      const { data: apiKeyB } = await adminClient
        .from('api_keys')
        .insert({
          user_id: testData.userB.id,
          provider: 'openai',
          key_name: 'Test API Key B',
          vault_secret_name: 'test-secret-b',
          is_active: true,
        })
        .select('id')
        .single()

      const { data, error } = await testData.userA.client
        .from('api_keys')
        .select('id, provider')
        .eq('id', apiKeyB!.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(0) // RLS filters it out

      // Cleanup
      await adminClient.from('api_keys').delete().eq('id', apiKeyB!.id)
    })

    it('user cannot update other users API keys', async () => {
      // Create an API key for user B
      const { data: apiKeyB } = await adminClient
        .from('api_keys')
        .insert({
          user_id: testData.userB.id,
          provider: 'openai',
          key_name: 'Test API Key B Update',
          vault_secret_name: 'test-secret-b-upd',
          is_active: true,
        })
        .select('id')
        .single()

      // User A tries to update user B's API key
      await testData.userA.client
        .from('api_keys')
        .update({ is_active: false })
        .eq('id', apiKeyB!.id)

      // Verify unchanged
      const { data: checkData } = await adminClient
        .from('api_keys')
        .select('is_active')
        .eq('id', apiKeyB!.id)
        .single()

      expect(checkData?.is_active).toBe(true)

      // Cleanup
      await adminClient.from('api_keys').delete().eq('id', apiKeyB!.id)
    })

    it('user cannot delete other users API keys', async () => {
      // Create an API key for user B
      const { data: apiKeyB } = await adminClient
        .from('api_keys')
        .insert({
          user_id: testData.userB.id,
          provider: 'openai',
          key_name: 'Test API Key B Delete',
          vault_secret_name: 'test-secret-b-del',
          is_active: true,
        })
        .select('id')
        .single()

      // User A tries to delete user B's API key
      await testData.userA.client.from('api_keys').delete().eq('id', apiKeyB!.id)

      // Verify it still exists
      const { data: checkData } = await adminClient
        .from('api_keys')
        .select('id')
        .eq('id', apiKeyB!.id)

      expect(checkData).toHaveLength(1)

      // Cleanup
      await adminClient.from('api_keys').delete().eq('id', apiKeyB!.id)
    })

    // Positive-path tests: user CAN modify their own data
    it('user can create their own API keys', async () => {
      const { data, error } = await testData.userA.client
        .from('api_keys')
        .insert({
          user_id: testData.userA.id,
          provider: 'openai',
          key_name: 'User A New Key',
          vault_secret_name: 'test-new-secret-a',
          is_active: true,
        })
        .select('id')
        .single()

      expect(error).toBeNull()
      expect(data).not.toBeNull()

      // Cleanup
      await adminClient.from('api_keys').delete().eq('id', data!.id)
    })

    it('user can update their own API keys', async () => {
      const { error } = await testData.userA.client
        .from('api_keys')
        .update({ is_active: false })
        .eq('id', testData.apiKeyA.id)

      expect(error).toBeNull()

      // Verify update worked
      const { data: checkData } = await adminClient
        .from('api_keys')
        .select('is_active')
        .eq('id', testData.apiKeyA.id)
        .single()

      expect(checkData?.is_active).toBe(false)

      // Restore original
      await adminClient.from('api_keys').update({ is_active: true }).eq('id', testData.apiKeyA.id)
    })

    it('user can delete their own API keys', async () => {
      // Create an API key to delete
      const { data: newKey } = await adminClient
        .from('api_keys')
        .insert({
          user_id: testData.userA.id,
          provider: 'anthropic',
          key_name: 'Key To Delete',
          vault_secret_name: 'test-delete-secret',
          is_active: true,
        })
        .select('id')
        .single()

      const { error } = await testData.userA.client.from('api_keys').delete().eq('id', newKey!.id)

      expect(error).toBeNull()

      // Verify deleted
      const { data: checkData } = await adminClient
        .from('api_keys')
        .select('id')
        .eq('id', newKey!.id)

      expect(checkData).toHaveLength(0)
    })
  })

  describe('messages table RLS', () => {
    it('user can see messages from their own chats', async () => {
      // Create a message in user A's chat
      const { data: message } = await adminClient
        .from('messages')
        .insert({
          chat_id: testData.chatA.id,
          user_id: testData.userA.id,
          role: 'user',
          content: 'Test message',
        })
        .select('id')
        .single()

      const { data, error } = await testData.userA.client
        .from('messages')
        .select('id, content')
        .eq('id', message!.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)

      // Cleanup
      await adminClient.from('messages').delete().eq('id', message!.id)
    })

    it('user cannot see messages from other users chats', async () => {
      // Create a chat and message for user B
      const { data: chatB } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userB.id,
          character_id: testData.characterB.id,
          title: 'User B Chat',
        })
        .select('id')
        .single()

      const { data: messageB } = await adminClient
        .from('messages')
        .insert({
          chat_id: chatB!.id,
          user_id: testData.userB.id,
          role: 'user',
          content: 'Secret message',
        })
        .select('id')
        .single()

      const { data, error } = await testData.userA.client
        .from('messages')
        .select('id, content')
        .eq('id', messageB!.id)

      expect(error).toBeNull()
      expect(data).toHaveLength(0) // RLS filters it out

      // Cleanup
      await adminClient.from('messages').delete().eq('id', messageB!.id)
      await adminClient.from('chats').delete().eq('id', chatB!.id)
    })

    it('user cannot update messages in other users chats', async () => {
      // Create a chat and message for user B
      const { data: chatB } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userB.id,
          character_id: testData.characterB.id,
          title: 'User B Chat',
        })
        .select('id')
        .single()

      const { data: messageB } = await adminClient
        .from('messages')
        .insert({
          chat_id: chatB!.id,
          user_id: testData.userB.id,
          role: 'user',
          content: 'Original content',
        })
        .select('id')
        .single()

      // User A tries to update user B's message
      await testData.userA.client
        .from('messages')
        .update({ content: 'Hacked content' })
        .eq('id', messageB!.id)

      // Verify unchanged
      const { data: checkData } = await adminClient
        .from('messages')
        .select('content')
        .eq('id', messageB!.id)
        .single()

      expect(checkData?.content).toBe('Original content')

      // Cleanup
      await adminClient.from('messages').delete().eq('id', messageB!.id)
      await adminClient.from('chats').delete().eq('id', chatB!.id)
    })

    it('user cannot delete messages in other users chats', async () => {
      // Create a chat and message for user B
      const { data: chatB } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userB.id,
          character_id: testData.characterB.id,
          title: 'User B Chat',
        })
        .select('id')
        .single()

      const { data: messageB } = await adminClient
        .from('messages')
        .insert({
          chat_id: chatB!.id,
          user_id: testData.userB.id,
          role: 'user',
          content: 'Message to delete',
        })
        .select('id')
        .single()

      // User A tries to delete user B's message
      await testData.userA.client.from('messages').delete().eq('id', messageB!.id)

      // Verify it still exists
      const { data: checkData } = await adminClient
        .from('messages')
        .select('id')
        .eq('id', messageB!.id)

      expect(checkData).toHaveLength(1)

      // Cleanup
      await adminClient.from('messages').delete().eq('id', messageB!.id)
      await adminClient.from('chats').delete().eq('id', chatB!.id)
    })

    it('user cannot inject system messages into other users chats by spoofing user_id', async () => {
      const { data, error } = await testData.userA.client
        .from('messages')
        .insert({
          chat_id: testData.chatB.id,
          user_id: testData.userA.id,
          role: 'system',
          content: 'Injected system prompt',
        })
        .select('id')
        .single()

      expect(error).toBeTruthy()
      expect(data).toBeNull()

      const { data: checkData } = await adminClient
        .from('messages')
        .select('id')
        .eq('chat_id', testData.chatB.id)
        .eq('content', 'Injected system prompt')

      expect(checkData).toHaveLength(0)
    })

    // Positive-path tests: user CAN modify their own data
    it('user can create messages in their own chats', async () => {
      const { data, error } = await testData.userA.client
        .from('messages')
        .insert({
          chat_id: testData.chatA.id,
          role: 'user',
          content: 'User created message',
        })
        .select('id')
        .single()

      expect(error).toBeNull()
      expect(data).not.toBeNull()

      // Cleanup
      await adminClient.from('messages').delete().eq('id', data!.id)
    })

    it('user can update messages in their own chats', async () => {
      // Create a message to update
      const { data: newMsg } = await adminClient
        .from('messages')
        .insert({
          chat_id: testData.chatA.id,
          user_id: testData.userA.id,
          role: 'user',
          content: 'Original message',
        })
        .select('id')
        .single()

      const { error } = await testData.userA.client
        .from('messages')
        .update({ content: 'Updated message' })
        .eq('id', newMsg!.id)

      expect(error).toBeNull()

      // Verify update worked
      const { data: checkData } = await adminClient
        .from('messages')
        .select('content')
        .eq('id', newMsg!.id)
        .single()

      expect(checkData?.content).toBe('Updated message')

      // Cleanup
      await adminClient.from('messages').delete().eq('id', newMsg!.id)
    })

    it('user can delete messages in their own chats', async () => {
      // Create a message to delete
      const { data: newMsg } = await adminClient
        .from('messages')
        .insert({
          chat_id: testData.chatA.id,
          user_id: testData.userA.id,
          role: 'user',
          content: 'Message to delete',
        })
        .select('id')
        .single()

      const { error } = await testData.userA.client.from('messages').delete().eq('id', newMsg!.id)

      expect(error).toBeNull()

      // Verify deleted
      const { data: checkData } = await adminClient
        .from('messages')
        .select('id')
        .eq('id', newMsg!.id)

      expect(checkData).toHaveLength(0)
    })
  })

  describe('chat-scoped ownership writes', () => {
    it('user cannot insert chat turns into other users chats by spoofing user_id', async () => {
      const { data, error } = await testData.userA.client
        .from('chat_turns')
        .insert({
          chat_id: testData.chatB.id,
          user_id: testData.userA.id,
          turn_index: 999,
        })
        .select('id')
        .single()

      expect(error).toBeTruthy()
      expect(data).toBeNull()

      const { data: checkData } = await adminClient
        .from('chat_turns')
        .select('id')
        .eq('chat_id', testData.chatB.id)
        .eq('turn_index', 999)

      expect(checkData).toHaveLength(0)
    })

    it('user cannot enqueue chat jobs into other users chats by spoofing user_id', async () => {
      const { data, error } = await testData.userA.client
        .from('chat_generation_jobs')
        .insert({
          chat_id: testData.chatB.id,
          user_id: testData.userA.id,
          status: 'pending',
          payload: { prompt: 'forged job payload' },
        })
        .select('id')
        .single()

      expect(error).toBeTruthy()
      expect(data).toBeNull()

      const { data: checkData } = await adminClient
        .from('chat_generation_jobs')
        .select('id')
        .eq('chat_id', testData.chatB.id)
        .eq('status', 'pending')

      expect(checkData).toHaveLength(0)
    })
  })

  describe('chat aggregate RPCs', () => {
    it('user can read their own chat aggregates', async () => {
      const { data: chat } = await adminClient
        .from('chats')
        .insert({
          user_id: testData.userA.id,
          character_id: testData.characterA.id,
          title: `RPC Aggregate Chat ${randomUUID()}`,
        })
        .select('id')
        .single()

      expect(chat).not.toBeNull()

      try {
        const { error: messageError } = await adminClient.from('messages').insert({
          chat_id: chat!.id,
          user_id: testData.userA.id,
          role: 'assistant',
          content: 'Aggregate test message',
          prompt_tokens: 12,
          completion_tokens: 5,
        })

        expect(messageError).toBeNull()

        const { error: usageError } = await adminClient.from('chat_usage_events').insert({
          chat_id: chat!.id,
          user_id: testData.userA.id,
          model_provider: 'openai',
          model_name: 'gpt-test',
          prompt_tokens: 12,
          completion_tokens: 5,
          total_tokens: 17,
          cached_input_tokens: 4,
          reasoning_tokens: 2,
          prompt_cost_usd: 0.5,
          completion_cost_usd: 0.25,
          cached_input_cost_usd: 0.125,
          reasoning_cost_usd: 0.0625,
          total_cost_usd: 0.9375,
          request_id: randomUUID(),
        })

        expect(usageError).toBeNull()

        const tokenTotals = await testData.userA.client.rpc('get_chat_token_totals', {
          p_chat_id: chat!.id,
          p_requester: testData.userA.id,
        })

        expect(tokenTotals.error).toBeNull()
        expect(tokenTotals.data).toEqual([
          {
            prompt_tokens: 12,
            completion_tokens: 5,
          },
        ])

        const usageCosts = await testData.userA.client.rpc('get_chat_usage_costs', {
          p_chat_id: chat!.id,
          p_requester: testData.userA.id,
        })

        expect(usageCosts.error).toBeNull()
        expect(usageCosts.data).toEqual([
          {
            prompt_tokens: 12,
            completion_tokens: 5,
            cached_input_tokens: 4,
            reasoning_tokens: 2,
            prompt_cost_usd: 0.5,
            completion_cost_usd: 0.25,
            cached_input_cost_usd: 0.125,
            reasoning_cost_usd: 0.0625,
            total_cost_usd: 0.9375,
          },
        ])
      } finally {
        await adminClient.from('chats').delete().eq('id', chat!.id)
      }
    })

    it('user cannot read another users chat aggregates by passing a forged requester', async () => {
      const tokenTotals = await testData.userB.client.rpc('get_chat_token_totals', {
        p_chat_id: testData.chatA.id,
        p_requester: testData.userA.id,
      })

      expect(tokenTotals.error).toBeTruthy()
      expect(tokenTotals.error?.message.toLowerCase()).toContain('not authorized')

      const usageCosts = await testData.userB.client.rpc('get_chat_usage_costs', {
        p_chat_id: testData.chatA.id,
        p_requester: testData.userA.id,
      })

      expect(usageCosts.error).toBeTruthy()
      expect(usageCosts.error?.message.toLowerCase()).toContain('not authorized')
    })

    it('rejects duplicate usage events for the same request_id', async () => {
      const requestId = randomUUID()
      const baseUsageEvent = {
        chat_id: testData.chatA.id,
        user_id: testData.userA.id,
        model_provider: 'openai',
        model_name: 'gpt-test',
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        request_id: requestId,
      }

      const firstInsert = await adminClient.from('chat_usage_events').insert(baseUsageEvent)
      expect(firstInsert.error).toBeNull()

      const duplicateInsert = await adminClient.from('chat_usage_events').insert(baseUsageEvent)
      expect(duplicateInsert.error).toBeTruthy()
      expect(duplicateInsert.error?.code).toBe('23505')
    })
  })

  describe('job state integrity', () => {
    it('requires successful CharX jobs to persist a result payload', async () => {
      const { data: job, error: insertError } = await adminClient
        .from('charx_import_jobs')
        .insert({
          user_id: testData.userA.id,
          storage_path: `${testData.userA.id}/${randomUUID()}.rbx`,
          original_filename: 'import.rbx',
          file_type: 'application/octet-stream',
          rights_status: 'self_owned',
          rights_attested: true,
          license_type: 'self_owned',
        })
        .select('id')
        .single()

      expect(insertError).toBeNull()
      expect(job).not.toBeNull()

      const invalidSuccess = await adminClient
        .from('charx_import_jobs')
        .update({
          status: 'success',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          result: null,
        })
        .eq('id', job!.id)

      expect(invalidSuccess.error).toBeTruthy()
      expect(invalidSuccess.error?.message.toLowerCase()).toContain('charx_import_jobs_state_shape')
    })

    it('requires processing risum jobs to record started_at', async () => {
      const { data: job, error: insertError } = await adminClient
        .from('risum_import_jobs')
        .insert({
          user_id: testData.userA.id,
          character_id: testData.characterA.id,
          storage_path: `${testData.userA.id}/${randomUUID()}.risum`,
          original_filename: 'archive.risum',
          file_type: 'application/octet-stream',
          rights_status: 'self_owned',
          rights_attested: true,
          license_type: 'self_owned',
        })
        .select('id')
        .single()

      expect(insertError).toBeNull()
      expect(job).not.toBeNull()

      const invalidProcessing = await adminClient
        .from('risum_import_jobs')
        .update({
          status: 'processing',
          started_at: null,
        })
        .eq('id', job!.id)

      expect(invalidProcessing.error).toBeTruthy()
      expect(invalidProcessing.error?.message.toLowerCase()).toContain(
        'risum_import_jobs_state_shape',
      )
    })
  })

  describe('memory range integrity', () => {
    it('blocks overlapping summaries within the same chat and level', async () => {
      const firstSummary = await adminClient.from('chat_summaries').insert({
        chat_id: testData.chatA.id,
        user_id: testData.userA.id,
        level: 0,
        start_seq: 1,
        end_seq: 8,
        summary: 'Chunk one',
      })

      expect(firstSummary.error).toBeNull()

      const overlappingSummary = await adminClient.from('chat_summaries').insert({
        chat_id: testData.chatA.id,
        user_id: testData.userA.id,
        level: 0,
        start_seq: 5,
        end_seq: 12,
        summary: 'Overlapping chunk',
      })

      expect(overlappingSummary.error).toBeTruthy()
      expect(overlappingSummary.error?.message.toLowerCase()).toContain(
        'overlapping chat summary range',
      )

      const differentLevelSummary = await adminClient.from('chat_summaries').insert({
        chat_id: testData.chatA.id,
        user_id: testData.userA.id,
        level: 1,
        start_seq: 1,
        end_seq: 12,
        summary: 'Meta summary covering the same chunk rows',
      })

      expect(differentLevelSummary.error).toBeNull()
    })

    it('blocks overlapping fact ranges within the same chat', async () => {
      const firstFact = await adminClient.from('chat_facts').insert({
        chat_id: testData.chatA.id,
        user_id: testData.userA.id,
        start_seq: 1,
        end_seq: 8,
        facts: 'Fact block one',
      })

      expect(firstFact.error).toBeNull()

      const overlappingFact = await adminClient.from('chat_facts').insert({
        chat_id: testData.chatA.id,
        user_id: testData.userA.id,
        start_seq: 8,
        end_seq: 12,
        facts: 'Fact block two',
      })

      expect(overlappingFact.error).toBeTruthy()
      expect(overlappingFact.error?.message.toLowerCase()).toContain('overlapping chat fact range')
    })
  })

  describe('cross-tenant isolation', () => {
    it('user A listing all characters does not include user B private characters', async () => {
      const { data, error } = await testData.userA.client.from('characters').select('id, name')

      expect(error).toBeNull()

      const ids = data!.map((c) => c.id)
      expect(ids).toContain(testData.characterA.id) // Own character
      expect(ids).toContain(testData.publicCharacter.id) // Public character
      expect(ids).not.toContain(testData.characterB.id) // NOT user B's private
    })

    it('user A listing all chats only returns their own', async () => {
      const { data, error } = await testData.userA.client.from('chats').select('id, title')

      expect(error).toBeNull()

      // Should only contain user A's chats
      const userIds = new Set<string>()
      for (const chat of data || []) {
        const { data: fullChat } = await adminClient
          .from('chats')
          .select('user_id')
          .eq('id', chat.id)
          .single()
        if (fullChat) userIds.add(fullChat.user_id)
      }

      // All chats should belong to user A
      expect(userIds.size).toBeLessThanOrEqual(1)
      if (userIds.size === 1) {
        expect(userIds.has(testData.userA.id)).toBe(true)
      }
    })
  })
})

// Export for potential reuse
export { createTestUser, cleanupTestData }
