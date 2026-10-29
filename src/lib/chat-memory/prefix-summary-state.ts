import { SUMMARY_LEVEL_CHUNK, SUMMARY_LEVEL_META } from '@/lib/chat-summaries/config'
import {
  selectPrefixPromptSummaries,
  type PrefixSummarySelectionRow,
} from './prefix-summary-selection'

// Prompt rollover is independent of the shared 10-message chunks and 100-message metas.
export const PREFIX_ROLLOVER_MESSAGES = 50

export type PrefixSummaryState<T extends PrefixSummarySelectionRow = PrefixSummarySelectionRow> = {
  lastChunkEnd: number
  visibleSummaryEnd: number
  summaries: T[]
}

export function resolvePrefixSummaryState<T extends PrefixSummarySelectionRow>(
  rows: T[],
  sealedThroughSeq = Infinity,
): PrefixSummaryState<T> {
  const eligibleRows = rows.filter(
    (row) =>
      (row.level === SUMMARY_LEVEL_CHUNK || row.level === SUMMARY_LEVEL_META) &&
      row.end_seq <= sealedThroughSeq &&
      row.summary.trim().length > 0,
  )
  const orderedRanges = eligibleRows
    .slice()
    .sort((a, b) => a.start_seq - b.start_seq || b.end_seq - a.end_seq)

  let coveredThroughSeq = 0
  for (const range of orderedRanges) {
    if (range.start_seq > coveredThroughSeq + 1) break
    coveredThroughSeq = Math.max(coveredThroughSeq, range.end_seq)
  }

  let lastChunkEnd = 0
  let lastMetaEnd = 0
  for (const row of eligibleRows) {
    if (row.level === SUMMARY_LEVEL_CHUNK) {
      lastChunkEnd = Math.max(lastChunkEnd, row.end_seq)
    } else if (row.end_seq <= coveredThroughSeq) {
      lastMetaEnd = Math.max(lastMetaEnd, row.end_seq)
    }
  }

  // Existing metas also provide coverage when their original chunks are unavailable.
  const visibleSummaryEnd = Math.max(
    lastMetaEnd,
    Math.floor(coveredThroughSeq / PREFIX_ROLLOVER_MESSAGES) * PREFIX_ROLLOVER_MESSAGES,
  )

  return {
    lastChunkEnd,
    visibleSummaryEnd,
    summaries: selectPrefixPromptSummaries(eligibleRows, visibleSummaryEnd),
  }
}
