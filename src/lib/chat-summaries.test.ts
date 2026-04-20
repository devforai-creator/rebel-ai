import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSummariesSupabaseClient } from './chat-summaries'
import {
  buildContext,
  calculateChunkBoundaries,
  formatSummarySegments,
  areChunksSequential,
  SUMMARY_CONFIG,
  type SanitizedMessage,
} from './chat-summaries'
import { generateFactEmbedding } from '@/lib/embeddings'

vi.mock('@/lib/embeddings', () => ({
  generateFactEmbedding: vi.fn(),
}))

function createSupabaseStub<T>({
  summaries,
  latestSequence = null,
  facts = [],
  ragFacts = [],
  enableRag = false,
  chatOwnerId = 'user-1',
}: {
  summaries: T
  latestSequence?: number | null
  facts?: Array<{ start_seq: number; end_seq: number; facts: string }>
  ragFacts?: Array<{ start_seq: number; end_seq: number; facts: string }>
  enableRag?: boolean
  chatOwnerId?: string | null
}): ChatSummariesSupabaseClient {
  const summaryQuery = {
    select() {
      return summaryQuery
    },
    eq() {
      return summaryQuery
    },
    lte() {
      return summaryQuery
    },
    order() {
      return summaryQuery
    },
    data: summaries,
    error: null,
  }

  const messagesQuery = {
    select() {
      return messagesQuery
    },
    eq() {
      return messagesQuery
    },
    order() {
      return messagesQuery
    },
    limit() {
      return messagesQuery
    },
    maybeSingle() {
      if (typeof latestSequence === 'number') {
        return {
          data: { sequence: latestSequence },
          error: null,
        }
      }

      return {
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      }
    },
  }

  const factsQuery = {
    select() {
      return factsQuery
    },
    eq() {
      return factsQuery
    },
    lte() {
      return factsQuery
    },
    order() {
      return factsQuery
    },
    data: facts,
    error: null,
  }

  const chatsQuery = {
    select() {
      return chatsQuery
    },
    eq() {
      return chatsQuery
    },
    single() {
      if (chatOwnerId) {
        return {
          data: { user_id: chatOwnerId },
          error: null,
        }
      }
      return {
        data: null,
        error: { message: 'Not found' },
      }
    },
  }

  const profilesQuery = {
    select() {
      return profilesQuery
    },
    eq() {
      return profilesQuery
    },
    single() {
      return {
        data: { enable_episodic_rag: enableRag },
        error: null,
      }
    },
  }

  return {
    from(table: string) {
      if (table === 'chat_summaries') {
        return summaryQuery
      }

      if (table === 'messages') {
        return messagesQuery
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
    rpc(name: string) {
      if (name === 'match_chat_facts') {
        return {
          data: ragFacts,
          error: null,
        }
      }
      throw new Error(`Unexpected rpc: ${name}`)
    },
  } as unknown as ChatSummariesSupabaseClient
}

function makeMessages(count: number): SanitizedMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index + 1}`,
  }))
}

const generateFactEmbeddingMock = vi.mocked(generateFactEmbedding)

beforeEach(() => {
  generateFactEmbeddingMock.mockReset()
  generateFactEmbeddingMock.mockResolvedValue(null)
})

describe('formatSummarySegments', () => {
  it('labels chunk, meta, and super meta summaries correctly', () => {
    const segments = formatSummarySegments([
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 1,
        end_seq: 10,
        summary: ' First chunk. ',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_META,
        start_seq: 1,
        end_seq: 100,
        summary: ' Meta summary ',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_SUPER_META,
        start_seq: 1,
        end_seq: 400,
        summary: ' Super meta summary ',
      },
    ])

    expect(segments).toEqual([
      '[Summary 1-10]\nFirst chunk.',
      '[Meta Summary 1-100]\nMeta summary',
      '[Super Meta Summary 1-400]\nSuper meta summary',
    ])
  })
})

describe('calculateChunkBoundaries', () => {
  const { CONTEXT_WINDOW, CHUNK_SIZE } = SUMMARY_CONFIG

  it('emits first chunk once total messages reach the trigger point', () => {
    const totalMessages = CONTEXT_WINDOW
    expect(calculateChunkBoundaries(totalMessages, 0)).toEqual([{ start: 1, end: 10 }])
  })

  it('returns sequential chunk ranges up to the cut-off', () => {
    const totalMessages = CONTEXT_WINDOW + CHUNK_SIZE * 2
    expect(calculateChunkBoundaries(totalMessages, 0)).toEqual([
      { start: 1, end: 10 },
      { start: 11, end: 20 },
      { start: 21, end: 30 },
    ])
  })

  it('respects previously summarized range', () => {
    const totalMessages = CONTEXT_WINDOW + CHUNK_SIZE * 3
    expect(calculateChunkBoundaries(totalMessages, 20)).toEqual([
      { start: 21, end: 30 },
      { start: 31, end: 40 },
    ])
  })

  it('does not emit new chunks if we are between triggers', () => {
    const totalMessages = CONTEXT_WINDOW + CHUNK_SIZE - 1
    expect(calculateChunkBoundaries(totalMessages, CHUNK_SIZE)).toEqual([])
    expect(calculateChunkBoundaries(totalMessages, CHUNK_SIZE * 2)).toEqual([])
  })

  it('skips chunks already summarized', () => {
    const totalMessages = CONTEXT_WINDOW + CHUNK_SIZE * 4
    expect(calculateChunkBoundaries(totalMessages, 30)).toEqual([
      { start: 31, end: 40 },
      { start: 41, end: 50 },
    ])
  })
})

describe('areChunksSequential', () => {
  it('returns true for adjacent chunk ranges', () => {
    expect(
      areChunksSequential([
        { start_seq: 1, end_seq: 10 },
        { start_seq: 11, end_seq: 20 },
        { start_seq: 21, end_seq: 30 },
      ]),
    ).toBe(true)
  })

  it('returns false when chunks have gaps', () => {
    expect(
      areChunksSequential([
        { start_seq: 1, end_seq: 10 },
        { start_seq: 12, end_seq: 21 },
      ]),
    ).toBe(false)
  })
})

describe('buildContext', () => {
  it('falls back to base prompt when summaries absent', async () => {
    const supabase = createSupabaseStub({ summaries: [] })
    const messages = makeMessages(5)

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      baseSystemPrompt: 'BASE PROMPT',
    })

    expect(result.systemPrompt).toBe('BASE PROMPT')
    expect(result.recentMessages).toEqual(messages)
  })

  it('includes summaries and trims to context window', async () => {
    const summaries = [
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_META,
        start_seq: 1,
        end_seq: 100,
        summary: 'Important high-level recap.',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 101,
        end_seq: 110,
        summary: 'Detailed chunk recap.',
      },
    ]
    const messages = makeMessages(25)
    const supabase = createSupabaseStub({
      summaries,
      latestSequence: messages.length,
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      baseSystemPrompt: 'BASE PROMPT',
    })

    expect(result.recentMessages).toHaveLength(SUMMARY_CONFIG.CONTEXT_WINDOW)
    expect(result.recentMessages[0]).toEqual(messages[5])
    expect(result.systemPrompt).toContain('BASE PROMPT')
    expect(result.systemPrompt).toContain('[Meta Summary 1-100]')
    expect(result.systemPrompt).toContain('[Summary 101-110]')
  })

  it('filters out chunk summaries covered by meta summaries', async () => {
    const summaries = [
      // Meta summary covering 1-100
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_META,
        start_seq: 1,
        end_seq: 100,
        summary: 'Meta summary for messages 1-100.',
      },
      // These chunks are covered by meta summary (should be filtered out)
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 1,
        end_seq: 10,
        summary: 'Chunk 1-10 (should be filtered).',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 11,
        end_seq: 20,
        summary: 'Chunk 11-20 (should be filtered).',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 91,
        end_seq: 100,
        summary: 'Chunk 91-100 (should be filtered).',
      },
      // This chunk is outside meta range (should be kept)
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 101,
        end_seq: 110,
        summary: 'Chunk 101-110 (should be kept).',
      },
    ]
    const messages = makeMessages(130)
    const supabase = createSupabaseStub({
      summaries,
      latestSequence: messages.length,
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      baseSystemPrompt: 'BASE PROMPT',
    })

    expect(result.systemPrompt).toContain('[Meta Summary 1-100]')
    expect(result.systemPrompt).toContain('Meta summary for messages 1-100')
    expect(result.systemPrompt).toContain('[Summary 101-110]')
    expect(result.systemPrompt).toContain('Chunk 101-110 (should be kept)')

    // These chunks should NOT appear in the prompt
    expect(result.systemPrompt).not.toContain('Chunk 1-10 (should be filtered)')
    expect(result.systemPrompt).not.toContain('Chunk 11-20 (should be filtered)')
    expect(result.systemPrompt).not.toContain('Chunk 91-100 (should be filtered)')
  })

  // NOTE: Super-meta summaries are currently disabled in the active pipeline.
  // The test for 'prefers super meta summaries over overlapping meta and chunk summaries'
  // was removed as the feature is not in use. Re-add when super-meta is re-enabled.

  it('bases the summary cutoff on the latest stored message sequence', async () => {
    const summaries = [
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_META,
        start_seq: 1,
        end_seq: 100,
        summary: 'Meta 1-100.',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 101,
        end_seq: 110,
        summary: 'Chunk 101-110 that should be included.',
      },
    ]
    const messages = makeMessages(40) // Client only has the last 40 messages locally.
    const supabase = createSupabaseStub({
      summaries,
      latestSequence: 300, // Server knows the chat already has 300 messages.
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      baseSystemPrompt: 'BASE PROMPT',
    })

    expect(result.systemPrompt).toContain('[Meta Summary 1-100]')
    expect(result.systemPrompt).toContain('Meta 1-100.')
    expect(result.systemPrompt).toContain('[Summary 101-110]')
    expect(result.systemPrompt).toContain('Chunk 101-110 that should be included.')
  })

  it('keeps all chunk summaries when no meta summaries exist', async () => {
    const summaries = [
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 1,
        end_seq: 10,
        summary: 'Chunk 1-10.',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 11,
        end_seq: 20,
        summary: 'Chunk 11-20.',
      },
      {
        level: SUMMARY_CONFIG.SUMMARY_LEVEL_CHUNK,
        start_seq: 21,
        end_seq: 30,
        summary: 'Chunk 21-30.',
      },
    ]
    const messages = makeMessages(50)
    const supabase = createSupabaseStub({
      summaries,
      latestSequence: messages.length,
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      baseSystemPrompt: 'BASE PROMPT',
    })

    expect(result.systemPrompt).toContain('[Summary 1-10]')
    expect(result.systemPrompt).toContain('Chunk 1-10')
    expect(result.systemPrompt).toContain('[Summary 11-20]')
    expect(result.systemPrompt).toContain('Chunk 11-20')
    expect(result.systemPrompt).toContain('[Summary 21-30]')
    expect(result.systemPrompt).toContain('Chunk 21-30')
  })

  it('keeps stored episodic facts out of context when RAG is disabled', async () => {
    const messages = makeMessages(30)
    const supabase = createSupabaseStub({
      summaries: [],
      latestSequence: messages.length,
      facts: [{ start_seq: 1, end_seq: 10, facts: '- User likes spicy food' }],
      enableRag: false,
    })

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      baseSystemPrompt: 'BASE PROMPT',
    })

    expect(result.systemPrompt).not.toContain('=== Key Facts to Remember ===')
    expect(result.systemPrompt).not.toContain('User likes spicy food')
  })

  it('prefers semantic search facts when embeddings are available', async () => {
    const messages = makeMessages(30)
    const supabase = createSupabaseStub({
      summaries: [],
      latestSequence: messages.length,
      facts: [{ start_seq: 1, end_seq: 10, facts: '- fallback fact' }],
      ragFacts: [{ start_seq: 90, end_seq: 100, facts: '- rag-selected fact' }],
      enableRag: true,
    })

    generateFactEmbeddingMock.mockResolvedValueOnce([0.01])

    const result = await buildContext({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      baseSystemPrompt: 'BASE PROMPT',
    })

    expect(result.systemPrompt).toContain('=== Key Facts to Remember (by relevance) ===')
    expect(result.systemPrompt).toContain('rag-selected fact')
    expect(result.systemPrompt).not.toContain('fallback fact')
  })
})
