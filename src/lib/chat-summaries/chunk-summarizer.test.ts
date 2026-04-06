import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'

import { CHUNK_SIZE, SUMMARY_LEVEL_CHUNK } from './config'
import { createChatSummariesSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'

// Helper to cast mock model
const mockModel = {} as LanguageModel

const generateTextMock = vi.fn()
const getProviderOptionsMock = vi.fn(() => ({}))
const resolvePromptCacheDecisionMock = vi.fn(() => null)
const generateFactEmbeddingMock = vi.fn()

vi.mock('ai', () => {
  class APICallError extends Error {
    statusCode?: number
    responseBody?: string
    constructor(init?: { message?: string; statusCode?: number; responseBody?: string }) {
      super(init?.message || 'error')
      this.statusCode = init?.statusCode
      this.responseBody = init?.responseBody
    }
    static isInstance(err: unknown): err is APICallError {
      return err instanceof APICallError
    }
  }

  return {
    APICallError,
    generateText: (...args: unknown[]) => generateTextMock(...args),
  }
})

vi.mock('@/lib/llm/provider-options', () => ({
  getProviderOptions: (...args: Parameters<typeof getProviderOptionsMock>) =>
    getProviderOptionsMock(...args),
}))

vi.mock('@/lib/llm/prompt-cache', () => ({
  resolvePromptCacheDecision: (...args: Parameters<typeof resolvePromptCacheDecisionMock>) =>
    resolvePromptCacheDecisionMock(...args),
}))

vi.mock('@/lib/embeddings', () => ({
  generateFactEmbedding: (...args: unknown[]) => generateFactEmbeddingMock(...args),
}))

describe('chunk-summarizer', () => {
  beforeEach(() => {
    vi.resetModules()
    generateTextMock.mockReset()
    getProviderOptionsMock.mockClear()
    resolvePromptCacheDecisionMock.mockClear()
    generateFactEmbeddingMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates summary and returns token count', async () => {
    generateTextMock.mockResolvedValue({
      text: '  summary text ',
      usage: { outputTokens: 12 },
      finishReason: 'stop',
    })
    const { generateSummaryWithFallback } = await import('./chunk-summarizer')

    const result = await generateSummaryWithFallback({
      model: mockModel,
      provider: 'google',
      systemPrompt: 'SYS',
      prompt: 'PROMPT',
      maxTokens: 123,
      fallbackLabel: 'chunk',
      fallbackTextFactory: () => 'fallback',
      promptCache: { key: 'k', retention: '24h' },
    })

    expect(result).toEqual({
      summaryText: 'summary text',
      tokenCount: 12,
      finishReason: 'stop',
    })
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 123, temperature: 1 }),
    )
  })

  it('falls back to local summary when LLM fails', async () => {
    generateTextMock.mockRejectedValue(new Error('LLM down'))
    const { generateSummaryWithFallback } = await import('./chunk-summarizer')

    const result = await generateSummaryWithFallback({
      model: mockModel,
      provider: 'google',
      systemPrompt: 'SYS',
      prompt: 'PROMPT',
      maxTokens: 1,
      fallbackLabel: 'chunk',
      fallbackTextFactory: () => 'local-fallback',
      promptCache: null,
    })

    expect(result.summaryText).toBe('local-fallback')
    expect(result.finishReason).toBe('error')
  })

  it('falls back when generation ends with finishReason=length and empty text', async () => {
    generateTextMock.mockResolvedValue({
      text: '   ',
      usage: { outputTokens: 0 },
      finishReason: 'length',
    })
    const { generateSummaryWithFallback } = await import('./chunk-summarizer')

    const result = await generateSummaryWithFallback({
      model: mockModel,
      provider: 'google',
      systemPrompt: 'SYS',
      prompt: 'PROMPT',
      maxTokens: 8,
      fallbackLabel: 'chunk',
      fallbackTextFactory: () => 'length-fallback',
      promptCache: null,
    })

    expect(result).toEqual({
      summaryText: 'length-fallback',
      tokenCount: null,
      finishReason: 'error',
    })
  })

  it('falls back with APICallError parsing provider/safety details', async () => {
    const { APICallError } = await import('ai')
    generateTextMock.mockRejectedValue(
      new APICallError({
        message: 'provider failed',
        statusCode: 400,
        url: 'https://example.com/api',
        requestBodyValues: {},
        responseBody: JSON.stringify({
          error: { message: 'blocked by policy' },
          promptFeedback: {
            safetyRatings: [{ category: 'HARM_CATEGORY_HATE_SPEECH' }],
          },
        }),
      }),
    )
    const { generateSummaryWithFallback } = await import('./chunk-summarizer')

    const result = await generateSummaryWithFallback({
      model: mockModel,
      provider: 'google',
      systemPrompt: 'SYS',
      prompt: 'PROMPT',
      maxTokens: 8,
      fallbackLabel: 'chunk',
      fallbackTextFactory: () => 'api-fallback',
      promptCache: null,
    })

    expect(result.summaryText).toBe('api-fallback')
    expect(result.finishReason).toBe('error')
  })

  it('falls back with APICallError when response body is unparseable', async () => {
    const { APICallError } = await import('ai')
    generateTextMock.mockRejectedValue(
      new APICallError({
        message: 'provider failed',
        statusCode: 500,
        url: 'https://example.com/api',
        requestBodyValues: {},
        responseBody: '{invalid-json',
      }),
    )
    const { generateSummaryWithFallback } = await import('./chunk-summarizer')

    const result = await generateSummaryWithFallback({
      model: mockModel,
      provider: 'google',
      systemPrompt: 'SYS',
      prompt: 'PROMPT',
      maxTokens: 8,
      fallbackLabel: 'chunk',
      fallbackTextFactory: () => 'unparseable-fallback',
      promptCache: null,
    })

    expect(result.summaryText).toBe('unparseable-fallback')
    expect(result.finishReason).toBe('error')
  })

  it('creates chunk summary and inserts into chat_summaries', async () => {
    generateTextMock.mockResolvedValue({
      text: 'chunk summary',
      usage: { outputTokens: 5 },
      finishReason: 'stop',
    })
    const supabase = createChatSummariesSupabaseMock({
      messages: Array.from({ length: CHUNK_SIZE }, (_, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'assistant',
        content: `message-${idx}`,
        sequence: idx + 1,
        chat_id: 'chat-1',
      })),
    })
    const { createChunkSummary } = await import('./chunk-summarizer')

    await createChunkSummary({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o',
      startSeq: 1,
      endSeq: CHUNK_SIZE,
      systemPrompt: 'SYS',
    })

    const chatSummaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    expect(chatSummaries).toHaveLength(1)
    expect(chatSummaries[0]).toMatchObject({
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
      start_seq: 1,
      end_seq: CHUNK_SIZE,
      summary: 'chunk summary',
    })
  })

  it('throws when chunk size is incomplete', async () => {
    const supabase = createChatSummariesSupabaseMock({
      messages: [{ role: 'user', content: 'only one', sequence: 1, chat_id: 'chat-1' }],
    })
    const { createChunkSummary } = await import('./chunk-summarizer')

    await expect(
      createChunkSummary({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'google',
        modelName: 'gemini',
        startSeq: 1,
        endSeq: CHUNK_SIZE,
        systemPrompt: 'SYS',
      }),
    ).rejects.toThrow('Expected 10 messages for chunk but received 1')
  })

  it('throws when chunk message query fails', async () => {
    const failingSupabase = {
      from: (table: string) => {
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({
                    data: null,
                    error: { message: 'db unavailable' },
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'chat_summaries') {
          return {
            insert: async () => ({ error: null }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const { createChunkSummary } = await import('./chunk-summarizer')

    await expect(
      createChunkSummary({
        supabase: failingSupabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'google',
        modelName: 'gemini',
        startSeq: 1,
        endSeq: CHUNK_SIZE,
        systemPrompt: 'SYS',
      }),
    ).rejects.toThrow('Failed to load chunk messages: db unavailable')
  })

  it('creates fallback chunk summary when LLM call fails', async () => {
    generateTextMock.mockRejectedValue(new Error('upstream down'))
    const supabase = createChatSummariesSupabaseMock({
      messages: Array.from({ length: CHUNK_SIZE }, (_, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'assistant',
        content: `message-${idx}`,
        sequence: idx + 1,
        chat_id: 'chat-1',
      })),
    })
    const { createChunkSummary } = await import('./chunk-summarizer')

    await createChunkSummary({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'google',
      modelName: 'gemini',
      startSeq: 1,
      endSeq: CHUNK_SIZE,
      systemPrompt: 'SYS',
    })

    const chatSummaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    expect(chatSummaries).toHaveLength(1)
    expect(String(chatSummaries[0].summary)).toContain('Summary failed')
  })

  it('creates facts when bullet points exist and skips on explicit no-facts', async () => {
    generateFactEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3])
    // First call: actual facts; Second call: no significant facts -> skip
    generateTextMock
      .mockResolvedValueOnce({
        text: '- Fact one\n- Fact two',
        finishReason: 'stop',
      })
      .mockResolvedValueOnce({
        text: 'No significant facts to record',
        finishReason: 'stop',
      })

    const supabase = createChatSummariesSupabaseMock({
      messages: [
        { role: 'user', content: 'hi', sequence: 1, chat_id: 'chat-1' },
        { role: 'assistant', content: 'response', sequence: 2, chat_id: 'chat-1' },
      ],
    })
    const { createChunkFacts } = await import('./chunk-summarizer')

    await createChunkFacts({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'google',
      modelName: 'gemini',
      startSeq: 1,
      endSeq: 2,
      factPrompt: 'FACT',
    })

    const chatFacts = supabase.state.chatFacts as Array<Record<string, unknown>>
    expect(chatFacts).toHaveLength(1)
    expect(chatFacts[0]).toMatchObject({
      chat_id: 'chat-1',
      user_id: 'user-1',
      facts: '- Fact one\n- Fact two',
    })

    await createChunkFacts({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'google',
      modelName: 'gemini',
      startSeq: 3,
      endSeq: 4,
      factPrompt: 'FACT',
    })

    expect(chatFacts).toHaveLength(1) // unchanged
  })

  it('returns early when createChunkFacts cannot load messages', async () => {
    const failingSupabase = {
      from: (table: string) => {
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({
                    data: null,
                    error: { message: 'messages table error', code: 'XX001' },
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'chat_facts') {
          return {
            insert: async () => ({ error: null }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const { createChunkFacts } = await import('./chunk-summarizer')

    await expect(
      createChunkFacts({
        supabase: failingSupabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'google',
        modelName: 'gemini',
        startSeq: 1,
        endSeq: 2,
        factPrompt: 'FACT',
      }),
    ).resolves.toBeUndefined()
  })

  it('skips createChunkFacts when response has no bullet points', async () => {
    generateFactEmbeddingMock.mockResolvedValue([0.2, 0.4, 0.6])
    generateTextMock.mockResolvedValue({
      text: 'This is plain prose without bullet markers.',
      finishReason: 'stop',
    })
    const supabase = createChatSummariesSupabaseMock({
      messages: [
        { role: 'user', content: 'hi', sequence: 1, chat_id: 'chat-1' },
        { role: 'assistant', content: 'response', sequence: 2, chat_id: 'chat-1' },
      ],
    })
    const { createChunkFacts } = await import('./chunk-summarizer')

    await createChunkFacts({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'google',
      modelName: 'gemini',
      startSeq: 1,
      endSeq: 2,
      factPrompt: 'FACT',
    })

    const chatFacts = supabase.state.chatFacts as Array<Record<string, unknown>>
    expect(chatFacts).toHaveLength(0)
  })

  it('swallows createChunkFacts insert failures without throwing', async () => {
    generateFactEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3])
    generateTextMock.mockResolvedValue({
      text: '- fact one\n- fact two',
      finishReason: 'stop',
    })

    const messagesTable = {
      select: () => ({
        eq: () => ({
          order: () => ({
            range: async () => ({
              data: [
                { role: 'user', content: 'hi', sequence: 1, chat_id: 'chat-1' },
                { role: 'assistant', content: 'response', sequence: 2, chat_id: 'chat-1' },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    const chatFactsTable = {
      insert: async () => ({
        error: { message: 'insert failed' },
      }),
    }
    const supabase = {
      from: (table: string) => {
        if (table === 'messages') return messagesTable
        if (table === 'chat_facts') return chatFactsTable
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const { createChunkFacts } = await import('./chunk-summarizer')

    await expect(
      createChunkFacts({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'google',
        modelName: 'gemini',
        startSeq: 1,
        endSeq: 2,
        factPrompt: 'FACT',
      }),
    ).resolves.toBeUndefined()
  })

  it('processes chunk summaries skipping already processed boundaries', async () => {
    generateTextMock.mockResolvedValue({
      text: 'summary',
      usage: { outputTokens: 1 },
      finishReason: 'stop',
    })
    const supabase = createChatSummariesSupabaseMock({
      messages: Array.from({ length: 30 }, (_, idx) => ({
        role: 'user',
        content: `m-${idx}`,
        sequence: idx + 1,
        chat_id: 'chat-1',
      })),
      chatSummaries: [
        {
          start_seq: 1,
          end_seq: 10,
          chat_id: 'chat-1',
          level: SUMMARY_LEVEL_CHUNK,
          summary: 'old',
        },
      ],
    })
    const chunkModule = await import('./chunk-summarizer')

    await chunkModule.processChunkSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'google',
      modelName: 'gemini',
      totalMessages: 30,
      previousEnd: 0,
      chunkPrompt: 'SYS',
      factPrompt: 'FACT',
    })

    const allSummaries = supabase.state.chatSummaries as Array<Record<string, unknown>>
    const chunkSummaries = allSummaries.filter((row) => row.level === SUMMARY_LEVEL_CHUNK)
    expect(chunkSummaries).toHaveLength(2)
    expect(chunkSummaries.map((row) => row.start_seq)).toEqual(expect.arrayContaining([1, 11]))
  })

  it('returns early when processChunkSummaries has no boundaries to create', async () => {
    const supabase = createChatSummariesSupabaseMock({
      messages: [],
      chatSummaries: [],
    })
    const chunkModule = await import('./chunk-summarizer')

    await chunkModule.processChunkSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'google',
      modelName: 'gemini',
      totalMessages: 9,
      previousEnd: 0,
      chunkPrompt: 'SYS',
      factPrompt: 'FACT',
    })

    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('continues processChunkSummaries on duplicate-key style errors (code 23505)', async () => {
    let rangeCallCount = 0
    const supabase = {
      from: (table: string) => {
        if (table === 'chat_summaries') {
          return {
            select: () => {
              const builder = {
                eq: () => builder,
                in: async () => ({ data: [], error: null }),
              }
              return builder
            },
          }
        }
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => {
                    rangeCallCount += 1
                    throw { code: '23505' }
                  },
                }),
              }),
            }),
          }
        }
        if (table === 'chat_facts') {
          return { insert: async () => ({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const chunkModule = await import('./chunk-summarizer')

    await expect(
      chunkModule.processChunkSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'google',
        modelName: 'gemini',
        totalMessages: 30,
        previousEnd: 0,
        chunkPrompt: 'SYS',
        factPrompt: 'FACT',
      }),
    ).resolves.toBeUndefined()

    expect(rangeCallCount).toBeGreaterThan(1)
  })

  it('aborts processChunkSummaries on non-duplicate errors', async () => {
    let rangeCallCount = 0
    const supabase = {
      from: (table: string) => {
        if (table === 'chat_summaries') {
          return {
            select: () => {
              const builder = {
                eq: () => builder,
                in: async () => ({ data: [], error: null }),
              }
              return builder
            },
          }
        }
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => {
                    rangeCallCount += 1
                    throw new Error('range failed')
                  },
                }),
              }),
            }),
          }
        }
        if (table === 'chat_facts') {
          return { insert: async () => ({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const chunkModule = await import('./chunk-summarizer')

    await expect(
      chunkModule.processChunkSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'google',
        modelName: 'gemini',
        totalMessages: 30,
        previousEnd: 0,
        chunkPrompt: 'SYS',
        factPrompt: 'FACT',
      }),
    ).resolves.toBeUndefined()

    expect(rangeCallCount).toBe(1)
  })
})
