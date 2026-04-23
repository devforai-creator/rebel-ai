import { describe, expect, it } from 'vitest'

import {
  createAgenticTranscriptRecallBudgetState,
  evaluateFetchSourceRangeRequest,
  validateFetchedSourceRange,
} from './policy'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import type { AgenticTranscriptRecallSourceMap } from './source-map'

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

describe('evaluateFetchSourceRangeRequest', () => {
  const buildSourceMap = (
    overrides: Partial<AgenticTranscriptRecallSourceMap> = {},
  ): AgenticTranscriptRecallSourceMap => ({
    rawContextStartOrdinal: 21,
    cutoffOrdinal: 20,
    directFetchRanges: [],
    navigationParents: [],
    ...overrides,
  })

  it('allows an exact surfaced range and advances the budget state', () => {
    expect(
      evaluateFetchSourceRangeRequest({
        runtimeConfig: enabledRuntimeConfig,
        sourceMap: buildSourceMap({
          directFetchRanges: [
            {
              kind: 'summary',
              label: 'summary',
              rangeId: 'R1',
              startSeq: 1,
              endSeq: 10,
              preview: 'Older context',
            },
          ],
        }),
        budgetState: createAgenticTranscriptRecallBudgetState(),
        request: {
          rangeId: 'R1',
          reason: 'Need the exact wording.',
        },
      }),
    ).toEqual({
      status: 'allowed',
      requestedRange: {
        startSeq: 1,
        endSeq: 10,
      },
      expectedMessageCount: 10,
      nextBudgetState: {
        toolCallsUsed: 1,
        totalMessagesFetched: 10,
      },
    })
  })

  it('blocks arbitrary subranges that are not exact surfaced hints', () => {
    expect(
      evaluateFetchSourceRangeRequest({
        runtimeConfig: enabledRuntimeConfig,
        sourceMap: buildSourceMap({
          directFetchRanges: [
            {
              kind: 'summary',
              label: 'summary',
              rangeId: 'R1',
              startSeq: 1,
              endSeq: 10,
              preview: 'Older context',
            },
          ],
        }),
        budgetState: createAgenticTranscriptRecallBudgetState(),
        request: {
          rangeId: 'R9',
          reason: 'Need a surfaced range that does not exist.',
        },
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'range_id_not_available',
      message:
        'requested transcript range id must match one directly fetchable surfaced range or expanded child range available to this reply',
    })
  })

  it('blocks surfaced parent ranges that exceed the direct raw-fetch budget', () => {
    expect(
      evaluateFetchSourceRangeRequest({
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
                preview: 'A large parent range.',
              },
              childRanges: [],
            },
          ],
        }),
        budgetState: createAgenticTranscriptRecallBudgetState(),
        request: {
          rangeId: 'P1',
          reason: 'Need the exact final fight location.',
        },
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'parent_range_requires_expansion',
      message:
        'requested transcript range id refers to a surfaced parent range and must be expanded into a smaller child range before raw fetch',
    })
  })

  it('blocks when the total message budget would be exceeded', () => {
    expect(
      evaluateFetchSourceRangeRequest({
        runtimeConfig: {
          ...enabledRuntimeConfig,
          maxTotalMessages: 12,
        },
        sourceMap: buildSourceMap({
          directFetchRanges: [
            {
              kind: 'fact',
              label: null,
              rangeId: 'R7',
              startSeq: 7,
              endSeq: 12,
              preview: 'Promise reminder',
            },
          ],
        }),
        budgetState: {
          toolCallsUsed: 0,
          totalMessagesFetched: 8,
        },
        request: {
          rangeId: 'R7',
          reason: 'Need the exact promise.',
        },
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'max_total_messages_exceeded',
      message: 'requested transcript range exceeds the total per-request message budget',
    })
  })

  it('blocks when the tool-call budget is already exhausted', () => {
    expect(
      evaluateFetchSourceRangeRequest({
        runtimeConfig: enabledRuntimeConfig,
        sourceMap: buildSourceMap({
          directFetchRanges: [
            {
              kind: 'fact',
              label: null,
              rangeId: 'R11',
              startSeq: 11,
              endSeq: 12,
              preview: 'Two-message recall',
            },
          ],
        }),
        budgetState: {
          toolCallsUsed: 1,
          totalMessagesFetched: 2,
        },
        request: {
          rangeId: 'R11',
          reason: 'Need the exact line.',
        },
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'max_tool_calls_exceeded',
      message: 'transcript recall tool-call budget has already been used',
    })
  })

  it('blocks malformed range ids before budget or availability checks', () => {
    expect(
      evaluateFetchSourceRangeRequest({
        runtimeConfig: enabledRuntimeConfig,
        sourceMap: buildSourceMap(),
        budgetState: createAgenticTranscriptRecallBudgetState(),
        request: {
          rangeId: 'not-a-range',
          reason: 'Malformed id.',
        },
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'invalid_range_id',
      message:
        'requested transcript range id must be a valid direct-fetch or child-range id such as `R1`',
    })
  })
})

describe('validateFetchedSourceRange', () => {
  it('accepts exact fetched counts and blocks truncated ranges', () => {
    expect(
      validateFetchedSourceRange({
        requestedStartSeq: 1,
        requestedEndSeq: 3,
        fetchedMessageCount: 3,
      }),
    ).toBeNull()

    expect(
      validateFetchedSourceRange({
        requestedStartSeq: 1,
        requestedEndSeq: 3,
        fetchedMessageCount: 2,
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'range_not_in_chat',
      message: 'requested transcript range could not be resolved from the current chat transcript',
    })
  })
})
