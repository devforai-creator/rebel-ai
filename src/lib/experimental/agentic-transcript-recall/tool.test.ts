import { describe, expect, it } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import { createAgenticTranscriptRecallBudgetState } from './policy'
import { executeFetchSourceRange } from './tool'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'

const chatId = 'chat-1'

const enabledRuntimeConfig: AgenticTranscriptRecallRuntimeConfig = {
  configured: true,
  globallyEnabled: true,
  providerSupported: true,
  providerAllowed: true,
  enabled: true,
  skipReason: null,
  maxToolCalls: 1,
  maxMessagesPerCall: 12,
  maxTotalMessages: 12,
  providerAllowlist: ['openai'],
}

function createTranscriptSupabase() {
  return createSupabaseMock({
    tables: {
      chat_turns: {
        rows: [
          {
            id: 'turn-1',
            chat_id: chatId,
            turn_index: 1,
            user_message_id: 'user-1',
            active_assistant_message_id: 'assistant-1',
          },
          {
            id: 'turn-2',
            chat_id: chatId,
            turn_index: 2,
            user_message_id: 'user-2',
            active_assistant_message_id: 'assistant-2',
          },
        ],
      },
      messages: {
        rows: [
          {
            id: 'user-1',
            chat_id: chatId,
            role: 'user',
            content: 'First line',
            sequence: 1,
            turn_id: 'turn-1',
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'assistant-1',
            chat_id: chatId,
            role: 'assistant',
            content: 'First reply',
            sequence: 2,
            turn_id: 'turn-1',
            variant_index: 1,
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'user-2',
            chat_id: chatId,
            role: 'user',
            content: 'Second line',
            sequence: 3,
            turn_id: 'turn-2',
            message_status: MESSAGE_STATUS_COMPLETED,
          },
          {
            id: 'assistant-2',
            chat_id: chatId,
            role: 'assistant',
            content: 'Second reply',
            sequence: 4,
            turn_id: 'turn-2',
            variant_index: 1,
            message_status: MESSAGE_STATUS_COMPLETED,
          },
        ],
      },
    },
  }) as unknown as SupabaseClientType
}

describe('executeFetchSourceRange', () => {
  it('returns a bounded projected transcript slice and advances budget state on success', async () => {
    const result = await executeFetchSourceRange({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: enabledRuntimeConfig,
      sourceHints: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 2,
            preview: 'The first exchange.',
          },
        ],
      },
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        startSeq: 1,
        endSeq: 2,
        reason: 'Need the exact exchange.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'fetched',
        startSeq: 1,
        endSeq: 2,
        reason: 'Need the exact exchange.',
        messageCount: 2,
        messages: [
          {
            seq: 1,
            role: 'user',
            content: 'First line',
          },
          {
            seq: 2,
            role: 'assistant',
            content: 'First reply',
          },
        ],
      },
      budgetState: {
        toolCallsUsed: 1,
        totalMessagesFetched: 2,
      },
    })
  })

  it('returns a blocked tool result for disallowed ranges without mutating budget state', async () => {
    const result = await executeFetchSourceRange({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: enabledRuntimeConfig,
      sourceHints: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 2,
            preview: 'The first exchange.',
          },
        ],
      },
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        startSeq: 2,
        endSeq: 3,
        reason: 'Try a non-surfaced range.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'range_not_allowed',
        message:
          'requested transcript range must exactly match one of the surfaced summary or fact ranges',
        startSeq: 2,
        endSeq: 3,
        reason: 'Try a non-surfaced range.',
      },
      budgetState: {
        toolCallsUsed: 0,
        totalMessagesFetched: 0,
      },
    })
  })

  it('blocks inconsistent hinted ranges that cannot be resolved from the chat transcript', async () => {
    const result = await executeFetchSourceRange({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: enabledRuntimeConfig,
      sourceHints: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        hints: [
          {
            kind: 'fact',
            label: null,
            startSeq: 3,
            endSeq: 5,
            preview: 'This hint is inconsistent with the chat length.',
          },
        ],
      },
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        startSeq: 3,
        endSeq: 5,
        reason: 'Test inconsistent range.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'range_not_in_chat',
        message:
          'requested transcript range could not be resolved from the current chat transcript',
        startSeq: 3,
        endSeq: 5,
        reason: 'Test inconsistent range.',
      },
      budgetState: {
        toolCallsUsed: 0,
        totalMessagesFetched: 0,
      },
    })
  })
})
