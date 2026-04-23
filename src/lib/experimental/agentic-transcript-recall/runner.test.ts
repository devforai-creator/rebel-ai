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
}

type TestFetchSourceRangeTool = {
  execute: (
    input: {
      rangeId: string
      reason: string
    },
    options: {
      toolCallId: string
      messages: unknown[]
    },
  ) => Promise<unknown>
}

type TestExpandSourceRangeTool = {
  execute: (
    input: {
      parentId: string
      reason: string
    },
    options: {
      toolCallId: string
      messages: unknown[]
    },
  ) => Promise<unknown>
}

describe('prepareExperimentalAgenticTranscriptRecallRequest', () => {
  it('fails closed when surfaced hints exist but no tool-capable source map is available', () => {
    const debugMetrics: Record<string, string | number | boolean | null> = {}
    const streamRequest = {
      system: 'FINAL',
      messages: [{ role: 'user', content: 'Hello' }],
    }
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
      sourceMap: null,
      streamRequest,
      debugMetrics,
      logDebug: vi.fn(),
    })

    expect(result).toEqual({
      streamRequest,
    })
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_available: false,
      experimental_agentic_transcript_recall_expand_available: false,
      experimental_agentic_transcript_recall_tool_call_count: 0,
      experimental_agentic_transcript_recall_expand_call_count: 0,
    })
  })

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
      sourceMap: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 2,
            preview: 'First exchange',
          },
        ],
        navigationParents: [],
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
    expect(result.streamRequest.system).toContain(
      'Use summaries and recent raw context by default.',
    )
    expect(result.streamRequest.system).toContain(
      'Treat transcript recall as bounded selection, not numeric transcription.',
    )
    expect(result.streamRequest.system).toContain(
      'Direct fetch ids available for this reply: R1=[Summary 1-2].',
    )
    expect(result.streamRequest.system).toContain('fetch_source_range')
    expect(result.streamRequest.system).not.toContain('expand_source_range')
    expect(result.streamTextSettings?.stopWhen).toBeDefined()
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_available: true,
      experimental_agentic_transcript_recall_expand_available: false,
      experimental_agentic_transcript_recall_tool_call_count: 0,
      experimental_agentic_transcript_recall_tool_fetch_count: 0,
      experimental_agentic_transcript_recall_tool_block_count: 0,
    })

    const fetchTool = (
      result.streamTextSettings?.tools as Record<string, TestFetchSourceRangeTool>
    )['fetch_source_range']
    const toolResult = await fetchTool.execute(
      {
        rangeId: 'R1',
        reason: 'Need the original wording.',
      },
      {
        toolCallId: 'tool-1',
        messages: [],
      },
    )

    expect(toolResult).toEqual({
      status: 'fetched',
      rangeId: 'R1',
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
      experimental_agentic_transcript_recall_tool_last_range_id: 'R1',
      experimental_agentic_transcript_recall_tool_last_start_seq: 1,
      experimental_agentic_transcript_recall_tool_last_end_seq: 2,
      experimental_agentic_transcript_recall_tool_last_reason: 'Need the original wording.',
      experimental_agentic_transcript_recall_tool_last_block_reason: null,
    })
  })

  it('does not advertise raw fetch when only parent expansion is available', () => {
    const result = prepareExperimentalAgenticTranscriptRecallRequest({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: buildRuntimeConfig(),
      sourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'meta_summary',
            startSeq: 1,
            endSeq: 40,
            preview: 'Large parent range',
          },
        ],
      },
      sourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [],
        navigationParents: [
          {
            parentRange: {
              kind: 'summary',
              label: 'meta_summary',
              parentId: 'P1',
              startSeq: 1,
              endSeq: 40,
              preview: 'Large parent range',
            },
            childRanges: [],
          },
        ],
      },
      streamRequest: {
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      debugMetrics: {},
      logDebug: vi.fn(),
    })

    expect(result.streamRequest.system).toContain('expand_source_range')
    expect(result.streamRequest.system).toContain(
      'No `fetch_source_range` tool is available for this reply.',
    )
    expect(result.streamRequest.system).toContain(
      'Expandable parent ids available for this reply: P1=[Meta Summary 1-40].',
    )
    expect(result.streamTextSettings?.tools).toMatchObject({
      expand_source_range: expect.any(Object),
    })
    expect(result.streamTextSettings?.tools).not.toHaveProperty('fetch_source_range')
  })

  it('keeps the live system empty when google cachedContent already owns the prompt prefix', () => {
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
      sourceMap: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 2,
            preview: 'First exchange',
          },
        ],
        navigationParents: [],
      },
      streamRequest: {
        messages: [{ role: 'user', content: 'Hello' }],
        providerOptions: {
          google: {
            cachedContent: 'cachedContents/atr-1',
          },
        },
      },
      debugMetrics: {},
      logDebug: vi.fn(),
    })

    expect((result.streamRequest as { system?: string }).system).toBeUndefined()
    expect(result.streamTextSettings?.tools).toMatchObject({
      fetch_source_range: expect.any(Object),
    })
  })

  it('always adds the stronger recall-priority instruction when transcript recall tools are available', () => {
    const result = prepareExperimentalAgenticTranscriptRecallRequest({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: buildRuntimeConfig(),
      sourceHints: {
        rawContextStartOrdinal: 301,
        cutoffOrdinal: 300,
        hints: [
          {
            kind: 'summary',
            label: 'meta_summary',
            startSeq: 201,
            endSeq: 300,
            preview: 'Older parent range',
          },
        ],
      },
      sourceMap: {
        rawContextStartOrdinal: 301,
        cutoffOrdinal: 300,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 291,
            endSeq: 300,
            preview: 'Last child range',
          },
        ],
        navigationParents: [
          {
            parentRange: {
              kind: 'summary',
              label: 'meta_summary',
              parentId: 'P1',
              startSeq: 201,
              endSeq: 300,
              preview: 'Older parent range',
            },
            childRanges: [
              {
                kind: 'summary',
                label: 'summary',
                rangeId: 'R1',
                startSeq: 291,
                endSeq: 300,
                preview: 'Last child range',
              },
            ],
          },
        ],
      },
      streamRequest: {
        system: 'FINAL',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
      },
      debugMetrics: {},
      logDebug: vi.fn(),
    })

    expect(result.streamRequest.system).toContain('=== Recall Priority ===')
    expect(result.streamRequest.system).toContain(
      'Use transcript recall when the next reply likely depends on older conversation detail that is not already visible, summaries may not be specific enough, and getting that detail wrong would materially change the reply.',
    )
    expect(result.streamRequest.system).toContain(
      'Think in terms of three checks: oldness, exactness, and materiality.',
    )
    expect(result.streamRequest.system).toContain(
      'Common recall-friendly cases include first or last occurrence, exact wording or exact sequence, promises or agreements, plans or boundaries, relationship-changing moments, contradiction checks against earlier dialogue, and vague references to a specific older scene or incident.',
    )
    expect(result.streamRequest.system).toContain(
      'Use `fetch_source_range` when exact older source detail matters more than broad continuity, especially for wording, sequence, promises, boundaries, turning points, or contradiction checks.',
    )
    expect(result.streamRequest.system).toContain(
      'If the likely evidence sits inside a surfaced parent range and the best child range is unclear, expand first.',
    )
    expect(result.streamRequest.system).toContain(
      'Direct fetch ids available for this reply: R1=[Summary 291-300].',
    )
    expect(result.streamRequest.system).toContain(
      'Expandable parent ids available for this reply: P1=[Meta Summary 201-300].',
    )
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
      sourceMap: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 2,
            preview: 'First exchange',
          },
        ],
        navigationParents: [],
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
        rangeId: 'R9',
        reason: 'Try an unsupported range id.',
      },
      {
        toolCallId: 'tool-2',
        messages: [],
      },
    )

    expect(toolResult).toEqual({
      status: 'blocked',
      blockReason: 'range_id_not_available',
      message:
        'requested transcript range id must match one directly fetchable surfaced range or expanded child range available to this reply',
      rangeId: 'R9',
      startSeq: null,
      endSeq: null,
      reason: 'Try an unsupported range id.',
    })
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_call_count: 1,
      experimental_agentic_transcript_recall_tool_fetch_count: 0,
      experimental_agentic_transcript_recall_tool_block_count: 1,
      experimental_agentic_transcript_recall_tool_last_range_id: 'R9',
      experimental_agentic_transcript_recall_tool_last_block_reason: 'range_id_not_available',
    })
  })

  it('treats stale hinted fetch failures as consuming the fetch-call budget', async () => {
    const debugMetrics: Record<string, string | number | boolean | null> = {}
    const result = prepareExperimentalAgenticTranscriptRecallRequest({
      supabase: createTranscriptSupabase(),
      chatId,
      runtimeConfig: buildRuntimeConfig(),
      sourceHints: {
        rawContextStartOrdinal: 10,
        cutoffOrdinal: 9,
        hints: [
          {
            kind: 'fact',
            label: null,
            startSeq: 5,
            endSeq: 7,
            preview: 'Inconsistent stale range',
          },
        ],
      },
      sourceMap: {
        rawContextStartOrdinal: 10,
        cutoffOrdinal: 9,
        directFetchRanges: [
          {
            kind: 'fact',
            label: null,
            rangeId: 'R5',
            startSeq: 5,
            endSeq: 7,
            preview: 'Inconsistent stale range',
          },
        ],
        navigationParents: [],
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

    const firstAttempt = await fetchTool.execute(
      {
        rangeId: 'R5',
        reason: 'Try the stale range once.',
      },
      {
        toolCallId: 'tool-stale-1',
        messages: [],
      },
    )

    const secondAttempt = await fetchTool.execute(
      {
        rangeId: 'R5',
        reason: 'Try the stale range again.',
      },
      {
        toolCallId: 'tool-stale-2',
        messages: [],
      },
    )

    expect(firstAttempt).toEqual({
      status: 'blocked',
      blockReason: 'range_not_in_chat',
      message: 'requested transcript range could not be resolved from the current chat transcript',
      rangeId: 'R5',
      startSeq: 5,
      endSeq: 7,
      reason: 'Try the stale range once.',
    })
    expect(secondAttempt).toEqual({
      status: 'blocked',
      blockReason: 'max_tool_calls_exceeded',
      message: 'transcript recall tool-call budget has already been used',
      rangeId: 'R5',
      startSeq: null,
      endSeq: null,
      reason: 'Try the stale range again.',
    })
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_call_count: 2,
      experimental_agentic_transcript_recall_tool_fetch_count: 0,
      experimental_agentic_transcript_recall_tool_block_count: 2,
      experimental_agentic_transcript_recall_tool_last_range_id: 'R5',
      experimental_agentic_transcript_recall_tool_last_block_reason: 'max_tool_calls_exceeded',
    })
  })

  it('exposes a bounded parent expansion tool when navigation parents exist', async () => {
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
          {
            kind: 'summary',
            label: 'meta_summary',
            startSeq: 1,
            endSeq: 4,
            preview: 'Parent summary',
          },
        ],
      },
      sourceMap: {
        rawContextStartOrdinal: 5,
        cutoffOrdinal: 4,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 2,
            preview: 'First exchange',
          },
        ],
        navigationParents: [
          {
            parentRange: {
              kind: 'summary',
              label: 'meta_summary',
              parentId: 'P1',
              startSeq: 1,
              endSeq: 4,
              preview: 'Parent summary',
            },
            childRanges: [
              {
                kind: 'summary',
                label: 'summary',
                rangeId: 'R1',
                startSeq: 1,
                endSeq: 2,
                preview: 'First exchange',
              },
            ],
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

    const expandTool = (
      result.streamTextSettings?.tools as Record<string, TestExpandSourceRangeTool>
    )['expand_source_range']
    const toolResult = await expandTool.execute(
      {
        parentId: 'P1',
        reason: 'Need smaller child ranges first.',
      },
      {
        toolCallId: 'tool-3',
        messages: [],
      },
    )

    expect(toolResult).toEqual({
      status: 'expanded',
      parentId: 'P1',
      parentStartSeq: 1,
      parentEndSeq: 4,
      reason: 'Need smaller child ranges first.',
      childRangeCount: 1,
      childRanges: [
        {
          kind: 'summary',
          label: 'summary',
          rangeId: 'R1',
          startSeq: 1,
          endSeq: 2,
          preview: 'First exchange',
        },
      ],
    })
    expect(debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_expand_available: true,
      experimental_agentic_transcript_recall_expand_call_count: 1,
      experimental_agentic_transcript_recall_expand_last_parent_id: 'P1',
      experimental_agentic_transcript_recall_expand_last_parent_start_seq: 1,
      experimental_agentic_transcript_recall_expand_last_parent_end_seq: 4,
      experimental_agentic_transcript_recall_expand_last_reason: 'Need smaller child ranges first.',
      experimental_agentic_transcript_recall_expand_last_block_reason: null,
      experimental_agentic_transcript_recall_expand_last_child_range_count: 1,
    })
  })
})
