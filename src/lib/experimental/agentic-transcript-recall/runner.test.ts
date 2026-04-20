import { describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import { prepareExperimentalAgenticTranscriptRecallRequest } from './runner'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'

const chatId = 'chat-1'

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

function buildRuntimeConfig(): AgenticTranscriptRecallRuntimeConfig {
  return {
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
}

type TestFetchSourceRangeTool = {
  execute: (
    input: {
      startSeq: number
      endSeq: number
      reason: string
    },
    options: {
      toolCallId: string
      messages: unknown[]
    },
  ) => Promise<unknown>
}

describe('prepareExperimentalAgenticTranscriptRecallRequest', () => {
  it('augments the system prompt and exposes a bounded recall tool', async () => {
    const debugMetrics: Record<string, string | number | boolean | null> = {}
    const result = prepareExperimentalAgenticTranscriptRecallRequest({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: buildRuntimeConfig(),
      sourceHints: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 2,
            preview: 'First exchange',
          },
        ],
      },
      streamRequest: {
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      debugMetrics,
      logDebug: vi.fn(),
    })

    expect(result.streamRequest.system).toContain('FINAL')
    expect(result.streamRequest.system).toContain('Experimental Transcript Recall')
    expect(result.streamTextSettings?.stopWhen).toBeDefined()
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_available: true,
      experimental_agentic_transcript_recall_tool_call_count: 0,
      experimental_agentic_transcript_recall_tool_fetch_count: 0,
      experimental_agentic_transcript_recall_tool_block_count: 0,
    })

    const fetchTool = (
      result.streamTextSettings?.tools as Record<string, TestFetchSourceRangeTool>
    )['fetch_source_range']
    const toolResult = await fetchTool.execute(
      {
        startSeq: 1,
        endSeq: 2,
        reason: 'Need the original wording.',
      },
      {
        toolCallId: 'tool-1',
        messages: [],
      },
    )

    expect(toolResult).toEqual({
      status: 'fetched',
      startSeq: 1,
      endSeq: 2,
      reason: 'Need the original wording.',
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
    })
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_call_count: 1,
      experimental_agentic_transcript_recall_tool_fetch_count: 1,
      experimental_agentic_transcript_recall_tool_block_count: 0,
      experimental_agentic_transcript_recall_tool_total_messages_fetched: 2,
      experimental_agentic_transcript_recall_tool_last_start_seq: 1,
      experimental_agentic_transcript_recall_tool_last_end_seq: 2,
      experimental_agentic_transcript_recall_tool_last_reason: 'Need the original wording.',
      experimental_agentic_transcript_recall_tool_last_block_reason: null,
    })
  })

  it('returns blocked tool results for invalid recall requests without failing the wrapper', async () => {
    const debugMetrics: Record<string, string | number | boolean | null> = {}
    const result = prepareExperimentalAgenticTranscriptRecallRequest({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: buildRuntimeConfig(),
      sourceHints: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 2,
            preview: 'First exchange',
          },
        ],
      },
      streamRequest: {
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      debugMetrics,
      logDebug: vi.fn(),
    })

    const fetchTool = (
      result.streamTextSettings?.tools as Record<string, TestFetchSourceRangeTool>
    )['fetch_source_range']
    const toolResult = await fetchTool.execute(
      {
        startSeq: 2,
        endSeq: 3,
        reason: 'Try an unsupported range.',
      },
      {
        toolCallId: 'tool-2',
        messages: [],
      },
    )

    expect(toolResult).toEqual({
      status: 'blocked',
      blockReason: 'range_not_allowed',
      message:
        'requested transcript range must exactly match one of the surfaced summary or fact ranges',
      startSeq: 2,
      endSeq: 3,
      reason: 'Try an unsupported range.',
    })
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_call_count: 1,
      experimental_agentic_transcript_recall_tool_fetch_count: 0,
      experimental_agentic_transcript_recall_tool_block_count: 1,
      experimental_agentic_transcript_recall_tool_last_block_reason: 'range_not_allowed',
    })
  })
})
