import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMessageCount, getLatestMessageSequence, getLastSummaryEnd } from './db-helpers'
import { createChatSummariesSupabaseMock } from '@/tests/mocks/supabase'
import type { ServerSupabaseClient } from './types'

describe('db-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getMessageCount', () => {
    it('returns message count on success', async () => {
      const supabase = createChatSummariesSupabaseMock({
        messages: [
          { id: '1', chat_id: 'chat-1', sequence: 1, role: 'user', content: 'Hello' },
          { id: '2', chat_id: 'chat-1', sequence: 2, role: 'assistant', content: 'Hi' },
          { id: '3', chat_id: 'chat-1', sequence: 3, role: 'user', content: 'How are you?' },
        ],
      })

      const result = await getMessageCount(supabase as unknown as ServerSupabaseClient, 'chat-1')

      expect(result).toBe(3)
    })

    it('returns 0 when no messages exist', async () => {
      const supabase = createChatSummariesSupabaseMock({
        messages: [],
      })

      const result = await getMessageCount(supabase as unknown as ServerSupabaseClient, 'chat-1')

      expect(result).toBe(0)
    })

    it('filters by chat_id', async () => {
      const supabase = createChatSummariesSupabaseMock({
        messages: [
          { id: '1', chat_id: 'chat-1', sequence: 1, role: 'user', content: 'Hello' },
          { id: '2', chat_id: 'chat-2', sequence: 1, role: 'user', content: 'Hi' },
          { id: '3', chat_id: 'chat-1', sequence: 2, role: 'assistant', content: 'Hey' },
        ],
      })

      const result = await getMessageCount(supabase as unknown as ServerSupabaseClient, 'chat-1')

      expect(result).toBe(2)
    })

    it('returns null and logs error on failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Create a mock that returns an error
      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({ count: null, error: { message: 'Database error' } }),
          }),
        }),
      }

      const result = await getMessageCount(supabase as unknown as ServerSupabaseClient, 'chat-1')

      expect(result).toBeNull()
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to count messages:', 'Database error')
    })
  })

  describe('getLatestMessageSequence', () => {
    it('returns latest sequence number', async () => {
      const supabase = createChatSummariesSupabaseMock({
        messages: [
          { id: '1', chat_id: 'chat-1', sequence: 1, role: 'user', content: 'Hello' },
          { id: '2', chat_id: 'chat-1', sequence: 5, role: 'assistant', content: 'Hi' },
          { id: '3', chat_id: 'chat-1', sequence: 10, role: 'user', content: 'Bye' },
        ],
      })

      const result = await getLatestMessageSequence(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
      )

      expect(result).toBe(10)
    })

    it('returns null when no messages exist', async () => {
      const supabase = createChatSummariesSupabaseMock({
        messages: [],
      })

      const result = await getLatestMessageSequence(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
      )

      expect(result).toBeNull()
    })

    it('filters by chat_id', async () => {
      const supabase = createChatSummariesSupabaseMock({
        messages: [
          { id: '1', chat_id: 'chat-1', sequence: 5, role: 'user', content: 'Hello' },
          { id: '2', chat_id: 'chat-2', sequence: 100, role: 'user', content: 'Hi' },
        ],
      })

      const result = await getLatestMessageSequence(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
      )

      expect(result).toBe(5)
    })

    it('returns null and logs error on non-PGRST116 error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null,
                      error: { code: 'OTHER_ERROR', message: 'Something went wrong' },
                    }),
                }),
              }),
            }),
          }),
        }),
      }

      const result = await getLatestMessageSequence(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
      )

      expect(result).toBeNull()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch latest message sequence:',
        'Something went wrong',
      )
    })

    it('returns null silently on PGRST116 (no rows) error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null,
                      error: { code: 'PGRST116', message: 'No rows found' },
                    }),
                }),
              }),
            }),
          }),
        }),
      }

      const result = await getLatestMessageSequence(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
      )

      expect(result).toBeNull()
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('getLastSummaryEnd', () => {
    it('returns last summary end_seq', async () => {
      const supabase = createChatSummariesSupabaseMock({
        chatSummaries: [
          { chat_id: 'chat-1', level: 0, start_seq: 1, end_seq: 10, summary: 'First' },
          { chat_id: 'chat-1', level: 0, start_seq: 11, end_seq: 20, summary: 'Second' },
          { chat_id: 'chat-1', level: 0, start_seq: 21, end_seq: 30, summary: 'Third' },
        ],
      })

      const result = await getLastSummaryEnd(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
        0,
      )

      expect(result).toBe(30)
    })

    it('returns null when no summaries exist', async () => {
      const supabase = createChatSummariesSupabaseMock({
        chatSummaries: [],
      })

      const result = await getLastSummaryEnd(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
        0,
      )

      expect(result).toBeNull()
    })

    it('filters by chat_id and level', async () => {
      const supabase = createChatSummariesSupabaseMock({
        chatSummaries: [
          { chat_id: 'chat-1', level: 0, start_seq: 1, end_seq: 10, summary: 'Chunk' },
          { chat_id: 'chat-1', level: 1, start_seq: 1, end_seq: 50, summary: 'Meta' },
          { chat_id: 'chat-2', level: 0, start_seq: 1, end_seq: 100, summary: 'Other chat' },
        ],
      })

      // Get level 0 for chat-1
      const result0 = await getLastSummaryEnd(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
        0,
      )
      expect(result0).toBe(10)

      // Get level 1 for chat-1
      const result1 = await getLastSummaryEnd(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
        1,
      )
      expect(result1).toBe(50)
    })

    it('returns null and logs error on non-PGRST116 error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: null,
                        error: { code: 'DB_ERROR', message: 'Connection failed' },
                      }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }

      const result = await getLastSummaryEnd(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
        0,
      )

      expect(result).toBeNull()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch last summary end:',
        'Connection failed',
      )
    })

    it('returns null silently on PGRST116 (no rows) error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const supabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: null,
                        error: { code: 'PGRST116', message: 'No rows found' },
                      }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }

      const result = await getLastSummaryEnd(
        supabase as unknown as ServerSupabaseClient,
        'chat-1',
        0,
      )

      expect(result).toBeNull()
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
  })
})
