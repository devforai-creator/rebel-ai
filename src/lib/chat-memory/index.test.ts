import { describe, expect, it } from 'vitest'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import {
  buildPrefixLiveBlocksMemoryPlan,
  calculatePrefixLiveBlockBoundaries,
} from './prefix-live-blocks'

function createPrefixModeSupabaseStub(options?: {
  visibleSummaryEnd?: number | null
  summaryLevel?: number
  liveMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
}): ChatSummariesSupabaseClient {
  const liveMessages = (options?.liveMessages ?? []).map((message, index) => ({
    id: `msg-${index + 1}`,
    chat_id: 'chat-1',
    role: message.role,
    content: message.content,
    sequence: index + 1,
    turn_id:
      index % 2 === 0 ? `turn-${Math.floor(index / 2) + 1}` : `turn-${Math.floor(index / 2) + 1}`,
  }))

  const turns = Array.from({ length: Math.ceil(liveMessages.length / 2) }, (_, index) => ({
    id: `turn-${index + 1}`,
    chat_id: 'chat-1',
    turn_index: index + 1,
    user_message_id: liveMessages[index * 2]?.id ?? null,
    active_assistant_message_id: liveMessages[index * 2 + 1]?.id ?? null,
  }))

  return createSupabaseMock({
    tables: {
      chat_summaries: {
        rows:
          typeof options?.visibleSummaryEnd === 'number'
            ? [
                {
                  id: 'summary-1',
                  chat_id: 'chat-1',
                  level: options?.summaryLevel ?? 1,
                  start_seq: 1,
                  end_seq: options.visibleSummaryEnd,
                  summary: 'sealed',
                },
              ]
            : [],
      },
      chat_facts: {
        rows: [],
      },
      chat_turns: {
        rows: turns,
      },
      messages: {
        rows: liveMessages,
      },
    },
  }) as unknown as ChatSummariesSupabaseClient
}

describe('calculatePrefixLiveBlockBoundaries', () => {
  it('derives canonical 10-message chunk boundaries under the retained tail', () => {
    expect(calculatePrefixLiveBlockBoundaries(100, 0, 96, 4)).toEqual([
      { start: 1, end: 10 },
      { start: 11, end: 20 },
      { start: 21, end: 30 },
      { start: 31, end: 40 },
      { start: 41, end: 50 },
      { start: 51, end: 60 },
      { start: 61, end: 70 },
      { start: 71, end: 80 },
      { start: 81, end: 90 },
    ])
    expect(calculatePrefixLiveBlockBoundaries(103, 90, 96, 4)).toEqual([])
    expect(calculatePrefixLiveBlockBoundaries(104, 90, 96, 4)).toEqual([{ start: 91, end: 100 }])
  })
})

describe('buildPrefixLiveBlocksMemoryPlan', () => {
  it('builds prefix_live_blocks from the provided live transcript', async () => {
    const supabase = createPrefixModeSupabaseStub({
      liveMessages: [
        { role: 'user', content: 'db-user-1' },
        { role: 'assistant', content: 'db-assistant-2' },
      ],
    })

    const result = await buildPrefixLiveBlocksMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [
        { role: 'user', content: 'db-user-1', messageId: 'msg-1' },
        { role: 'assistant', content: 'db-assistant-2', messageId: 'msg-2' },
      ],
      baseSystemPrompt: 'STATIC PROMPT',
    })

    expect(result.mode).toBe('prefix_live_blocks')
    expect(result.fallbackSystemPrompt).toBe('STATIC PROMPT')
    expect(result.fallbackMessages).toEqual([
      { role: 'user', content: 'db-user-1', messageId: 'msg-1' },
      { role: 'assistant', content: 'db-assistant-2', messageId: 'msg-2' },
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

  it('falls back to the active assistant variant from DB when no transcript is provided', async () => {
    const supabase = createSupabaseMock({
      tables: {
        chat_summaries: {
          rows: [],
        },
        chat_facts: {
          rows: [],
        },
        chat_turns: {
          rows: [
            {
              id: 'turn-1',
              chat_id: 'chat-1',
              turn_index: 1,
              user_message_id: 'msg-1',
              active_assistant_message_id: 'msg-3',
            },
          ],
        },
        messages: {
          rows: [
            { id: 'msg-1', chat_id: 'chat-1', role: 'user', content: 'db-user-1', sequence: 1 },
            {
              id: 'msg-2',
              chat_id: 'chat-1',
              role: 'assistant',
              content: 'superseded-assistant',
              sequence: 2,
              message_status: 'superseded',
            },
            {
              id: 'msg-3',
              chat_id: 'chat-1',
              role: 'assistant',
              content: 'active-assistant',
              sequence: 3,
            },
          ],
        },
      },
    }) as unknown as ChatSummariesSupabaseClient
    const result = await buildPrefixLiveBlocksMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [],
      baseSystemPrompt: 'STATIC PROMPT',
    })

    expect(result.fallbackMessages).toEqual([
      { role: 'user', content: 'db-user-1', messageId: 'msg-1' },
      { role: 'assistant', content: 'active-assistant', messageId: 'msg-3' },
    ])
  })

  it('does not reintroduce the active assistant during regeneration in prefix mode', async () => {
    const supabase = createSupabaseMock({
      tables: {
        chat_summaries: {
          rows: [],
        },
        chat_facts: {
          rows: [],
        },
        chat_turns: {
          rows: [
            {
              id: 'turn-1',
              chat_id: 'chat-1',
              turn_index: 1,
              user_message_id: 'msg-1',
              active_assistant_message_id: 'msg-2',
            },
          ],
        },
        messages: {
          rows: [
            { id: 'msg-1', chat_id: 'chat-1', role: 'user', content: 'db-user-1', sequence: 1 },
            {
              id: 'msg-2',
              chat_id: 'chat-1',
              role: 'assistant',
              content: 'old-active-assistant',
              sequence: 2,
            },
          ],
        },
      },
    }) as unknown as ChatSummariesSupabaseClient
    const result = await buildPrefixLiveBlocksMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [{ role: 'user', content: 'db-user-1', messageId: 'msg-1' }],
      baseSystemPrompt: 'STATIC PROMPT',
    })

    expect(result.fallbackMessages).toEqual([
      { role: 'user', content: 'db-user-1', messageId: 'msg-1' },
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
    ])
  })

  it('does not fall back to DB when an explicit empty live window is provided', async () => {
    const supabase = createPrefixModeSupabaseStub({
      visibleSummaryEnd: 100,
      liveMessages: [
        { role: 'user', content: 'sealed user 1' },
        { role: 'assistant', content: 'sealed assistant 1' },
        { role: 'user', content: 'sealed user 2' },
        { role: 'assistant', content: 'sealed assistant 2' },
      ],
    })

    const result = await buildPrefixLiveBlocksMemoryPlan({
      supabase,
      chatId: 'chat-1',
      sanitizedMessages: [],
      transcriptCoverage: 'window',
      transcriptStartOrdinal: 5,
      baseSystemPrompt: 'STATIC PROMPT',
    })

    expect(result.fallbackMessages).toEqual([])
    expect(result.promptBlocks).toEqual([
      {
        role: 'system',
        content: 'STATIC PROMPT',
        cachePreference: 'prefer-cache',
        stability: 'static',
      },
      {
        role: 'system',
        content: '=== Previous Conversation Summary ===\n[Meta Summary 1-100]\nsealed',
        cachePreference: 'prefer-cache',
        stability: 'sealed',
      },
    ])
  })
})
