import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateFactEmbedding } from '@/lib/embeddings'
import type { ChatSummariesSupabaseClient, SanitizedMessage } from './types'
import { CONTEXT_WINDOW } from './config'
import { buildContext, searchRelevantFacts } from './context-builder'

vi.mock('@/lib/embeddings', () => ({
  generateFactEmbedding: vi.fn(),
}))

type StubError = { message: string; code?: string; details?: string }

function makeMessages(count: number): SanitizedMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index + 1}`,
  }))
}

function createSupabaseStub(options?: {
  latestSequence?: number | null
  latestSequenceError?: StubError | null
  summariesData?: Array<{
    level: number
    start_seq: number
    end_seq: number
    summary: string
  }> | null
  summaryError?: StubError | null
  factsData?: Array<{ start_seq: number; end_seq: number; facts: string }> | null
  factsError?: StubError | null
  chatOwnerId?: string | null
  chatOwnerError?: StubError | null
  profileEnableRag?: boolean
  profileError?: StubError | null
  ragFactsData?: Array<{
    start_seq: number
    end_seq: number
    facts: string
    similarity?: number
  }> | null
  ragError?: StubError | null
}): ChatSummariesSupabaseClient {
  const latestSequence = options?.latestSequence
  const latestSequenceError = options?.latestSequenceError ?? null

  const chatTurnsQuery = {
    select: () => chatTurnsQuery,
    eq: () => chatTurnsQuery,
    then<TResult1 = { data: unknown; error: StubError | null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: StubError | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (latestSequenceError) {
        return Promise.resolve({ data: null, error: latestSequenceError }).then(
          onfulfilled,
          onrejected,
        )
      }
      return Promise.resolve({
        data: Array.from({ length: latestSequence ?? 0 }, (_, index) => ({
          user_message_id: `user-${index + 1}`,
          active_assistant_message_id: null,
        })),
        error: null,
      }).then(onfulfilled, onrejected)
    },
  }

  const summaryQuery = {
    select: () => summaryQuery,
    eq: () => summaryQuery,
    lte: () => summaryQuery,
    order: () => summaryQuery,
    data: options?.summariesData ?? [],
    error: options?.summaryError ?? null,
  }

  const factsQuery = {
    select: () => factsQuery,
    eq: () => factsQuery,
    lte: () => factsQuery,
    order: () => factsQuery,
    data: options?.factsData ?? [],
    error: options?.factsError ?? null,
  }

  const chatsQuery = {
    select: () => chatsQuery,
    eq: () => chatsQuery,
    single: async () => {
      if (options?.chatOwnerError) {
        return { data: null, error: options.chatOwnerError }
      }
      if (options?.chatOwnerId) {
        return { data: { user_id: options.chatOwnerId }, error: null }
      }
      return { data: null, error: null }
    },
  }

  const profilesQuery = {
    select: () => profilesQuery,
    eq: () => profilesQuery,
    single: async () => {
      if (options?.profileError) {
        return { data: null, error: options.profileError }
      }
      return {
        data: { enable_episodic_rag: options?.profileEnableRag ?? false },
        error: null,
      }
    },
  }

  return {
    from: (table: string) => {
      if (table === 'messages') {
        return {}
      }
      if (table === 'chat_turns') {
        return chatTurnsQuery
      }
      if (table === 'chat_summaries') {
        return summaryQuery
      }
      if (table === 'chat_facts') {
        return factsQuery
      }
      if (table === 'chats') {
        return chatsQuery
      }
      if (table === 'profiles') {
        return profilesQuery
      }
      throw new Error(`Unexpected table: ${table}`)
    },
    rpc: async () => ({
      data: options?.ragFactsData ?? [],
      error: options?.ragError ?? null,
    }),
  } as unknown as ChatSummariesSupabaseClient
}

const generateFactEmbeddingMock = vi.mocked(generateFactEmbedding)

beforeEach(() => {
  generateFactEmbeddingMock.mockReset()
  generateFactEmbeddingMock.mockResolvedValue([0.1])
})

describe('searchRelevantFacts', () => {
  it('returns empty array when recent messages are empty', async () => {
    const supabase = createSupabaseStub()

    const result = await searchRelevantFacts({
      supabase,
      chatId: 'chat-1',
      userId: 'user-1',
      recentMessages: [],
    })

    expect(result).toEqual([])
    expect(generateFactEmbeddingMock).not.toHaveBeenCalled()
  })

  it('returns empty array when embedding generation fails', async () => {
    generateFactEmbeddingMock.mockResolvedValueOnce(null)
    const supabase = createSupabaseStub()

    const result = await searchRelevantFacts({
      supabase,
      chatId: 'chat-1',
      userId: 'user-1',
      recentMessages: makeMessages(3),
    })

    expect(result).toEqual([])
  })

  it('returns empty array when similarity RPC fails', async () => {
    const supabase = createSupabaseStub({
      ragError: { message: 'rpc failure', code: 'XX001', details: 'db unavailable' },
    })

    const result = await searchRelevantFacts({
      supabase,
      chatId: 'chat-1',
      userId: 'user-1',
      recentMessages: makeMessages(4),
    })

    expect(result).toEqual([])
  })

  it('handles null RPC data and returns empty array', async () => {
    const supabase = createSupabaseStub({
      ragFactsData: null,
    })

    const result = await searchRelevantFacts({
      supabase,
      chatId: 'chat-1',
      userId: 'user-1',
      recentMessages: makeMessages(2),
    })

    expect(result).toEqual([])
  })

  it('returns matched facts including long previews and similarities', async () => {
    const supabase = createSupabaseStub({
      ragFactsData: [
        {
          start_seq: 1,
          end_seq: 2,
          facts: 'x'.repeat(120),
          similarity: 0.9876,
        },
        {
          start_seq: 3,
          end_seq: 4,
          facts: 'short fact',
        },
      ],
    })

    const result = await searchRelevantFacts({
      supabase,
      chatId: 'chat-1',
      userId: 'user-1',
      recentMessages: makeMessages(5),
    })

    expect(result).toHaveLength(2)
    expect(result[0].similarity).toBeCloseTo(0.9876)
  })
})

describe('buildContext branches', () => {
  it('normalizes extra dynamic context and supports empty base prompt', async () => {
    const supabase = createSupabaseStub()

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(5),
      baseSystemPrompt: '   ',
      extraDynamicContext: ['', '  ', 'Lore block', '\n'],
    })

    expect(result.dynamicContext).toBe('Lore block')
    expect(result.systemPrompt).toBe('Lore block')
  })

  it('falls back to local message count when latest sequence is unavailable', async () => {
    const supabase = createSupabaseStub({
      latestSequence: null,
      summariesData: [
        {
          level: 1,
          start_seq: 1,
          end_seq: 10,
          summary: 'Summary from fallback cutoff',
        },
      ],
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 5),
      baseSystemPrompt: 'BASE',
    })

    expect(result.systemPrompt).toContain('Summary from fallback cutoff')
  })

  it('returns base-only context when computed summary cutoff is non-positive', async () => {
    const supabase = createSupabaseStub({
      latestSequence: 10,
      summariesData: [
        {
          level: 1,
          start_seq: 1,
          end_seq: 2,
          summary: 'Should not be used',
        },
      ],
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 2),
      baseSystemPrompt: 'BASE',
    })

    expect(result.systemPrompt).toBe('BASE')
  })

  it('falls back when summary query fails', async () => {
    const supabase = createSupabaseStub({
      latestSequence: CONTEXT_WINDOW + 10,
      summaryError: { message: 'summary query failed' },
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 5),
      baseSystemPrompt: 'BASE',
    })

    expect(result.systemPrompt).toBe('BASE')
  })

  it('handles null summaries/facts payloads from Supabase', async () => {
    const supabase = createSupabaseStub({
      latestSequence: CONTEXT_WINDOW + 20,
      summariesData: null,
      factsData: null,
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 6),
      baseSystemPrompt: 'BASE',
    })

    expect(result.systemPrompt).toBe('BASE')
  })

  it('keeps summaries when facts query fails', async () => {
    const supabase = createSupabaseStub({
      latestSequence: CONTEXT_WINDOW + 20,
      summariesData: [
        {
          level: 1,
          start_seq: 1,
          end_seq: 10,
          summary: 'Persisted summary',
        },
      ],
      factsError: { message: 'facts query failed' },
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 5),
      baseSystemPrompt: 'BASE',
    })

    expect(result.systemPrompt).toContain('Persisted summary')
    expect(result.systemPrompt).not.toContain('=== Key Facts to Remember ===')
  })

  it('handles chat owner/profile query errors without throwing', async () => {
    const ownerErrorSupabase = createSupabaseStub({
      latestSequence: CONTEXT_WINDOW + 20,
      chatOwnerError: { message: 'owner lookup failed' },
      summariesData: [
        {
          level: 1,
          start_seq: 1,
          end_seq: 10,
          summary: 'Owner-error summary',
        },
      ],
    })
    const ownerErrorResult = await buildContext({
      supabase: ownerErrorSupabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 5),
      baseSystemPrompt: 'BASE',
    })
    expect(ownerErrorResult.systemPrompt).toContain('Owner-error summary')

    const profileErrorSupabase = createSupabaseStub({
      latestSequence: CONTEXT_WINDOW + 20,
      chatOwnerId: 'user-1',
      profileError: { message: 'profile lookup failed' },
      summariesData: [
        {
          level: 1,
          start_seq: 1,
          end_seq: 10,
          summary: 'Profile-error summary',
        },
      ],
    })
    const profileErrorResult = await buildContext({
      supabase: profileErrorSupabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 5),
      baseSystemPrompt: 'BASE',
    })

    expect(profileErrorResult.systemPrompt).toContain('Profile-error summary')
    expect(profileErrorResult.ragInfo?.enabled).toBe(false)
  })

  it('uses RAG results with relevance heading and preview truncation', async () => {
    const supabase = createSupabaseStub({
      latestSequence: CONTEXT_WINDOW + 30,
      chatOwnerId: 'user-1',
      profileEnableRag: true,
      factsData: [{ start_seq: 1, end_seq: 2, facts: 'fallback fact should be ignored' }],
      ragFactsData: [
        {
          start_seq: 90,
          end_seq: 100,
          facts: 'a'.repeat(120),
          similarity: 0.9123,
        },
        {
          start_seq: 101,
          end_seq: 110,
          facts: 'short rag fact',
          similarity: 0.5,
        },
      ],
    })
    generateFactEmbeddingMock.mockResolvedValueOnce([0.42])

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: makeMessages(CONTEXT_WINDOW + 10),
      baseSystemPrompt: 'BASE',
    })

    expect(result.systemPrompt).toContain('=== Key Facts to Remember (by relevance) ===')
    expect(result.systemPrompt).toContain('short rag fact')
    expect(result.systemPrompt).not.toContain('fallback fact should be ignored')
    expect(result.ragInfo?.enabled).toBe(true)
    expect(result.ragInfo?.results[0]?.preview.endsWith('...')).toBe(true)
    expect(result.ragInfo?.results[1]?.preview.endsWith('...')).toBe(false)
  })
})
