import { describe, expect, it, vi } from 'vitest'
import { SUMMARY_LEVEL_CHUNK, SUMMARY_LEVEL_META } from '@/lib/chat-summaries/config'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { buildPrefixLiveBlocksMemoryPlan } from './prefix-live-blocks'
import { buildMemoryPlan } from './index'
import { resolvePrefixSummaryState } from './prefix-summary-state'

function createConversation(total: number) {
  const messages = Array.from({ length: total }, (_, index) => ({
    id: `msg-${index + 1}`,
    chat_id: 'chat-1',
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${index + 1}`,
    sequence: index + 1,
  }))
  const chunkCount = Math.floor((total - 4) / 10)
  const summaries = [
    ...Array.from({ length: chunkCount }, (_, index) => ({
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
      start_seq: index * 10 + 1,
      end_seq: index * 10 + 10,
      summary: `chunk ${index + 1}`,
    })),
    ...Array.from({ length: Math.floor(chunkCount / 10) }, (_, index) => ({
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_META,
      start_seq: index * 100 + 1,
      end_seq: index * 100 + 100,
      summary: `meta ${index + 1}`,
    })),
  ]
  const supabase = createSupabaseMock({
    tables: {
      chats: { rows: [{ id: 'chat-1', user_id: 'user-1' }] },
      profiles: { rows: [{ id: 'user-1', enable_episodic_rag: false }] },
      chat_summaries: { rows: summaries },
      chat_turns: {
        rows: Array.from({ length: Math.ceil(total / 2) }, (_, index) => ({
          id: `turn-${index + 1}`,
          chat_id: 'chat-1',
          turn_index: index + 1,
          user_message_id: messages[index * 2]?.id ?? null,
          active_assistant_message_id: messages[index * 2 + 1]?.id ?? null,
        })),
      },
      messages: { rows: messages },
    },
  }) as unknown as ChatSummariesSupabaseClient
  return {
    supabase,
    summaries,
    messages: messages.map(({ id, role, content }) => ({ role, content, messageId: id })),
  }
}

function createPrefixModeSupabaseWithFacts(options: {
  profileEnableRag: boolean
  facts?: Array<{ chat_id: string; start_seq: number; end_seq: number; facts: string }>
}): ChatSummariesSupabaseClient {
  return createSupabaseMock({
    tables: {
      chat_summaries: {
        rows: [
          {
            id: 'summary-1',
            chat_id: 'chat-1',
            level: SUMMARY_LEVEL_META,
            start_seq: 1,
            end_seq: 10,
            summary: 'sealed summary',
          },
        ],
      },
      chat_facts: {
        rows: options.facts ?? [],
      },
      chats: {
        rows: [{ id: 'chat-1', user_id: 'user-1' }],
      },
      profiles: {
        rows: [
          {
            id: 'user-1',
            enable_episodic_rag: options.profileEnableRag,
            voyage_embedding_api_key_id: 'voyage-key-1',
          },
        ],
      },
      chat_turns: {
        rows: [],
      },
      messages: {
        rows: [],
      },
    },
  }) as unknown as ChatSummariesSupabaseClient
}

describe('buildPrefixLiveBlocksMemoryPlan', () => {
  it.each([
    [53, 0],
    [54, 50],
    [103, 50],
    [104, 100],
    [154, 150],
    [204, 200],
  ])('uses the completed 50-message boundary at %i messages', async (total, boundary) => {
    const { supabase, messages, summaries } = createConversation(total)
    const result = await buildMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      totalConversationMessages: total,
      baseSystemPrompt: 'STATIC',
      modelConfig: { memory: { mode: 'prefix_live_blocks' } },
    })

    expect(result.fallbackMessages).toEqual(messages.slice(boundary))
    expect(result.promptBlocks.filter((block) => block.stability === 'live')).toHaveLength(
      total - boundary,
    )
    if (boundary > 0) {
      expect(result.dynamicContext).toContain(`[Summary ${boundary - 9}-${boundary}]`)
      expect(result.dynamicContext).not.toContain(`[Summary ${boundary + 1}-${boundary + 10}]`)
    } else {
      expect(result.dynamicContext).toBeNull()
    }
    expect(result.dynamicContext?.includes('[Meta Summary 1-100]') ?? false).toBe(total >= 204)
    expect(
      summaries.filter((row) => row.level === SUMMARY_LEVEL_META).map((row) => row.end_seq),
    ).toEqual(
      Array.from({ length: Math.floor((total - 4) / 100) }, (_, index) => (index + 1) * 100),
    )
  })

  it('retains the complete raw transcript when the first 50-message block has a missing summary', async () => {
    const { supabase, messages } = createConversation(54)
    await supabase.from('chat_summaries').delete().eq('start_seq', 21)
    const result = await buildMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      totalConversationMessages: 54,
      baseSystemPrompt: 'STATIC',
      modelConfig: { memory: { mode: 'prefix_live_blocks' } },
    })

    expect(result.fallbackMessages).toEqual(messages)
    expect(result.dynamicContext).toBeNull()
  })

  it('shares the same stored 10-message chunks and 100-message metas across mode switches', async () => {
    const { supabase, messages, summaries } = createConversation(154)
    const options = {
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages,
      totalConversationMessages: 154,
      baseSystemPrompt: 'STATIC',
    }
    const before = JSON.stringify(summaries)
    const prefix = await buildMemoryPlan({
      ...options,
      modelConfig: { memory: { mode: 'prefix_live_blocks' } },
    })
    const summary = await buildMemoryPlan({
      ...options,
      modelConfig: { memory: { mode: 'summary_window' } },
    })
    const prefixAgain = await buildMemoryPlan({
      ...options,
      modelConfig: { memory: { mode: 'prefix_live_blocks' } },
    })

    expect(prefix.fallbackMessages).toEqual(messages.slice(150))
    expect(summary.fallbackMessages).toEqual(messages.slice(-20))
    expect(summary.dynamicContext).toContain('[Meta Summary 1-100]')
    expect(summary.dynamicContext).toContain('[Summary 101-110]')
    expect(prefixAgain).toEqual(prefix)
    expect(JSON.stringify(summaries)).toBe(before)
  })

  it('reuses the summary snapshot used to load the transcript instead of moving the boundary mid-request', async () => {
    const { supabase, messages } = createConversation(104)
    const state = resolvePrefixSummaryState(
      Array.from({ length: 5 }, (_, index) => ({
        level: SUMMARY_LEVEL_CHUNK,
        start_seq: index * 10 + 1,
        end_seq: index * 10 + 10,
        summary: `snapshot chunk ${index + 1}`,
      })),
    )
    const fromSpy = vi.spyOn(supabase, 'from')
    const result = await buildMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: messages.slice(50),
      transcriptCoverage: 'window',
      transcriptStartOrdinal: 51,
      totalConversationMessages: 104,
      baseSystemPrompt: 'STATIC',
      modelConfig: { memory: { mode: 'prefix_live_blocks' } },
      prefixSummaryState: state,
    })

    expect(result.fallbackMessages).toEqual(messages.slice(50))
    expect(result.dynamicContext).toContain('snapshot chunk 5')
    expect(result.dynamicContext).not.toContain('[Summary 51-60]')
    expect(fromSpy.mock.calls.some(([table]) => table === 'chat_summaries')).toBe(false)
  })

  it('keeps stored facts out of prefix context when episodic memory RAG is disabled', async () => {
    const supabase = createPrefixModeSupabaseWithFacts({
      profileEnableRag: false,
      facts: [{ chat_id: 'chat-1', start_seq: 1, end_seq: 10, facts: '- sealed fact' }],
    })

    const result = await buildPrefixLiveBlocksMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [{ role: 'user', content: 'live user', messageId: 'msg-11' }],
      transcriptCoverage: 'window',
      transcriptStartOrdinal: 11,
      baseSystemPrompt: 'STATIC PROMPT',
    })

    expect(result.dynamicContext).toContain('sealed summary')
    expect(result.dynamicContext).not.toContain('sealed fact')
    expect(result.fallbackSystemPrompt).not.toContain('sealed fact')
    expect(result.promptBlocks).toEqual([
      {
        role: 'system',
        content: 'STATIC PROMPT',
        cachePreference: 'prefer-cache',
        stability: 'static',
      },
      {
        role: 'system',
        content: '=== Previous Conversation Summary ===\n[Meta Summary 1-10]\nsealed summary',
        cachePreference: 'prefer-cache',
        stability: 'sealed',
      },
      {
        role: 'user',
        content: 'live user',
        cachePreference: 'prefer-cache',
        stability: 'live',
      },
    ])
  })

  it('still includes stored facts in prefix context when episodic memory RAG is enabled', async () => {
    const supabase = createPrefixModeSupabaseWithFacts({
      profileEnableRag: true,
      facts: [{ chat_id: 'chat-1', start_seq: 1, end_seq: 10, facts: '- sealed fact' }],
    })

    const result = await buildPrefixLiveBlocksMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [{ role: 'user', content: 'live user', messageId: 'msg-11' }],
      transcriptCoverage: 'window',
      transcriptStartOrdinal: 11,
      baseSystemPrompt: 'STATIC PROMPT',
    })

    expect(result.dynamicContext).toContain('sealed summary')
    expect(result.dynamicContext).toContain('sealed fact')
    expect(result.fallbackSystemPrompt).toContain('sealed fact')
  })

  it('rolls over only older meta summaries while keeping the current meta window as chunks', async () => {
    const oldChunks = Array.from({ length: 10 }, (_, index) => ({
      id: `old-chunk-${index + 1}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
      start_seq: index * 10 + 1,
      end_seq: index * 10 + 10,
      summary: `old chunk ${index + 1}`,
    }))

    const currentChunks = Array.from({ length: 10 }, (_, index) => ({
      id: `current-chunk-${index + 1}`,
      chat_id: 'chat-1',
      level: SUMMARY_LEVEL_CHUNK,
      start_seq: 101 + index * 10,
      end_seq: 110 + index * 10,
      summary: `current chunk ${index + 1}`,
    }))

    const supabase = createSupabaseMock({
      tables: {
        chat_summaries: {
          rows: [
            {
              id: 'meta-1',
              chat_id: 'chat-1',
              level: SUMMARY_LEVEL_META,
              start_seq: 1,
              end_seq: 100,
              summary: 'meta 1-100',
            },
            {
              id: 'meta-2',
              chat_id: 'chat-1',
              level: SUMMARY_LEVEL_META,
              start_seq: 101,
              end_seq: 200,
              summary: 'meta 101-200 should be hidden',
            },
            ...oldChunks,
            ...currentChunks,
          ],
        },
        chat_facts: {
          rows: [],
        },
        chats: {
          rows: [{ id: 'chat-1', user_id: 'user-1' }],
        },
        profiles: {
          rows: [
            {
              id: 'user-1',
              enable_episodic_rag: false,
              voyage_embedding_api_key_id: null,
            },
          ],
        },
        chat_turns: {
          rows: [],
        },
        messages: {
          rows: [],
        },
      },
    }) as unknown as ChatSummariesSupabaseClient

    const result = await buildPrefixLiveBlocksMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [
        { role: 'user', content: 'raw 201', messageId: 'msg-201' },
        { role: 'assistant', content: 'raw 250', messageId: 'msg-250' },
      ],
      transcriptCoverage: 'window',
      transcriptStartOrdinal: 201,
      baseSystemPrompt: 'STATIC PROMPT',
    })

    const dynamicContext = result.dynamicContext ?? ''

    expect(dynamicContext).toContain('[Meta Summary 1-100]')
    expect(dynamicContext).toContain('meta 1-100')
    expect(dynamicContext).not.toContain('meta 101-200 should be hidden')

    expect(dynamicContext).not.toContain('old chunk 1')
    expect(dynamicContext).toContain('[Summary 101-110]')
    expect(dynamicContext).toContain('current chunk 1')
    expect(dynamicContext).toContain('[Summary 191-200]')
    expect(dynamicContext).toContain('current chunk 10')

    expect(result.fallbackMessages).toEqual([
      { role: 'user', content: 'raw 201', messageId: 'msg-201' },
      { role: 'assistant', content: 'raw 250', messageId: 'msg-250' },
    ])
  })
})
