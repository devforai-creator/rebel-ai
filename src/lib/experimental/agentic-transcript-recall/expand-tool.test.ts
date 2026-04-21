import { describe, expect, it } from 'vitest'

import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import {
  createAgenticTranscriptRecallExpandBudgetState,
  executeExpandSourceRange,
} from './expand-tool'

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

describe('executeExpandSourceRange', () => {
  it('returns bounded child ranges for a surfaced navigation parent', async () => {
    const result = await executeExpandSourceRange({
      runtimeConfig: enabledRuntimeConfig,
      sourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Chunk 1',
          },
          {
            kind: 'fact',
            label: null,
            startSeq: 11,
            endSeq: 20,
            preview: 'Chunk 2',
          },
        ],
        navigationParents: [
          {
            parentRange: {
              kind: 'summary',
              label: 'meta_summary',
              startSeq: 1,
              endSeq: 20,
              preview: 'Meta parent',
            },
            childRanges: [
              {
                kind: 'summary',
                label: 'summary',
                startSeq: 1,
                endSeq: 10,
                preview: 'Chunk 1',
              },
              {
                kind: 'fact',
                label: null,
                startSeq: 11,
                endSeq: 20,
                preview: 'Chunk 2',
              },
            ],
          },
        ],
      },
      budgetState: createAgenticTranscriptRecallExpandBudgetState(),
      input: {
        parentStartSeq: 1,
        parentEndSeq: 20,
        reason: 'Need the final scene details.',
      },
    })

    expect(result).toEqual({
      result: {
        status: 'expanded',
        parentStartSeq: 1,
        parentEndSeq: 20,
        reason: 'Need the final scene details.',
        childRangeCount: 2,
        childRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Chunk 1',
          },
          {
            kind: 'fact',
            label: null,
            startSeq: 11,
            endSeq: 20,
            preview: 'Chunk 2',
          },
        ],
      },
      budgetState: {
        expandCallsUsed: 1,
      },
    })
  })

  it('blocks direct-fetch ranges and unavailable parent ranges without mutating the budget state', async () => {
    const directRangeResult = await executeExpandSourceRange({
      runtimeConfig: enabledRuntimeConfig,
      sourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Chunk 1',
          },
        ],
        navigationParents: [],
      },
      budgetState: createAgenticTranscriptRecallExpandBudgetState(),
      input: {
        parentStartSeq: 1,
        parentEndSeq: 10,
        reason: 'Wrong tool for a direct range.',
      },
    })

    expect(directRangeResult).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'parent_range_not_expandable',
        message:
          'requested parent range is already directly fetchable; call fetch_source_range instead',
        parentStartSeq: 1,
        parentEndSeq: 10,
        reason: 'Wrong tool for a direct range.',
      },
      budgetState: {
        expandCallsUsed: 0,
      },
    })

    const unavailableParentResult = await executeExpandSourceRange({
      runtimeConfig: enabledRuntimeConfig,
      sourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [],
        navigationParents: [],
      },
      budgetState: createAgenticTranscriptRecallExpandBudgetState(),
      input: {
        parentStartSeq: 1,
        parentEndSeq: 20,
        reason: 'Nothing surfaced this range.',
      },
    })

    expect(unavailableParentResult).toEqual({
      result: {
        status: 'blocked',
        blockReason: 'parent_range_not_available',
        message:
          'requested parent range must exactly match one surfaced navigation range available to this reply',
        parentStartSeq: 1,
        parentEndSeq: 20,
        reason: 'Nothing surfaced this range.',
      },
      budgetState: {
        expandCallsUsed: 0,
      },
    })
  })
})
