import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatModelConfig } from '@/lib/chat/model-config'
import { SUMMARY_LEVEL_META } from '@/lib/chat-summaries/config'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const hoistedMocks = vi.hoisted(() => ({
  buildContextMock: vi.fn(),
  filterRedundantChunksMock: vi.fn(),
  formatFactsMock: vi.fn(),
  formatSummarySegmentsMock: vi.fn(),
  getLastSummaryEndMock: vi.fn(),
  getMessageCountMock: vi.fn(),
  loadProjectedConversationMessagesMock: vi.fn(),
  updateCanonicalSealedMemoryArtifactsMock: vi.fn(),
  updateSummariesMock: vi.fn(),
}))

vi.mock('@/lib/chat-summaries', () => ({
  buildContext: (...args: unknown[]) => hoistedMocks.buildContextMock(...args),
}))

vi.mock('@/lib/chat-summaries/context-builder', () => ({
  filterRedundantChunks: (...args: unknown[]) => hoistedMocks.filterRedundantChunksMock(...args),
}))

vi.mock('@/lib/chat-summaries/db-helpers', () => ({
  getLastSummaryEnd: (...args: unknown[]) => hoistedMocks.getLastSummaryEndMock(...args),
  getMessageCount: (...args: unknown[]) => hoistedMocks.getMessageCountMock(...args),
}))

vi.mock('@/lib/chat-summaries/formatters', () => ({
  areChunksSequential: (chunks: Array<{ start_seq: number; end_seq: number }>) =>
    chunks.every(
      (chunk, index) => index === 0 || chunk.start_seq === chunks[index - 1].end_seq + 1,
    ),
  calculateChunkBoundaries: (totalMessages: number, previousEnd: number, chunkSize = 10) => {
    const latestChunkEnd = totalMessages - chunkSize
    if (latestChunkEnd < chunkSize || latestChunkEnd <= previousEnd) {
      return []
    }

    const boundaries: Array<{ start: number; end: number }> = []
    let nextChunkEnd = Math.max(previousEnd + chunkSize, chunkSize)
    while (nextChunkEnd <= latestChunkEnd) {
      boundaries.push({
        start: nextChunkEnd - chunkSize + 1,
        end: nextChunkEnd,
      })
      nextChunkEnd += chunkSize
    }
    return boundaries
  },
  formatFacts: (...args: unknown[]) => hoistedMocks.formatFactsMock(...args),
  formatSummarySegments: (...args: unknown[]) => hoistedMocks.formatSummarySegmentsMock(...args),
}))

vi.mock('@/lib/chat-summaries/index', () => ({
  updateSummaries: (...args: unknown[]) => hoistedMocks.updateSummariesMock(...args),
}))

vi.mock('@/lib/chat-summaries/sealed-memory-writer', () => ({
  updateCanonicalSealedMemoryArtifacts: (...args: unknown[]) =>
    hoistedMocks.updateCanonicalSealedMemoryArtifactsMock(...args),
}))

vi.mock('@/lib/chat/turns', () => ({
  loadProjectedConversationMessages: (...args: unknown[]) =>
    hoistedMocks.loadProjectedConversationMessagesMock(...args),
}))

import { buildMemoryPlan, hasMemoryUpdateWork, updateMemoryState } from './index'

function createMemorySupabaseStub(options?: {
  profiles?: Array<{
    id: string
    chunk_summary_prompt?: string | null
    meta_summary_prompt?: string | null
    fact_extraction_prompt?: string | null
    enable_episodic_rag?: boolean
    voyage_embedding_api_key_id?: string | null
  }>
  chats?: Array<{ id: string; user_id: string }>
  summaries?: Array<{
    chat_id: string
    level: number
    start_seq: number
    end_seq: number
    summary: string
  }>
  facts?: Array<{ chat_id: string; start_seq: number; end_seq: number; facts: string }>
}): ChatSummariesSupabaseClient {
  return createSupabaseMock({
    tables: {
      profiles: {
        rows: options?.profiles ?? [],
      },
      chats: {
        rows: options?.chats ?? [],
      },
      chat_summaries: {
        rows: options?.summaries ?? [],
      },
      chat_facts: {
        rows: options?.facts ?? [],
      },
    },
  }) as unknown as ChatSummariesSupabaseClient
}

