import type { SummaryEntry } from './hooks/useChatSummariesState'

export type SummaryStructureNode = {
  summary: SummaryEntry
  children: SummaryEntry[]
}

export type SummaryStructure = {
  metaNodes: SummaryStructureNode[]
  looseChunks: SummaryEntry[]
}

export function buildSummaryStructure(summaries: SummaryEntry[]): SummaryStructure {
  const metaSummaries = summaries.filter((summary) => summary.level === 1)
  const chunkSummaries = summaries.filter((summary) => summary.level === 0)

  const metaNodes: SummaryStructureNode[] = metaSummaries.map((summary) => ({
    summary,
    children: [],
  }))

  const looseChunks: SummaryEntry[] = []

  for (const chunk of chunkSummaries) {
    const containingMetaNode = metaNodes.find(
      (metaNode) =>
        chunk.start_seq >= metaNode.summary.start_seq && chunk.end_seq <= metaNode.summary.end_seq,
    )

    if (containingMetaNode) {
      containingMetaNode.children.push(chunk)
    } else {
      looseChunks.push(chunk)
    }
  }

  return {
    metaNodes,
    looseChunks,
  }
}
