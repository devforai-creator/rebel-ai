import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import type { AgenticTranscriptRecallSourceHint } from './source-hints'

export type AgenticTranscriptRecallSurfacedRangeAccess = 'direct_fetch' | 'navigation_parent'

export function getAgenticTranscriptRecallRangeMessageCount({
  startSeq,
  endSeq,
}: {
  startSeq: number
  endSeq: number
}): number {
  return endSeq - startSeq + 1
}

export function getAgenticTranscriptRecallMaxDirectFetchMessages(
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >,
): number {
  return Math.min(runtimeConfig.maxMessagesPerCall, runtimeConfig.maxTotalMessages)
}

export function classifyAgenticTranscriptRecallSurfacedRangeAccess({
  hint,
  cutoffOrdinal,
  runtimeConfig,
}: {
  hint: Pick<AgenticTranscriptRecallSourceHint, 'startSeq' | 'endSeq'>
  cutoffOrdinal: number
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >
}): AgenticTranscriptRecallSurfacedRangeAccess {
  const messageCount = getAgenticTranscriptRecallRangeMessageCount(hint)
  const maxDirectFetchMessages = getAgenticTranscriptRecallMaxDirectFetchMessages(runtimeConfig)

  return hint.endSeq <= cutoffOrdinal && messageCount <= maxDirectFetchMessages
    ? 'direct_fetch'
    : 'navigation_parent'
}
