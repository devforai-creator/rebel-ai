import { describe, expect, it } from 'vitest'

import {
  classifyAgenticTranscriptRecallSurfacedRangeAccess,
  getAgenticTranscriptRecallMaxDirectFetchMessages,
  getAgenticTranscriptRecallRangeMessageCount,
} from './range-access'

describe('range-access', () => {
  it('counts inclusive transcript ranges', () => {
    expect(
      getAgenticTranscriptRecallRangeMessageCount({
        startSeq: 11,
        endSeq: 20,
      }),
    ).toBe(10)
  })

  it('uses the tighter raw-fetch budget between per-call and per-request caps', () => {
    expect(
      getAgenticTranscriptRecallMaxDirectFetchMessages({
        maxMessagesPerCall: 12,
        maxTotalMessages: 8,
      }),
    ).toBe(8)
  })

  it('classifies small surfaced ranges as direct fetches and oversized ones as navigation parents', () => {
    expect(
      classifyAgenticTranscriptRecallSurfacedRangeAccess({
        hint: {
          startSeq: 1,
          endSeq: 10,
        },
        cutoffOrdinal: 12,
        runtimeConfig: {
          maxMessagesPerCall: 12,
          maxTotalMessages: 12,
        },
      }),
    ).toBe('direct_fetch')

    expect(
      classifyAgenticTranscriptRecallSurfacedRangeAccess({
        hint: {
          startSeq: 1,
          endSeq: 100,
        },
        cutoffOrdinal: 100,
        runtimeConfig: {
          maxMessagesPerCall: 12,
          maxTotalMessages: 12,
        },
      }),
    ).toBe('navigation_parent')
  })

  it('treats surfaced ranges that overlap the current raw context as navigation parents', () => {
    expect(
      classifyAgenticTranscriptRecallSurfacedRangeAccess({
        hint: {
          startSeq: 11,
          endSeq: 22,
        },
        cutoffOrdinal: 20,
        runtimeConfig: {
          maxMessagesPerCall: 12,
          maxTotalMessages: 12,
        },
      }),
    ).toBe('navigation_parent')
  })
})
