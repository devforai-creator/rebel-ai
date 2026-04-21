import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'

import { SUMMARY_LEVEL_CHUNK, SUMMARY_LEVEL_META, SUMMARY_LEVEL_SUPER_META } from './config'
import { createChatSummariesSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'

const mockModel = {} as LanguageModel

const createChunkSummaryMock = vi.fn()
const createChunkFactsMock = vi.fn()
const createHigherLevelSummaryMock = vi.fn()

function createDeleteResultBuilder(error: { message: string } | null) {
  const builder = {
    eq: () => builder,
    then<TResult1 = { error: { message: string } | null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ error }).then(onfulfilled, onrejected)
    },
  }

  return builder
}

function createQueryResultBuilder({
  data,
  error,
}: {
  data: unknown
  error: { message: string } | null
}) {
  const builder = {
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: unknown
            error: { message: string } | null
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data, error }).then(onfulfilled, onrejected)
    },
  }

  return builder
}

vi.mock('./chunk-summarizer', () => ({
  createChunkSummary: (...args: unknown[]) => createChunkSummaryMock(...args),
  createChunkFacts: (...args: unknown[]) => createChunkFactsMock(...args),
}))

vi.mock('./meta-summarizer', () => ({
  createHigherLevelSummary: (...args: unknown[]) => createHigherLevelSummaryMock(...args),
}))

