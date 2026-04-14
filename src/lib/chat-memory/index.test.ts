import { describe, expect, it } from 'vitest'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import {
  buildPrefixLiveBlocksMemoryPlan,
  calculatePrefixLiveBlockBoundaries,
} from './prefix-live-blocks'

function createPrefixModeSupabaseStub(options?: {
  lastChunkEnd?: number | null
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
          typeof options?.lastChunkEnd === 'number'
            ? [
                {
                  id: 'summary-1',
                  chat_id: 'chat-1',
                  level: 0,
                  start_seq: 1,
                  end_seq: options.lastChunkEnd,
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
  it('seals when total messages reaches threshold minus retained tail', () => {
    expect(calculatePrefixLiveBlockBoundaries(100, 0, 96, 4)).toEqual([{ start: 1, end: 96 }])
    expect(calculatePrefixLiveBlockBoundaries(195, 96, 96, 4)).toEqual([])
    expect(calculatePrefixLiveBlockBoundaries(196, 96, 96, 4)).toEqual([{ start: 97, end: 192 }])
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
})
