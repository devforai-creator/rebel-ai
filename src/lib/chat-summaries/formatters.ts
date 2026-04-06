import type { ChatSummary } from '@/types/database.types'
import type { MessageTranscriptRow, FactRow } from './types'
import {
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
  TOKEN_ESTIMATE_DIVISOR,
  FALLBACK_SUMMARY_CHAR_LIMIT,
  FALLBACK_RECENT_MESSAGES,
} from './config'

/**
 * Format summary segments for inclusion in system prompt
 */
export function formatSummarySegments(
  summaries: Array<Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>>,
): string[] {
  return summaries.map((summary) => {
    let label = 'Summary'
    if (summary.level === SUMMARY_LEVEL_META) {
      label = 'Meta Summary'
    } else if (summary.level === SUMMARY_LEVEL_SUPER_META) {
      label = 'Super Meta Summary'
    }
    return `[${label} ${summary.start_seq}-${summary.end_seq}]\n${summary.summary.trim()}`
  })
}

/**
 * Format facts for inclusion in system prompt
 */
export function formatFacts(facts: FactRow[]): string {
  return facts
    .map((fact) => `[${fact.start_seq}-${fact.end_seq}]\n${fact.facts.trim()}`)
    .join('\n\n')
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

/**
 * Estimate token count from text length
 */
export function estimateTokenCount(text: string): number {
  if (!text) {
    return 0
  }
  return Math.ceil(text.length / TOKEN_ESTIMATE_DIVISOR)
}

/**
 * Build fallback summary from chunk messages when LLM fails
 */
export function buildChunkFallbackSummary(messages: MessageTranscriptRow[]): string {
  const highlights = messages.slice(-FALLBACK_RECENT_MESSAGES).map((msg) => {
    const speaker = msg.role === 'user' ? 'User' : 'AI'
    return `${speaker}: ${truncateText(msg.content, 140)}`
  })

  const summary = `Summary failed – recent conversation highlights:\n- ${highlights.join('\n- ')}`
  return truncateText(summary, FALLBACK_SUMMARY_CHAR_LIMIT)
}

/**
 * Build fallback summary from higher-level chunks when LLM fails
 */
export function buildHigherLevelFallbackSummary(
  chunks: Array<Pick<ChatSummary, 'start_seq' | 'end_seq' | 'summary'>>,
): string {
  const lines = chunks.map((chunk) => {
    const range = `${chunk.start_seq}-${chunk.end_seq}`
    return `[${range}] ${truncateText(chunk.summary, 160)}`
  })

  const summary = `Summary failed – please refer to original summaries:\n${lines.join('\n')}`
  return truncateText(summary, FALLBACK_SUMMARY_CHAR_LIMIT)
}

/**
 * Calculate chunk boundaries for summary generation
 */
export function calculateChunkBoundaries(
  totalMessages: number,
  previousEnd: number,
  chunkSize: number = 10,
): Array<{ start: number; end: number }> {
  const latestChunkEnd = totalMessages - chunkSize

  if (latestChunkEnd < chunkSize || latestChunkEnd <= previousEnd) {
    return []
  }

  const boundaries: Array<{ start: number; end: number }> = []
  let nextChunkEnd = Math.max(previousEnd + chunkSize, chunkSize)

  while (nextChunkEnd <= latestChunkEnd) {
    const start = nextChunkEnd - chunkSize + 1
    const end = nextChunkEnd
    boundaries.push({ start, end })
    nextChunkEnd += chunkSize
  }

  return boundaries
}

/**
 * Check if chunks are sequential (no gaps)
 */
export function areChunksSequential(chunks: Pick<ChatSummary, 'start_seq' | 'end_seq'>[]): boolean {
  for (let index = 1; index < chunks.length; index += 1) {
    const prev = chunks[index - 1]
    const current = chunks[index]
    if (current.start_seq !== prev.end_seq + 1) {
      return false
    }
  }
  return true
}

/**
 * Generate range key for deduplication
 */
export function rangeKey(range: { startSeq: number; endSeq: number }): string {
  return `${range.startSeq}-${range.endSeq}`
}
