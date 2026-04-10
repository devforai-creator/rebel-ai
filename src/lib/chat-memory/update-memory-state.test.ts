import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatModelConfig } from '@/lib/chat/model-config'
import {
  DEFAULT_CHUNK_SUMMARY_PROMPT,
  DEFAULT_FACT_EXTRACTION_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  SUMMARY_LEVEL_CHUNK,
} from '@/lib/chat-summaries/config'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const hoistedMocks = vi.hoisted(() => ({
  buildContextMock: vi.fn(),
  createChunkFactsMock: vi.fn(),
  createChunkSummaryMock: vi.fn(),
  filterRedundantChunksMock: vi.fn(),
  formatFactsMock: vi.fn(),
  formatSummarySegmentsMock: vi.fn(),
  getLastSummaryEndMock: vi.fn(),
  getMessageCountMock: vi.fn(),
  loadProjectedConversationMessagesMock: vi.fn(),
  processMetaSummariesMock: vi.fn(),
  processRegenerationRequestsMock: vi.fn(),
  updateSummariesMock: vi.fn(),
}))

vi.mock('@/lib/chat-summaries', () => ({
  buildContext: (...args: unknown[]) => hoistedMocks.buildContextMock(...args),
}))

vi.mock('@/lib/chat-summaries/chunk-summarizer', () => ({
  createChunkFacts: (...args: unknown[]) => hoistedMocks.createChunkFactsMock(...args),
  createChunkSummary: (...args: unknown[]) => hoistedMocks.createChunkSummaryMock(...args),
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

vi.mock('@/lib/chat-summaries/meta-summarizer', () => ({
  processMetaSummaries: (...args: unknown[]) => hoistedMocks.processMetaSummariesMock(...args),
}))

vi.mock('@/lib/chat-summaries/regeneration', () => ({
  processRegenerationRequests: (...args: unknown[]) =>
    hoistedMocks.processRegenerationRequestsMock(...args),
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
  }>
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
    hoistedMocks.createChunkFactsMock.mockResolvedValue(undefined)
    hoistedMocks.createChunkSummaryMock.mockResolvedValue(undefined)
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
    hoistedMocks.processMetaSummariesMock.mockResolvedValue(undefined)
    hoistedMocks.processRegenerationRequestsMock.mockResolvedValue(undefined)
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
    hoistedMocks.getLastSummaryEndMock.mockResolvedValue(4)
    hoistedMocks.loadProjectedConversationMessagesMock.mockResolvedValue([
      { id: 'msg-1', role: 'user', content: 'sealed user 1' },
      { id: 'msg-2', role: 'assistant', content: 'sealed assistant 1' },
      { id: 'msg-3', role: 'user', content: 'sealed user 2' },
      { id: 'msg-4', role: 'assistant', content: 'sealed assistant 2' },
      { id: 'msg-5', role: 'user', content: 'recent user' },
      { id: 'msg-6', role: 'assistant', content: 'recent assistant' },
    ])

    const supabase = createMemorySupabaseStub({
      summaries: [
        {
          chat_id: 'chat-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 1,
          end_seq: 4,
          summary: 'Condensed recap',
        },
      ],
      facts: [
        {
          chat_id: 'chat-1',
          start_seq: 1,
          end_seq: 4,
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
      { role: 'user', content: 'recent user', messageId: 'msg-5' },
      { role: 'assistant', content: 'recent assistant', messageId: 'msg-6' },
    ])
    expect(result.fallbackSystemPrompt).toBe(
      'STATIC\n\n=== Previous Conversation Summary ===\n[Summary 1-4]\nCondensed recap\n\n=== Key Facts to Remember ===\n[1-4]\nRemember the promise\n\nLore block',
    )
    expect(result.dynamicContext).toBe(
      '=== Previous Conversation Summary ===\n[Summary 1-4]\nCondensed recap\n\n=== Key Facts to Remember ===\n[1-4]\nRemember the promise\n\nLore block',
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
        content: '=== Previous Conversation Summary ===\n[Summary 1-4]\nCondensed recap',
        cachePreference: 'prefer-cache',
        stability: 'sealed',
      },
      {
        role: 'system',
        content: '=== Key Facts to Remember ===\n[1-4]\nRemember the promise',
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

  it('warns and stops when prefix_live_blocks config cannot seal any messages', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await updateMemoryState({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      userId: 'user-1',
      model: {} as never,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
          sealEveryMessages: 4,
          retainTailMessages: 4,
        },
      },
    })

    expect(hoistedMocks.getMessageCountMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[chat-memory] Invalid prefix_live_blocks config', {
      chatId: 'chat-1',
      userId: 'user-1',
      sealEveryMessages: 4,
      retainTailMessages: 4,
    })
  })

  it('returns early when the projected conversation size cannot be determined', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(null)

    await updateMemoryState({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      userId: 'user-1',
      model: {} as never,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
          sealEveryMessages: 6,
          retainTailMessages: 2,
        },
      },
    })

    expect(hoistedMocks.processRegenerationRequestsMock).not.toHaveBeenCalled()
    expect(hoistedMocks.processMetaSummariesMock).not.toHaveBeenCalled()
  })

  it('replays regeneration requests and creates only missing sealed prefix blocks', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(10)
    hoistedMocks.getLastSummaryEndMock.mockResolvedValue(0)
    hoistedMocks.loadProjectedConversationMessagesMock.mockResolvedValue([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ])

    const supabase = createMemorySupabaseStub({
      profiles: [
        {
          id: 'user-1',
          chunk_summary_prompt: 'CUSTOM CHUNK',
          meta_summary_prompt: 'CUSTOM META',
          fact_extraction_prompt: 'CUSTOM FACTS',
        },
      ],
      summaries: [
        {
          chat_id: 'chat-1',
          level: SUMMARY_LEVEL_CHUNK,
          start_seq: 1,
          end_seq: 4,
          summary: 'existing chunk',
        },
      ],
    })

    await updateMemoryState({
      supabase,
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
          sealEveryMessages: 6,
          retainTailMessages: 2,
        },
      },
    })

    expect(hoistedMocks.processRegenerationRequestsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkPrompt: 'CUSTOM CHUNK',
        metaPrompt: 'CUSTOM META',
        factPrompt: 'CUSTOM FACTS',
        chunkSize: 4,
      }),
    )
    expect(hoistedMocks.createChunkSummaryMock).toHaveBeenCalledTimes(1)
    expect(hoistedMocks.createChunkSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        startSeq: 5,
        endSeq: 8,
        systemPrompt: 'CUSTOM CHUNK',
        expectedMessageCount: 4,
        transcriptMessages: [
          { role: 'user', content: 'u1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'u2' },
          { role: 'assistant', content: 'a2' },
        ],
      }),
    )
    expect(hoistedMocks.createChunkFactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        startSeq: 5,
        endSeq: 8,
        factPrompt: 'CUSTOM FACTS',
      }),
    )
    expect(hoistedMocks.processMetaSummariesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metaPrompt: 'CUSTOM META',
      }),
    )
  })

  it('skips duplicate prefix block creation errors and continues to meta summaries', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(6)
    hoistedMocks.createChunkSummaryMock.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    )

    await updateMemoryState({
      supabase: createMemorySupabaseStub(),
      chatId: 'chat-1',
      userId: 'user-1',
      model: {} as never,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
          sealEveryMessages: 6,
          retainTailMessages: 2,
        },
      },
    })

    expect(hoistedMocks.createChunkFactsMock).not.toHaveBeenCalled()
    expect(hoistedMocks.processMetaSummariesMock).toHaveBeenCalled()
  })

  it('logs and aborts prefix block creation on non-duplicate errors', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(6)
    hoistedMocks.createChunkSummaryMock.mockRejectedValue(new Error('llm failure'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await updateMemoryState({
      supabase: createMemorySupabaseStub({
        profiles: [
          {
            id: 'user-1',
          },
        ],
      }),
      chatId: 'chat-1',
      userId: 'user-1',
      model: {} as never,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
          sealEveryMessages: 6,
          retainTailMessages: 2,
        },
      },
    })

    expect(errorSpy).toHaveBeenCalledWith(
      '[chat-memory] Failed to create prefix block summary:',
      expect.any(Error),
    )
    expect(hoistedMocks.processMetaSummariesMock).not.toHaveBeenCalled()
  })

  it('falls back to default summary prompts when profile overrides are missing', async () => {
    hoistedMocks.getMessageCountMock.mockResolvedValue(6)

    await updateMemoryState({
      supabase: createMemorySupabaseStub({
        profiles: [{ id: 'user-1' }],
      }),
      chatId: 'chat-1',
      userId: 'user-1',
      model: {} as never,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      regenerate: {
        regenerateAll: false,
      },
      modelConfig: {
        memory: {
          mode: 'prefix_live_blocks',
          sealEveryMessages: 6,
          retainTailMessages: 2,
        },
      },
    })

    expect(hoistedMocks.processRegenerationRequestsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkPrompt: DEFAULT_CHUNK_SUMMARY_PROMPT,
        metaPrompt: DEFAULT_META_SUMMARY_PROMPT,
        factPrompt: DEFAULT_FACT_EXTRACTION_PROMPT,
      }),
    )
  })
})
