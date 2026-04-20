import type { MemoryPromptBlock } from '@/lib/chat-memory'

export type AgenticTranscriptRecallSourceHintKind = 'summary' | 'fact'
export type AgenticTranscriptRecallSummaryHintLabel =
  | 'summary'
  | 'meta_summary'
  | 'super_meta_summary'

export type AgenticTranscriptRecallSourceHint = {
  kind: AgenticTranscriptRecallSourceHintKind
  label: AgenticTranscriptRecallSummaryHintLabel | null
  startSeq: number
  endSeq: number
  preview: string
}

export type AgenticTranscriptRecallSourceHints = {
  rawContextStartOrdinal: number
  cutoffOrdinal: number
  hints: AgenticTranscriptRecallSourceHint[]
}

type PendingHint = {
  kind: AgenticTranscriptRecallSourceHintKind
  label: AgenticTranscriptRecallSummaryHintLabel | null
  startSeq: number
  endSeq: number
  previewLines: string[]
}

const SUMMARY_HEADER_PATTERN = /^\[(Summary|Meta Summary|Super Meta Summary)\s+(\d+)-(\d+)\]$/i
const FACT_HEADER_PATTERN = /^\[(\d+)-(\d+)\]$/

function mapSummaryLabel(raw: string): AgenticTranscriptRecallSummaryHintLabel {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'meta summary') {
    return 'meta_summary'
  }
  if (normalized === 'super meta summary') {
    return 'super_meta_summary'
  }

  return 'summary'
}

function finalizeHint(
  pending: PendingHint | null,
  cutoffOrdinal: number,
  dedupe: Map<string, AgenticTranscriptRecallSourceHint>,
): void {
  if (!pending || pending.startSeq > cutoffOrdinal) {
    return
  }

  const key = `${pending.kind}:${pending.startSeq}-${pending.endSeq}`
  if (dedupe.has(key)) {
    return
  }

  dedupe.set(key, {
    kind: pending.kind,
    label: pending.label,
    startSeq: pending.startSeq,
    endSeq: pending.endSeq,
    preview: pending.previewLines.join(' ').trim(),
  })
}

export function deriveAgenticTranscriptRecallSourceHints({
  promptBlocks,
  rawContextStartOrdinal,
}: {
  promptBlocks: MemoryPromptBlock[]
  rawContextStartOrdinal: number
}): AgenticTranscriptRecallSourceHints {
  const cutoffOrdinal = Math.max(0, rawContextStartOrdinal - 1)
  const dedupe = new Map<string, AgenticTranscriptRecallSourceHint>()

  for (const block of promptBlocks) {
    if (block.role !== 'system' || block.stability !== 'sealed') {
      continue
    }

    const lines = block.content.split('\n')
    let pending: PendingHint | null = null

    for (const line of lines) {
      const trimmed = line.trim()

      if (!trimmed) {
        continue
      }

      if (trimmed.startsWith('===')) {
        finalizeHint(pending, cutoffOrdinal, dedupe)
        pending = null
        continue
      }

      const summaryMatch = trimmed.match(SUMMARY_HEADER_PATTERN)
      if (summaryMatch) {
        finalizeHint(pending, cutoffOrdinal, dedupe)
        pending = {
          kind: 'summary',
          label: mapSummaryLabel(summaryMatch[1]),
          startSeq: Number(summaryMatch[2]),
          endSeq: Number(summaryMatch[3]),
          previewLines: [],
        }
        continue
      }

      const factMatch = trimmed.match(FACT_HEADER_PATTERN)
      if (factMatch) {
        finalizeHint(pending, cutoffOrdinal, dedupe)
        pending = {
          kind: 'fact',
          label: null,
          startSeq: Number(factMatch[1]),
          endSeq: Number(factMatch[2]),
          previewLines: [],
        }
        continue
      }

      if (pending) {
        pending.previewLines.push(trimmed)
      }
    }

    finalizeHint(pending, cutoffOrdinal, dedupe)
  }

  return {
    rawContextStartOrdinal,
    cutoffOrdinal,
    hints: [...dedupe.values()].sort((left, right) => {
      if (left.startSeq === right.startSeq) {
        if (left.endSeq === right.endSeq) {
          return left.kind.localeCompare(right.kind)
        }
        return left.endSeq - right.endSeq
      }
      return left.startSeq - right.startSeq
    }),
  }
}