describe('chat memory orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hoistedMocks.buildContextMock.mockResolvedValue({
      systemPrompt: 'BASE\n\nDYNAMIC',
      dynamicContext: 'DYNAMIC',
      recentMessages: [{ role: 'user', content: 'hello', messageId: 'msg-1' }],
      ragInfo: {
        enabled: true,
        threshold: 0.75,
        topK: 3,
        results: [{ seq: '1', similarity: 0.91, preview: 'hello' }],
      },
    })
    hoistedMocks.filterRedundantChunksMock.mockImplementation((rows) => rows)
    hoistedMocks.formatFactsMock.mockImplementation((facts) =>
      facts
        .map((fact: { start_seq: number; end_seq: number; facts: string }) => {
          return `[${fact.start_seq}-${fact.end_seq}]\n${fact.facts}`
        })
        .join('\n\n'),
    )
    hoistedMocks.formatSummarySegmentsMock.mockImplementation((summaries) =>
      summaries.map((summary: { start_seq: number; end_seq: number; summary: string }) => {
        return `[Summary ${summary.start_seq}-${summary.end_seq}]\n${summary.summary}`
      }),
    )
    hoistedMocks.getLastSummaryEndMock.mockResolvedValue(0)
    hoistedMocks.getMessageCountMock.mockResolvedValue(0)
    hoistedMocks.loadProjectedConversationMessagesMock.mockResolvedValue([])
    hoistedMocks.updateCanonicalSealedMemoryArtifactsMock.mockResolvedValue(undefined)
    hoistedMocks.updateSummariesMock.mockResolvedValue(undefined)
  })

  it('builds summary_window prompts from buildContext output', async () => {
    const supabase = createMemorySupabaseStub()
    const modelConfig: ChatModelConfig = {
      memory: {
        mode: 'summary_window',
      },
    }

    const result = await buildMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [{ role: 'user', content: 'hello', messageId: 'msg-1' }],
      baseSystemPrompt: ' BASE ',
      extraDynamicContext: ['Lore'],
      modelConfig,
    })

    expect(hoistedMocks.buildContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        extraDynamicContext: ['Lore'],
      }),
    )
    expect(result).toMatchObject({
      mode: 'summary_window',
      fallbackSystemPrompt: 'BASE\n\nDYNAMIC',
      fallbackMessages: [{ role: 'user', content: 'hello', messageId: 'msg-1' }],
      staticSystemPrompt: 'BASE',
      dynamicContext: 'DYNAMIC',
      ragInfo: {
        enabled: true,
        threshold: 0.75,
        topK: 3,
      },
    })
    expect(result.promptBlocks).toEqual([
      {
        role: 'system',
        content: 'BASE',
        cachePreference: 'prefer-cache',
        stability: 'static',
      },
      {
        role: 'system',
        content: 'DYNAMIC',
        cachePreference: 'avoid-cache',
        stability: 'sealed',
      },
      {
        role: 'user',
        content: 'hello',
        cachePreference: 'avoid-cache',
        stability: 'live',
      },
    ])
  })

  it('builds prefix_live_blocks prompts with sealed summaries, facts, and extra context', async () => {
    hoistedMocks.getLastSummaryEndMock.mockImplementation(async (_supabase, _chatId, level) =>
      level === SUMMARY_LEVEL_META ? 100 : 0,
    )
    hoistedMocks.loadProjectedConversationMessagesMock.mockResolvedValue([
      ...Array.from({ length: 100 }, (_, index) => ({
        id: `msg-${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `sealed-${index + 1}`,
      })),
      { id: 'msg-101', role: 'user', content: 'recent user' },
      { id: 'msg-102', role: 'assistant', content: 'recent assistant' },
    ])

    const supabase = createMemorySupabaseStub({
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
        },
      ],
      profiles: [
        {
          id: 'user-1',
          enable_episodic_rag: true,
          voyage_embedding_api_key_id: 'voyage-key-1',
        },
      ],
      summaries: [
        {
          chat_id: 'chat-1',
          level: SUMMARY_LEVEL_META,
          start_seq: 1,
          end_seq: 100,
          summary: 'Condensed recap',
        },
      ],
      facts: [
        {
          chat_id: 'chat-1',
          start_seq: 91,
          end_seq: 100,
          facts: 'Remember the promise',
        },
      ],
    })
    const modelConfig: ChatModelConfig = {
      memory: {
        mode: 'prefix_live_blocks',
      },
    }

    const result = await buildMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [],
      baseSystemPrompt: 'STATIC',
      extraDynamicContext: ['Lore block', ''],
      modelConfig,
    })

    expect(hoistedMocks.filterRedundantChunksMock).toHaveBeenCalled()
    expect(result.fallbackMessages).toEqual([
      { role: 'user', content: 'recent user', messageId: 'msg-101' },
      { role: 'assistant', content: 'recent assistant', messageId: 'msg-102' },
    ])
    expect(result.fallbackSystemPrompt).toBe(
      'STATIC\n\n=== Previous Conversation Summary ===\n[Summary 1-100]\nCondensed recap\n\n=== Key Facts to Remember ===\n[91-100]\nRemember the promise\n\nLore block',
    )
    expect(result.dynamicContext).toBe(
      '=== Previous Conversation Summary ===\n[Summary 1-100]\nCondensed recap\n\n=== Key Facts to Remember ===\n[91-100]\nRemember the promise\n\nLore block',
    )
    expect(result.promptBlocks).toEqual([
      {
        role: 'system',
        content: 'STATIC',
        cachePreference: 'prefer-cache',
        stability: 'static',
      },
      {
        role: 'system',
        content: '=== Previous Conversation Summary ===\n[Summary 1-100]\nCondensed recap',
        cachePreference: 'prefer-cache',
        stability: 'sealed',
      },
      {
        role: 'system',
        content: '=== Key Facts to Remember ===\n[91-100]\nRemember the promise',
        cachePreference: 'prefer-cache',
        stability: 'sealed',
      },
      {
        role: 'system',
        content: 'Lore block',
        cachePreference: 'avoid-cache',
        stability: 'sealed',
      },
      {
        role: 'user',
        content: 'recent user',
        cachePreference: 'prefer-cache',
        stability: 'live',
      },
      {
        role: 'assistant',
        content: 'recent assistant',
        cachePreference: 'prefer-cache',
        stability: 'live',
      },
    ])
  })

  it('logs and falls back to static prompts when projected live messages cannot be loaded', async () => {
    hoistedMocks.loadProjectedConversationMessagesMock.mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await buildMemoryPlan({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      sanitizedMessages: [],
      baseSystemPrompt: 'STATIC',
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
        },
      },
    })

    expect(result.fallbackMessages).toEqual([])
    expect(result.promptBlocks).toEqual([
      {
        role: 'system',
        content: 'STATIC',
        cachePreference: 'prefer-cache',
        stability: 'static',
      },
    ])
    expect(errorSpy).toHaveBeenCalledWith('[chat-memory] Failed to load live messages:', 'boom')
  })

  it('delegates summary_window updates to updateSummaries', async () => {
    await updateMemoryState({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      userId: 'user-1',
      model: {} as never,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      modelConfig: {
        memory: {
          mode: 'summary_window',
        },
      },
    })

    expect(hoistedMocks.updateSummariesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        userId: 'user-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
      }),
    )
  })

  it('detects when summary_window has no sealed summary work pending', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(19)
    hoistedMocks.getLastSummaryEndMock.mockResolvedValue(0)

    const result = await hasMemoryUpdateWork({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      modelConfig: {
        memory: {
          mode: 'summary_window',
        },
      },
    })

    expect(result).toBe(false)
  })

  it('detects when summary_window reaches the next chunk boundary', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(20)
    hoistedMocks.getLastSummaryEndMock.mockResolvedValue(0)

    const result = await hasMemoryUpdateWork({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      modelConfig: {
        memory: {
          mode: 'summary_window',
        },
      },
    })

    expect(result).toBe(true)
  })

  it('throws when summary_window work inspection cannot determine projected conversation size', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(null)

    await expect(
      hasMemoryUpdateWork({
        supabase: createMemorySupabaseStub(),
        chatId: 'chat-1',
        modelConfig: {
          memory: {
            mode: 'summary_window',
          },
        },
      }),
    ).rejects.toThrow('Failed to determine projected conversation size for summary work check')
  })

  it('treats explicit regeneration ranges as summary work', async () => {
    const result = await hasMemoryUpdateWork({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      regenerate: {
        factRanges: [{ startSeq: 1, endSeq: 10 }],
      },
      modelConfig: {
        memory: {
          mode: 'summary_window',
        },
      },
    })

    expect(result).toBe(true)
    expect(hoistedMocks.getMessageCountMock).not.toHaveBeenCalled()
  })

  it('detects missing fact rows as pending work for episodic-enabled summary_window chats', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(20)
    hoistedMocks.getLastSummaryEndMock.mockResolvedValue(10)

    const result = await hasMemoryUpdateWork({
      supabase: createMemorySupabaseStub({
        chats: [{ id: 'chat-1', user_id: 'user-1' }],
        profiles: [
          {
            id: 'user-1',
            enable_episodic_rag: true,
            voyage_embedding_api_key_id: 'voyage-key-1',
          },
        ],
        summaries: [
          {
            chat_id: 'chat-1',
            level: 0,
            start_seq: 1,
            end_seq: 10,
            summary: 'sealed chunk',
          },
        ],
      }),
      chatId: 'chat-1',
      modelConfig: {
        memory: {
          mode: 'summary_window',
        },
      },
    })

    expect(result).toBe(true)
  })

  it('throws when the projected conversation size cannot be determined during prefix updates', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(null)

    await expect(
      updateMemoryState({
        supabase: createMemorySupabaseStub(),
        chatId: 'chat-1',
        userId: 'user-1',
        model: {} as never,
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        modelConfig: {
          memory: {
            mode: 'prefix_live_blocks',
            retainTailMessages: 2,
          },
        },
      }),
    ).rejects.toThrow('Failed to determine projected conversation size for prefix memory update')

    expect(hoistedMocks.updateCanonicalSealedMemoryArtifactsMock).not.toHaveBeenCalled()
  })

  it('delegates prefix_live_blocks updates to the canonical sealed-memory writer', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(104)

    await updateMemoryState({
      supabase: createMemorySupabaseStub({
        profiles: [
          {
            id: 'user-1',
            chunk_summary_prompt: 'CUSTOM CHUNK',
            meta_summary_prompt: 'CUSTOM META',
            fact_extraction_prompt: 'CUSTOM FACTS',
          },
        ],
      }),
      chatId: 'chat-1',
      userId: 'user-1',
      model: {} as never,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      regenerate: {
        chunkRanges: [{ startSeq: 1, endSeq: 4 }],
      },
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
          retainTailMessages: 2,
        },
      },
    })

    expect(hoistedMocks.updateCanonicalSealedMemoryArtifactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sealedThroughSeq: 102,
        regenerate: {
          chunkRanges: [{ startSeq: 1, endSeq: 4 }],
        },
      }),
    )
  })

  it('propagates prefix update failures when the canonical sealed-memory writer fails', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(104)
    hoistedMocks.updateCanonicalSealedMemoryArtifactsMock.mockRejectedValue(new Error('boom'))

    await expect(
      updateMemoryState({
        supabase: createMemorySupabaseStub(),
        chatId: 'chat-1',
        userId: 'user-1',
        model: {} as never,
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        modelConfig: {
          memory: {
            mode: 'prefix_live_blocks',
            retainTailMessages: 2,
          },
        },
      }),
    ).rejects.toThrow('boom')
  })

  it('throws when prefix work inspection cannot determine projected conversation size', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(null)

    await expect(
      hasMemoryUpdateWork({
        supabase: createMemorySupabaseStub(),
        chatId: 'chat-1',
        modelConfig: {
          memory: {
            mode: 'prefix_live_blocks',
            retainTailMessages: 2,
          },
        },
      }),
    ).rejects.toThrow(
      'Failed to determine projected conversation size for prefix memory work check',
    )
  })

  it('detects missing fact rows as pending work for episodic-enabled prefix chats', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(14)
    hoistedMocks.getLastSummaryEndMock.mockImplementation(async (_supabase, _chatId, level) =>
      level === SUMMARY_LEVEL_META ? 0 : 10,
    )

    const result = await hasMemoryUpdateWork({
      supabase: createMemorySupabaseStub({
        chats: [{ id: 'chat-1', user_id: 'user-1' }],
        profiles: [
          {
            id: 'user-1',
            enable_episodic_rag: true,
            voyage_embedding_api_key_id: 'voyage-key-1',
          },
        ],
        summaries: [
          {
            chat_id: 'chat-1',
            level: 0,
            start_seq: 1,
            end_seq: 10,
            summary: 'sealed chunk',
          },
        ],
      }),
      chatId: 'chat-1',
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
          retainTailMessages: 4,
        },
      },
    })

    expect(result).toBe(true)
  })

  it('throws when prefix meta work inspection fails', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(104)
    hoistedMocks.getLastSummaryEndMock.mockResolvedValue(100)

    const supabase = {
      from(table: string) {
        if (table === 'chats') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { user_id: 'user-1' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    enable_episodic_rag: false,
                    voyage_embedding_api_key_id: null,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table !== 'chat_summaries') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gt: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: null,
                      error: { message: 'chunk inspection failed' },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      },
    }

    await expect(
      hasMemoryUpdateWork({
        supabase: supabase as never,
        chatId: 'chat-1',
        modelConfig: {
          memory: {
            mode: 'prefix_live_blocks',
            retainTailMessages: 2,
          },
        },
      }),
    ).rejects.toThrow('Failed to inspect pending meta summary work: chunk inspection failed')
  })
})
