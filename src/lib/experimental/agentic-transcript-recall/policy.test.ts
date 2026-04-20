import { describe, expect, it } from 'vitest'

import {
  createAgenticTranscriptRecallBudgetState,
  evaluateFetchSourceRangeRequest,
  validateFetchedSourceRange,
} from './policy'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'

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

describe('evaluateFetchSourceRangeRequest', () => {
  it('allows an exact surfaced range and advances the budget state', () => {
    expect(
      evaluateFetchSourceRangeRequest({
        runtimeConfig: enabledRuntimeConfig,
        sourceHints: {
          rawContextStartOrdinal: 21,
          cutoffOrdinal: 20,
          hints: [
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 1,
              endSeq: 10,
              preview: 'Older context',
            },
          ],
        },
        budgetState: createAgenticTranscriptRecallBudgetState(),
        request: {
          startSeq: 1,
          endSeq: 10,
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
        sourceHints: {
          rawContextStartOrdinal: 21,
          cutoffOrdinal: 20,
          hints: [
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 1,
              endSeq: 10,
              preview: 'Older context',
            },
          ],
        },
        budgetState: createAgenticTranscriptRecallBudgetState(),
        request: {
          startSeq: 2,
          endSeq: 5,
          reason: 'Need the middle part only.',
        },
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'range_not_allowed',
      message:
        'requested transcript range must exactly match one of the surfaced summary or fact ranges',
    })
  })

  it('blocks when the total message budget would be exceeded', () => {
    expect(
      evaluateFetchSourceRangeRequest({
        runtimeConfig: {
          ...enabledRuntimeConfig,
          maxTotalMessages: 12,
        },
        sourceHints: {
          rawContextStartOrdinal: 21,
          cutoffOrdinal: 20,
          hints: [
            {
              kind: 'fact',
              label: null,
              startSeq: 7,
              endSeq: 12,
              preview: 'Promise reminder',
            },
          ],
        },
        budgetState: {
          toolCallsUsed: 0,
          totalMessagesFetched: 8,
        },
        request: {
          startSeq: 7,
          endSeq: 12,
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
        sourceHints: {
          rawContextStartOrdinal: 21,
          cutoffOrdinal: 20,
          hints: [
            {
              kind: 'fact',
              label: null,
              startSeq: 11,
              endSeq: 12,
              preview: 'Two-message recall',
            },
          ],
        },
        budgetState: {
          toolCallsUsed: 1,
          totalMessagesFetched: 2,
        },
        request: {
          startSeq: 11,
          endSeq: 12,
          reason: 'Need the exact line.',
        },
      }),
    ).toEqual({
      status: 'blocked',
      blockReason: 'max_tool_calls_exceeded',
      message: 'transcript recall tool-call budget has already been used',
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
