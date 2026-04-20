import { describe, expect, it } from 'vitest'
import { SUMMARY_LEVEL_META } from '@/lib/chat-summaries/config'
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

describe('buildPrefixLiveBlocksMemoryPlan facts gating', () => {
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
})
