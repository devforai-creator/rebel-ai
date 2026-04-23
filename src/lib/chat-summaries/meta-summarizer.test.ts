import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'

import {
  SUMMARY_GROUP_SIZE,
  SUPER_SUMMARY_GROUP_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
} from './config'
import { createChatSummariesSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'

const mockModel = {} as LanguageModel

const generateSummaryWithFallbackMock = vi.fn()
const getLastSummaryEndMock = vi.fn()

vi.mock('./chunk-summarizer', async () => {
  const actual = await vi.importActual<typeof import('./chunk-summarizer')>('./chunk-summarizer')
  return {
    ...actual,
    generateSummaryWithFallback: (...args: unknown[]) => generateSummaryWithFallbackMock(...args),
  }
})

vi.mock('./db-helpers', async () => {
  const actual = await vi.importActual<typeof import('./db-helpers')>('./db-helpers')
  return {
    ...actual,
    getLastSummaryEnd: (...args: unknown[]) => getLastSummaryEndMock(...args),
  }
})

describe('meta-summarizer', () => {
  beforeEach(() => {
    vi.resetModules()
    generateSummaryWithFallbackMock.mockReset()
    getLastSummaryEndMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates higher-level summary and stores it', async () => {
    generateSummaryWithFallbackMock.mockResolvedValue({
      summaryText: 'meta summary',
      summaryStatus: 'ok',
      tokenCount: 7,
      finishReason: 'stop',
    })
    const supabase = createChatSummariesSupabaseMock()
    const { createHigherLevelSummary } = await import('./meta-summarizer')

    await createHigherLevelSummary({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      segments: [
        { start_seq: 1, end_seq: 10, summary: 's1' },
        { start_seq: 11, end_seq: 20, summary: 's2' },
      ],
      startSeq: 1,
      endSeq: 20,
      systemPrompt: 'META',
      targetLevel: SUMMARY_LEVEL_META,
      fallbackLabel: 'meta 1-20',
    })

    expect(generateSummaryWithFallbackMock).toHaveBeenCalled()
    const chatSummaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    expect(chatSummaries).toHaveLength(1)
    expect(chatSummaries[0]).toMatchObject({
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_META,
      start_seq: 1,
      end_seq: 20,
      summary: 'meta summary',
      summary_status: 'ok',
      token_count: 7,
    })
  })

  it('stores fallback status for higher-level summaries when fallback content is selected', async () => {
    generateSummaryWithFallbackMock.mockResolvedValue({
      summaryText: 'fallback meta summary',
      summaryStatus: 'fallback',
      tokenCount: null,
      finishReason: 'error',
    })
    const supabase = createChatSummariesSupabaseMock()
    const { createHigherLevelSummary } = await import('./meta-summarizer')

    await createHigherLevelSummary({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      segments: [
        { start_seq: 1, end_seq: 10, summary: 's1' },
        { start_seq: 11, end_seq: 20, summary: 's2' },
      ],
      startSeq: 1,
      endSeq: 20,
      systemPrompt: 'META',
      targetLevel: SUMMARY_LEVEL_META,
      fallbackLabel: 'meta 1-20',
    })

    const chatSummaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    expect(chatSummaries).toHaveLength(1)
    expect(chatSummaries[0]).toMatchObject({
      summary: 'fallback meta summary',
      summary_status: 'fallback',
      token_count: null,
    })
  })

  it('updates an existing exact-range higher-level summary when persistence reports overlap', async () => {
    generateSummaryWithFallbackMock.mockResolvedValue({
      summaryText: 'replacement meta summary',
      summaryStatus: 'ok',
      tokenCount: 11,
      finishReason: 'stop',
    })

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'meta-1' },
      error: null,
    })

    const updateBuilder = {
      eq: vi.fn(),
      select: vi.fn(() => ({
        maybeSingle: maybeSingleMock,
      })),
    }
    updateBuilder.eq.mockReturnValue(updateBuilder)

    let updatePayload: Record<string, unknown> | null = null
    const supabase = {
      from: (table: string) => {
        if (table !== 'chat_summaries') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          upsert: async () => ({
            error: {
              code: '23514',
              message: 'Overlapping chat summary range for this chat/level',
            },
          }),
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload
            return updateBuilder
          },
        }
      },
    }
    const { createHigherLevelSummary } = await import('./meta-summarizer')

    await expect(
      createHigherLevelSummary({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        segments: [
          { start_seq: 1, end_seq: 10, summary: 's1' },
          { start_seq: 11, end_seq: 20, summary: 's2' },
        ],
        startSeq: 1,
        endSeq: 20,
        systemPrompt: 'META',
        targetLevel: SUMMARY_LEVEL_META,
        fallbackLabel: 'meta 1-20',
      }),
    ).resolves.toBeUndefined()

    expect(updatePayload).toEqual({
      summary: 'replacement meta summary',
      summary_status: 'ok',
      token_count: 11,
    })
    expect(maybeSingleMock).toHaveBeenCalled()
  })

  it('processes meta summaries when enough sequential chunks exist', async () => {
    generateSummaryWithFallbackMock.mockResolvedValue({
      summaryText: 'meta summary',
      summaryStatus: 'ok',
      tokenCount: 1,
      finishReason: 'stop',
    })
    getLastSummaryEndMock.mockResolvedValue(0)
    const chunks = Array.from({ length: SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 10 + 1,
      end_seq: idx * 10 + 10,
      summary: `chunk-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
    }))
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: chunks })
    const metaModule = await import('./meta-summarizer')

    await metaModule.processMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'META',
    })

    const allSummaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    const metaRows = allSummaries.filter((row) => row.level === SUMMARY_LEVEL_META)
    expect(metaRows).toHaveLength(1)
    expect(metaRows[0]).toMatchObject({
      chat_id: 'chat-1',
      start_seq: 1,
      end_seq: chunks[chunks.length - 1].end_seq,
    })
  })

  it('returns early when insufficient or duplicate meta rows exist', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [
        {
          start_seq: 1,
          end_seq: 5,
          summary: 'short',
          chat_id: 'chat-1',
          level: SUMMARY_LEVEL_CHUNK,
        },
        {
          start_seq: 1,
          end_seq: 10,
          summary: 'existing meta',
          chat_id: 'chat-1',
          level: SUMMARY_LEVEL_META,
        },
      ],
    })
    const { processMetaSummaries } = await import('./meta-summarizer')

    await processMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'META',
    })

    const summaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    expect(summaries.filter((row) => row.level === SUMMARY_LEVEL_META)).toHaveLength(1)
  })

  it('throws when chunk summaries fetch fails', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)

    // Create a mock that returns an error for chat_summaries
    const supabase = {
      from: (table: string) => {
        if (table === 'chat_summaries') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: () =>
                        Promise.resolve({
                          data: null,
                          error: { message: 'Database connection failed' },
                        }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      },
    }

    const { processMetaSummaries } = await import('./meta-summarizer')

    await expect(
      processMetaSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        metaPrompt: 'META',
      }),
    ).rejects.toThrow('Failed to load chunk summaries: Database connection failed')
  })

  it('returns early when chunks are not sequential', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLastSummaryEndMock.mockResolvedValue(0)

    // SUMMARY_GROUP_SIZE = 10, so need 10 chunks with a gap
    // Create non-sequential chunks (gap between 90 and 101)
    const chunks = Array.from({ length: SUMMARY_GROUP_SIZE }, (_, idx) => {
      // Introduce a gap at index 5 (after 50, jump to 61 instead of 51)
      const offset = idx >= 5 ? 10 : 0
      return {
        start_seq: idx * 10 + 1 + offset,
        end_seq: idx * 10 + 10 + offset,
        summary: `c${idx}`,
        chat_id: 'chat-1',
        level: SUMMARY_LEVEL_CHUNK,
      }
    })
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: chunks })
    const { processMetaSummaries } = await import('./meta-summarizer')

    await processMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'META',
    })

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Chunk summaries are not sequential; skipping meta summary generation',
    )
  })

  it('returns early when duplicate meta already exists', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    const chunks = Array.from({ length: SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 10 + 1,
      end_seq: idx * 10 + 10,
      summary: `chunk-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
    }))
    // Add existing meta that covers the same range
    const existingMeta = {
      start_seq: 1,
      end_seq: chunks[chunks.length - 1].end_seq,
      summary: 'existing meta',
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_META,
    }
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [...chunks, existingMeta],
    })
    const { processMetaSummaries } = await import('./meta-summarizer')

    await processMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'META',
    })

    // Should not create another meta
    const summaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    expect(summaries.filter((row) => row.level === SUMMARY_LEVEL_META)).toHaveLength(1)
    expect(generateSummaryWithFallbackMock).not.toHaveBeenCalled()
  })

  it('handles 23505 duplicate key error gracefully', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    generateSummaryWithFallbackMock.mockRejectedValue({ code: '23505' })
    const chunks = Array.from({ length: SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 10 + 1,
      end_seq: idx * 10 + 10,
      summary: `chunk-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
    }))
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: chunks })
    const { processMetaSummaries } = await import('./meta-summarizer')

    // Should not throw
    await expect(
      processMetaSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        metaPrompt: 'META',
      }),
    ).resolves.not.toThrow()
  })

  it('throws on non-23505 meta creation errors', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    generateSummaryWithFallbackMock.mockRejectedValue(new Error('LLM API error'))
    const chunks = Array.from({ length: SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 10 + 1,
      end_seq: idx * 10 + 10,
      summary: `chunk-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
    }))
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: chunks })
    const { processMetaSummaries } = await import('./meta-summarizer')

    await expect(
      processMetaSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        metaPrompt: 'META',
      }),
    ).rejects.toThrow('LLM API error')
  })
})

