import type { ChatSummary } from '@/types/database.types'

/**
 * Filters out summaries that are fully covered by higher-level summaries.
 * Higher level (meta → super meta) entries take precedence over lower levels.
 */
export function filterRedundantChunks<
  T extends Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>,
>(summaries: T[]): T[] {
  if (summaries.length === 0) {
    return summaries
  }

  const sortedByPriority = summaries.slice().sort((a, b) => {
    if (a.level === b.level) {
      return a.start_seq - b.start_seq
    }
    return b.level - a.level
  })

  const retained: T[] = []
  const coverage: Array<{ start: number; end: number; level: number }> = []

  for (const summary of sortedByPriority) {
    const isCovered = coverage.some(
      (range) =>
        range.level > summary.level &&
        summary.start_seq >= range.start &&
        summary.end_seq <= range.end,
    )

    if (!isCovered) {
      retained.push(summary)
      coverage.push({
        start: summary.start_seq,
        end: summary.end_seq,
        level: summary.level,
      })
    }
  }

  return retained.sort((a, b) => a.start_seq - b.start_seq)
}
