import type { ChatSummary } from '@/types/database.types'
import {
  CHUNK_SIZE,
  META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
} from '@/lib/chat-summaries/config'
import { filterRedundantChunks } from '@/lib/chat-summaries/context-builder'

export type PrefixSummarySelectionRow = Pick<
  ChatSummary,
  'level' | 'start_seq' | 'end_seq' | 'summary'
>

export function selectPrefixPromptSummaries<T extends PrefixSummarySelectionRow>(
  summaries: T[],
  visibleSummaryEnd: number,
): T[] {
  if (visibleSummaryEnd <= 0) {
    return []
  }

  const eligibleSummaries = summaries.filter((summary) => summary.end_seq <= visibleSummaryEnd)
  const metaRolloverCutoff = visibleSummaryEnd - META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES
  const chunkRangeKeys = new Set(
    eligibleSummaries
      .filter((summary) => summary.level === SUMMARY_LEVEL_CHUNK)
      .map((summary) => `${summary.start_seq}-${summary.end_seq}`),
  )

  return filterRedundantChunks(
    eligibleSummaries.filter((summary) => {
      if (summary.level === SUMMARY_LEVEL_SUPER_META) {
        return false
      }

      if (summary.level !== SUMMARY_LEVEL_META) {
        return true
      }

      const summarySpan = summary.end_seq - summary.start_seq + 1
      const hasChunkCoverage = Array.from(
        { length: Math.ceil(summarySpan / CHUNK_SIZE) },
        (_, index) => {
          const start = summary.start_seq + index * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE - 1, summary.end_seq)
          return chunkRangeKeys.has(`${start}-${end}`)
        },
      ).every(Boolean)

      if (!hasChunkCoverage) {
        return true
      }

      return (
        summarySpan < META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES ||
        summary.end_seq <= metaRolloverCutoff
      )
    }),
  )
}