// ============================================================================
// processSuperMetaSummaries Tests
// ============================================================================

describe('processSuperMetaSummaries', () => {
  beforeEach(() => {
    vi.resetModules()
    generateSummaryWithFallbackMock.mockReset()
    getLastSummaryEndMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates super meta summary when enough sequential meta summaries exist', async () => {
    generateSummaryWithFallbackMock.mockResolvedValue({
      summaryText: 'super meta summary',
      summaryStatus: 'ok',
      tokenCount: 5,
      finishReason: 'stop',
    })
    getLastSummaryEndMock.mockResolvedValue(0)

    const metaSummaries = Array.from({ length: SUPER_SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 50 + 1,
      end_seq: idx * 50 + 50,
      summary: `meta-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_META,
    }))
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: metaSummaries })
    const { processSuperMetaSummaries } = await import('./meta-summarizer')

    await processSuperMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'SUPER META',
    })

    const summaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    const superMetaRows = summaries.filter((row) => row.level === SUMMARY_LEVEL_SUPER_META)
    expect(superMetaRows).toHaveLength(1)
    expect(superMetaRows[0]).toMatchObject({
      chat_id: 'chat-1',
      start_seq: 1,
      end_seq: metaSummaries[metaSummaries.length - 1].end_seq,
      summary: 'super meta summary',
    })
  })

  it('returns early when meta summaries fetch fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getLastSummaryEndMock.mockResolvedValue(0)

    const supabase = {
      from: (table: string) => {
        if (table === 'chat_summaries') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: () =>
                        Promise.resolve({
                          data: null,
                          error: { message: 'Database error' },
                        }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      },
    }

    const { processSuperMetaSummaries } = await import('./meta-summarizer')

    await processSuperMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'SUPER',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to load meta summaries for super meta generation:',
      'Database error',
    )
  })

  it('returns early when insufficient meta summaries', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    // Less than SUPER_SUMMARY_GROUP_SIZE
    const metaSummaries = [
      {
        start_seq: 1,
        end_seq: 50,
        summary: 'meta-1',
        chat_id: 'chat-1',
        level: SUMMARY_LEVEL_META,
      },
    ]
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: metaSummaries })
    const { processSuperMetaSummaries } = await import('./meta-summarizer')

    await processSuperMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'SUPER',
    })

    // Should not call generateSummaryWithFallback
    expect(generateSummaryWithFallbackMock).not.toHaveBeenCalled()
  })

  it('returns early when meta summaries are not sequential', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLastSummaryEndMock.mockResolvedValue(0)

    // SUPER_SUMMARY_GROUP_SIZE = 4, need 4 meta summaries with a gap
    const metaSummaries = Array.from({ length: SUPER_SUMMARY_GROUP_SIZE }, (_, idx) => {
      // Introduce a gap at index 2 (after 100, jump to 111 instead of 101)
      const offset = idx >= 2 ? 10 : 0
      return {
        start_seq: idx * 50 + 1 + offset,
        end_seq: idx * 50 + 50 + offset,
        summary: `m${idx}`,
        chat_id: 'chat-1',
        level: SUMMARY_LEVEL_META,
      }
    })
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: metaSummaries })
    const { processSuperMetaSummaries } = await import('./meta-summarizer')

    await processSuperMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'SUPER',
    })

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Meta summaries are not sequential; skipping super meta generation',
    )
  })

  it('returns early when duplicate super meta exists', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    const metaSummaries = Array.from({ length: SUPER_SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 50 + 1,
      end_seq: idx * 50 + 50,
      summary: `meta-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_META,
    }))
    // Add existing super meta
    const existingSuperMeta = {
      start_seq: 1,
      end_seq: metaSummaries[metaSummaries.length - 1].end_seq,
      summary: 'existing super',
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_SUPER_META,
    }
    const supabase = createChatSummariesSupabaseMock({
      chatSummaries: [...metaSummaries, existingSuperMeta],
    })
    const { processSuperMetaSummaries } = await import('./meta-summarizer')

    await processSuperMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'SUPER',
    })

    // Should not create another super meta
    const summaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    expect(summaries.filter((row) => row.level === SUMMARY_LEVEL_SUPER_META)).toHaveLength(1)
    expect(generateSummaryWithFallbackMock).not.toHaveBeenCalled()
  })

  it('handles 23505 duplicate key error gracefully', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    generateSummaryWithFallbackMock.mockRejectedValue({ code: '23505' })
    const metaSummaries = Array.from({ length: SUPER_SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 50 + 1,
      end_seq: idx * 50 + 50,
      summary: `meta-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_META,
    }))
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: metaSummaries })
    const { processSuperMetaSummaries } = await import('./meta-summarizer')

    // Should not throw
    await expect(
      processSuperMetaSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o',
        metaPrompt: 'SUPER',
      }),
    ).resolves.not.toThrow()
  })

  it('logs error and returns on non-23505 error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getLastSummaryEndMock.mockResolvedValue(0)
    generateSummaryWithFallbackMock.mockRejectedValue(new Error('API timeout'))
    const metaSummaries = Array.from({ length: SUPER_SUMMARY_GROUP_SIZE }, (_, idx) => ({
      start_seq: idx * 50 + 1,
      end_seq: idx * 50 + 50,
      summary: `meta-${idx}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_META,
    }))
    const supabase = createChatSummariesSupabaseMock({ chatSummaries: metaSummaries })
    const { processSuperMetaSummaries } = await import('./meta-summarizer')

    await processSuperMetaSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      metaPrompt: 'SUPER',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to create super meta summary:',
      expect.any(Error),
    )
  })
})
