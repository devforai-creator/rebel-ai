import { describe, expect, it } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import { createAgenticTranscriptRecallBudgetState } from './policy'
import type { AgenticTranscriptRecallSourceMap } from './source-map'
import { executeFetchSourceRange } from './tool'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'

const chatId = 'chat-1'

const enabledRuntimeConfig: AgenticTranscriptRecallRuntimeConfig = {
  configured: true,
  accountDefaultEnabled: false,
  preferenceSource: 'chat_override',
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

function buildSourceMap(
  overrides: Partial<AgenticTranscriptRecallSourceMap> = {},
): AgenticTranscriptRecallSourceMap {
  return {
    rawContextStartOrdinal: 5,
    cutoffOrdinal: 4,
    directFetchRanges: [],
    navigationParents: [],
    ...overrides,
  }
}

describe('executeFetchSourceRange', () => {
  it('returns a bounded projected transcript slice and advances budget state on success', async () => {
    const result = await executeFetchSourceRange({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: enabledRuntimeConfig,
      sourceMap: buildSourceMap({
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 2,
            preview: 'The first exchange.',
          },
        ],
      }),
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        rangeId: 'R1',
        reason: 'Need the exact exchange.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'fetched',
        rangeId: 'R1',
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
      sourceMap: buildSourceMap({
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 2,
            preview: 'The first exchange.',
          },
        ],
      }),
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        rangeId: 'R9',
        reason: 'Try a non-surfaced range id.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'range_id_not_available',
        message:
          'requested transcript range id must match one directly fetchable surfaced range or expanded child range available to this reply',
        rangeId: 'R9',
        startSeq: null,
        endSeq: null,
        reason: 'Try a non-surfaced range id.',
      },
      budgetState: {
        toolCallsUsed: 0,
        totalMessagesFetched: 0,
      },
    })
  })

  it('blocks oversized surfaced parent ranges with an explicit expansion-required reason', async () => {
    const result = await executeFetchSourceRange({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: enabledRuntimeConfig,
      sourceMap: buildSourceMap({
        rawContextStartOrdinal: 101,
        cutoffOrdinal: 100,
        navigationParents: [
          {
            parentRange: {
              kind: 'summary',
              label: 'meta_summary',
              parentId: 'P1',
              startSeq: 1,
              endSeq: 100,
              preview: 'Large parent range.',
            },
            childRanges: [],
          },
        ],
      }),
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        rangeId: 'P1',
        reason: 'Need the exact ending location.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'parent_range_requires_expansion',
        message:
          'requested transcript range id refers to a surfaced parent range and must be expanded into a smaller child range before raw fetch',
        rangeId: 'P1',
        startSeq: null,
        endSeq: null,
        reason: 'Need the exact ending location.',
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
      sourceMap: buildSourceMap({
        rawContextStartOrdinal: 10,
        cutoffOrdinal: 9,
        directFetchRanges: [
          {
            kind: 'fact',
            label: null,
            rangeId: 'R5',
            startSeq: 5,
            endSeq: 7,
            preview: 'This hint is inconsistent with the chat length.',
          },
        ],
      }),
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        rangeId: 'R5',
        reason: 'Test inconsistent range.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'range_not_in_chat',
        message:
          'requested transcript range could not be resolved from the current chat transcript',
        rangeId: 'R5',
        startSeq: 5,
        endSeq: 7,
        reason: 'Test inconsistent range.',
      },
      budgetState: {
        toolCallsUsed: 1,
        totalMessagesFetched: 0,
      },
    })
  })

  it('consumes fetch call budget when transcript loading fails after policy approval', async () => {
    const result = await executeFetchSourceRange({
      supabase: null as never,
      chatId,
      runtimeConfig: enabledRuntimeConfig,
      sourceMap: buildSourceMap({
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 2,
            preview: 'The first exchange.',
          },
        ],
      }),
      budgetState: createAgenticTranscriptRecallBudgetState(),
      input: {
        rangeId: 'R1',
        reason: 'Need the exact exchange.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'tool_execution_failed',
        message: 'transcript recall tool execution failed and was blocked for this request',
        rangeId: 'R1',
        startSeq: 1,
        endSeq: 2,
        reason: 'Need the exact exchange.',
      },
      budgetState: {
        toolCallsUsed: 1,
        totalMessagesFetched: 0,
      },
    })
  })
})