describe('regeneration helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    createChunkSummaryMock.mockReset()
    createChunkFactsMock.mockReset()
    createHigherLevelSummaryMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-ops when regenerateAll is set (not yet implemented)', async () => {
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 1,
          end_seq: 10,
          summary: 'old',
        },
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 11,
          end_seq: 20,
          summary: 'old',
        },
      ],
    })
    const { processRegenerationRequests } = await import('./regeneration')

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      regenerate: { regenerateAll: true },
    })

    expect(createChunkSummaryMock).not.toHaveBeenCalled()
    expect(createChunkFactsMock).not.toHaveBeenCalled()
  })

  it('returns early when regenerate config is not provided', async () => {
    const supabase = createChatSummariesSupabaseMock()
    const { processRegenerationRequests } = await import('./regeneration')

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      regenerate: undefined as unknown as { regenerateAll?: boolean },
    })

    expect(createChunkSummaryMock).not.toHaveBeenCalled()
    expect(createChunkFactsMock).not.toHaveBeenCalled()
    expect(createHigherLevelSummaryMock).not.toHaveBeenCalled()
  })

  it('ignores invalid range entries and de-duplicates overlapping fact requests', async () => {
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 1,
          end_seq: 10,
          summary: 'old',
        },
      ],
    })
    const { processRegenerationRequests } = await import('./regeneration')

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      regenerate: {
        chunkRanges: [
          undefined as unknown as { startSeq: number; endSeq: number },
          { startSeq: 'foo' as unknown as number, endSeq: 10 },
          { startSeq: -1, endSeq: 10 },
          { startSeq: 1, endSeq: 10 },
        ],
        factRanges: [
          { startSeq: 1, endSeq: 10 }, // filtered due to chunk overlap
          { startSeq: 11, endSeq: 20 }, // processed
          { startSeq: 11, endSeq: 20 }, // duplicate
          { startSeq: 20, endSeq: 10 }, // invalid
        ],
      },
    })

    expect(createChunkSummaryMock).toHaveBeenCalledTimes(1)
    expect(createChunkSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ startSeq: 1, endSeq: 10 }),
    )
    expect(createChunkFactsMock).toHaveBeenCalledTimes(2)
    expect(createChunkFactsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ startSeq: 1, endSeq: 10 }),
    )
    expect(createChunkFactsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ startSeq: 11, endSeq: 20 }),
    )
  })

  it('deletes stale chunk facts but skips fact regeneration when fact generation is disabled', async () => {
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 1,
          end_seq: 10,
          summary: 'old',
        },
      ],
      chatFacts: [
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          start_seq: 1,
          end_seq: 10,
          facts: 'old fact',
        },
      ],
    })
    const { processRegenerationRequests } = await import('./regeneration')

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      enableFactGeneration: false,
      regenerate: {
        chunkRanges: [{ startSeq: 1, endSeq: 10 }],
        factRanges: [{ startSeq: 11, endSeq: 20 }],
      },
    })

    expect(createChunkSummaryMock).toHaveBeenCalledTimes(1)
    expect(createChunkSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ startSeq: 1, endSeq: 10 }),
    )
    expect(createChunkFactsMock).not.toHaveBeenCalled()
    expect(supabase.state.chatFacts).toEqual([])
  })

  it('regenerates specific ranges and skips invalid/duplicates', async () => {
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 1,
          end_seq: 10,
          summary: 'old',
        },
      ],
    })
    const { processRegenerationRequests } = await import('./regeneration')

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'google',
      modelName: 'gemini',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      regenerate: {
        chunkRanges: [
          { startSeq: 1, endSeq: 5 }, // invalid size
          { startSeq: 11, endSeq: 20 }, // missing chunk rows -> skip
          { startSeq: 1, endSeq: 10 }, // valid
          { startSeq: 1, endSeq: 10 }, // duplicate
        ],
      },
    })

    expect(createChunkSummaryMock).toHaveBeenCalledTimes(2)
    expect(createChunkSummaryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ startSeq: 11, endSeq: 20, systemPrompt: 'CHUNK' }),
    )
    expect(createChunkSummaryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ startSeq: 1, endSeq: 10, systemPrompt: 'CHUNK' }),
    )
    expect(createChunkFactsMock).toHaveBeenCalledTimes(2)
  })

  it('throws when deleting chunk summary for regeneration fails', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'chat_summaries') {
          return {
            delete: () => createDeleteResultBuilder({ message: 'delete summary failed' }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const { processRegenerationRequests } = await import('./regeneration')

    await expect(
      processRegenerationRequests({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        chunkPrompt: 'CHUNK',
        metaPrompt: 'META',
        factPrompt: 'FACT',
        regenerate: {
          chunkRanges: [{ startSeq: 1, endSeq: 10 }],
        },
      }),
    ).rejects.toThrow('Failed to delete chunk summary for regeneration: delete summary failed')
  })

  it('throws when deleting episodic facts for fact-only regeneration fails', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'chat_facts') {
          return {
            delete: () => createDeleteResultBuilder({ message: 'delete facts failed' }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const { processRegenerationRequests } = await import('./regeneration')

    await expect(
      processRegenerationRequests({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        chunkPrompt: 'CHUNK',
        metaPrompt: 'META',
        factPrompt: 'FACT',
        regenerate: {
          factRanges: [{ startSeq: 1, endSeq: 10 }],
        },
      }),
    ).rejects.toThrow('Failed to delete episodic facts for regeneration: delete facts failed')
  })

  it('skips meta regeneration when no chunk summaries are available', async () => {
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [],
    })
    const { processRegenerationRequests } = await import('./regeneration')

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      regenerate: {
        metaRanges: [{ startSeq: 1, endSeq: 10 }],
      },
    })

    expect(createHigherLevelSummaryMock).not.toHaveBeenCalled()
  })

  it('skips meta regeneration when chunk coverage is inconsistent', async () => {
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 1,
          end_seq: 10,
          summary: 'chunk-1',
        },
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 21,
          end_seq: 30,
          summary: 'chunk-3',
        },
      ],
    })
    const { processRegenerationRequests } = await import('./regeneration')

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      regenerate: {
        metaRanges: [{ startSeq: 1, endSeq: 20 }],
      },
    })

    expect(createHigherLevelSummaryMock).not.toHaveBeenCalled()
  })

  it('throws when loading chunk rows for meta regeneration fails', async () => {
    const supabase = {
      from: (table: string) => {
        if (table !== 'chat_summaries') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          delete: () => createDeleteResultBuilder(null),
          select: (columns: string) => {
            if (columns.includes('summary')) {
              return createQueryResultBuilder({
                data: null,
                error: { message: 'chunk query failed' },
              })
            }

            return createQueryResultBuilder({
              data: [],
              error: null,
            })
          },
        }
      },
    }
    const { processRegenerationRequests } = await import('./regeneration')

    await expect(
      processRegenerationRequests({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        chunkPrompt: 'CHUNK',
        metaPrompt: 'META',
        factPrompt: 'FACT',
        regenerate: {
          metaRanges: [{ startSeq: 1, endSeq: 10 }],
        },
      }),
    ).rejects.toThrow('Failed to load chunk summaries for meta regeneration: chunk query failed')
  })

  it('regenerates meta ranges and rebuilds overlapping super meta', async () => {
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [
        // Chunk summaries for 1-40
        ...Array.from({ length: 4 }, (_, idx) => ({
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: idx * 10 + 1,
          end_seq: idx * 10 + 10,
          summary: `chunk-${idx}`,
        })),
        // Meta summaries covering 1-40 (one will be regenerated)
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_META,
          start_seq: 1,
          end_seq: 10,
          summary: 'meta-1-10',
        },
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_META,
          start_seq: 11,
          end_seq: 20,
          summary: 'meta-11-20',
        },
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_META,
          start_seq: 21,
          end_seq: 30,
          summary: 'meta-21-30',
        },
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_META,
          start_seq: 31,
          end_seq: 40,
          summary: 'meta-31-40',
        },
        // Overlapping super meta to refresh
        {
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: SUMMARY_LEVEL_SUPER_META,
          start_seq: 1,
          end_seq: 40,
          summary: 'super-old',
        },
      ],
    })
    const { processRegenerationRequests } = await import('./regeneration')
    createHigherLevelSummaryMock.mockImplementation(
      async ({ supabase: sb, startSeq, endSeq, targetLevel }) => {
        const summaries = sb.state.chatSummaries as Array<Record<string, unknown>>
        summaries.push({
          chat_id: 'chat-1',
          user_id: 'user-1',
          level: targetLevel,
          start_seq: startSeq,
          end_seq: endSeq,
          summary: `new-${startSeq}-${endSeq}`,
        })
      },
    )

    await processRegenerationRequests({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      chunkPrompt: 'CHUNK',
      metaPrompt: 'META',
      factPrompt: 'FACT',
      regenerate: {
        metaRanges: [{ startSeq: 1, endSeq: 10 }],
      },
    })

    // Meta re-created for the requested range
    expect(createHigherLevelSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ startSeq: 1, endSeq: 10, targetLevel: SUMMARY_LEVEL_META }),
    )
    // Super meta rebuilt for overlapping range
    expect(createHigherLevelSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ startSeq: 1, endSeq: 40, targetLevel: SUMMARY_LEVEL_SUPER_META }),
    )
    const allSummaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    const remainingMeta = allSummaries.filter(
      (row) => row.level === SUMMARY_LEVEL_META && row.start_seq === 21,
    )
    expect(remainingMeta).toHaveLength(1)
  })
})
