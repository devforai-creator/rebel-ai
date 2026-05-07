import { describe, expect, it } from 'vitest'
import { SUMMARY_LEVEL_CHUNK, SUMMARY_LEVEL_META } from '@/lib/chat-summaries/config'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { buildPrefixLiveBlocksMemoryPlan } from './prefix-live-blocks'

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
