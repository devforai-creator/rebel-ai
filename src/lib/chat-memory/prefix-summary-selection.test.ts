import { describe, expect, it } from 'vitest'
import { SUMMARY_LEVEL_CHUNK, SUMMARY_LEVEL_META } from '@/lib/chat-summaries/config'
import { selectPrefixPromptSummaries } from './prefix-summary-selection'

function createSummary(id: string, level: number, startSeq: number, endSeq: number) {
  return {
    id,
    level,
    start_seq: startSeq,
    end_seq: endSeq,
    summary: `${id} summary`,
  }
}

describe('selectPrefixPromptSummaries', () => {
  it('rolls over the older meta range while keeping the current range as chunks', () => {
    const oldChunks = Array.from({ length: 10 }, (_, index) =>
      createSummary(`old-chunk-${index + 1}`, SUMMARY_LEVEL_CHUNK, index * 10 + 1, index * 10 + 10),
    )
    const currentChunks = Array.from({ length: 10 }, (_, index) =>
      createSummary(
        `current-chunk-${index + 1}`,
        SUMMARY_LEVEL_CHUNK,
        index * 10 + 101,
        index * 10 + 110,
      ),
    )
    const liveRangeChunks = Array.from({ length: 3 }, (_, index) =>
      createSummary(
        `live-range-chunk-${index + 1}`,
        SUMMARY_LEVEL_CHUNK,
        index * 10 + 201,
        index * 10 + 210,
      ),
    )

    const selected = selectPrefixPromptSummaries(
      [
        createSummary('meta-1', SUMMARY_LEVEL_META, 1, 100),
        createSummary('meta-2', SUMMARY_LEVEL_META, 101, 200),
        ...oldChunks,
        ...currentChunks,
        ...liveRangeChunks,
      ],
      200,
    )

    expect(selected.map((summary) => summary.id)).toEqual([
      'meta-1',
      ...currentChunks.map((summary) => summary.id),
    ])
  })
})
