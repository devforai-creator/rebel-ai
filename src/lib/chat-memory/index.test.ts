import { describe, expect, it } from 'vitest'
import type { ChatModelConfig } from '@/lib/chat/model-config'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { buildMemoryPlan, calculatePrefixLiveBlockBoundaries } from './index'

function createPrefixModeSupabaseStub(options?: {
  lastChunkEnd?: number | null
  liveMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
}): ChatSummariesSupabaseClient {
  const liveMessages = options?.liveMessages ?? []

  const chatSummariesQuery = {
    select: () => chatSummariesQuery,
    eq: () => chatSummariesQuery,
    lte: () => chatSummariesQuery,
    order: () => chatSummariesQuery,
    limit: () => chatSummariesQuery,
    maybeSingle: async () => {
      if (typeof options?.lastChunkEnd === 'number') {
        return { data: { end_seq: options.lastChunkEnd }, error: null }
      }
      return { data: null, error: { code: 'PGRST116', message: 'No rows found' } }
    },
  }

  const messagesQuery = {
    select: () => messagesQuery,
    eq: () => messagesQuery,
    neq: () => messagesQuery,
    gt: () => messagesQuery,
    order: async () => ({
      data: liveMessages,
      error: null,
    }),
  }

  return {
    from: (table: string) => {
      if (table === 'chat_summaries') {
        return chatSummariesQuery
      }
      if (table === 'messages') {
        return messagesQuery
      }
      if (table === 'chat_facts') {
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  } as unknown as ChatSummariesSupabaseClient
}

describe('calculatePrefixLiveBlockBoundaries', () => {
  it('seals when total messages reaches threshold minus retained tail', () => {
    expect(calculatePrefixLiveBlockBoundaries(100, 0, 96, 4)).toEqual([{ start: 1, end: 96 }])
    expect(calculatePrefixLiveBlockBoundaries(195, 96, 96, 4)).toEqual([])
    expect(calculatePrefixLiveBlockBoundaries(196, 96, 96, 4)).toEqual([{ start: 97, end: 192 }])
  })
})

describe('buildMemoryPlan', () => {
  it('builds prefix_live_blocks from database-backed live messages', async () => {
    const supabase = createPrefixModeSupabaseStub({
      liveMessages: [
        { role: 'user', content: 'db-user-1' },
        { role: 'assistant', content: 'db-assistant-2' },
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
      sanitizedMessages: [{ role: 'user', content: 'client-only' }],
      baseSystemPrompt: 'STATIC PROMPT',
      modelConfig,
    })

    expect(result.mode).toBe('prefix_live_blocks')
    expect(result.fallbackSystemPrompt).toBe('STATIC PROMPT')
    expect(result.fallbackMessages).toEqual([
      { role: 'user', content: 'db-user-1' },
      { role: 'assistant', content: 'db-assistant-2' },
    ])
    expect(result.promptBlocks).toEqual([
      {
        role: 'system',
        content: 'STATIC PROMPT',
        cachePreference: 'prefer-cache',
        stability: 'static',
      },
      {
        role: 'user',
        content: 'db-user-1',
        cachePreference: 'prefer-cache',
        stability: 'live',
      },
      {
        role: 'assistant',
        content: 'db-assistant-2',
        cachePreference: 'prefer-cache',
        stability: 'live',
      },
    ])
  })
})
