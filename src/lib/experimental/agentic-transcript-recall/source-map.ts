import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import {
  classifyAgenticTranscriptRecallSurfacedRangeAccess,
  type AgenticTranscriptRecallSurfacedRangeAccess,
} from './range-access'
import type {
  AgenticTranscriptRecallSourceHint,
  AgenticTranscriptRecallSourceHints,
} from './source-hints'

export type AgenticTranscriptRecallDirectFetchRange = AgenticTranscriptRecallSourceHint

export type AgenticTranscriptRecallNavigationParentEntry = {
  parentRange: AgenticTranscriptRecallSourceHint
  childRanges: AgenticTranscriptRecallDirectFetchRange[]
}

export type AgenticTranscriptRecallSourceMap = {
  rawContextStartOrdinal: number
  cutoffOrdinal: number
  directFetchRanges: AgenticTranscriptRecallDirectFetchRange[]
  navigationParents: AgenticTranscriptRecallNavigationParentEntry[]
}

export function findAgenticTranscriptRecallDirectFetchRange(
  sourceMap: AgenticTranscriptRecallSourceMap,
  startSeq: number,
  endSeq: number,
): AgenticTranscriptRecallDirectFetchRange | null {
  return (
    sourceMap.directFetchRanges.find(
      (range) => range.startSeq === startSeq && range.endSeq === endSeq,
    ) ?? null
  )
}

export function findAgenticTranscriptRecallNavigationParentEntry(
  sourceMap: AgenticTranscriptRecallSourceMap,
  startSeq: number,
  endSeq: number,
): AgenticTranscriptRecallNavigationParentEntry | null {
  return (
    sourceMap.navigationParents.find(
      (entry) => entry.parentRange.startSeq === startSeq && entry.parentRange.endSeq === endSeq,
    ) ?? null
  )
}

function getHintSortOrder(hint: AgenticTranscriptRecallSourceHint): number {
  if (hint.kind === 'fact') {
    return 0
  }

  if (hint.label === 'summary') {
    return 1
  }

  if (hint.label === 'meta_summary') {
    return 2
  }

  return 3
}

function compareHints(
  left: Pick<AgenticTranscriptRecallSourceHint, 'startSeq' | 'endSeq' | 'kind' | 'label'>,
  right: Pick<AgenticTranscriptRecallSourceHint, 'startSeq' | 'endSeq' | 'kind' | 'label'>,
): number {
  if (left.startSeq !== right.startSeq) {
    return left.startSeq - right.startSeq
  }

  if (left.endSeq !== right.endSeq) {
    return left.endSeq - right.endSeq
  }

  return (
    getHintSortOrder(left as AgenticTranscriptRecallSourceHint) -
    getHintSortOrder(right as AgenticTranscriptRecallSourceHint)
  )
}

function buildRangeKey(
  hint: Pick<AgenticTranscriptRecallSourceHint, 'startSeq' | 'endSeq'>,
): string {
  return `${hint.startSeq}-${hint.endSeq}`
}

function chooseDirectFetchRepresentative(
  current: AgenticTranscriptRecallSourceHint,
  candidate: AgenticTranscriptRecallSourceHint,
): AgenticTranscriptRecallSourceHint {
  return compareHints(candidate, current) < 0 ? candidate : current
}

function chooseNavigationParentRepresentative(
  current: AgenticTranscriptRecallSourceHint,
  candidate: AgenticTranscriptRecallSourceHint,
): AgenticTranscriptRecallSourceHint {
  const currentSummaryWeight = current.kind === 'summary' ? 0 : 1
  const candidateSummaryWeight = candidate.kind === 'summary' ? 0 : 1

  if (candidateSummaryWeight !== currentSummaryWeight) {
    return candidateSummaryWeight < currentSummaryWeight ? candidate : current
  }

  return compareHints(candidate, current) < 0 ? candidate : current
}

function dedupeRangesByKey({
  hints,
  chooseRepresentative,
}: {
  hints: AgenticTranscriptRecallSourceHint[]
  chooseRepresentative: (
    current: AgenticTranscriptRecallSourceHint,
    candidate: AgenticTranscriptRecallSourceHint,
  ) => AgenticTranscriptRecallSourceHint
}): AgenticTranscriptRecallSourceHint[] {
  const dedupe = new Map<string, AgenticTranscriptRecallSourceHint>()

  for (const hint of hints) {
    const key = buildRangeKey(hint)
    const current = dedupe.get(key)
    dedupe.set(key, current ? chooseRepresentative(current, hint) : hint)
  }

  return [...dedupe.values()].sort(compareHints)
}

function buildAccessBuckets({
  sourceHints,
  runtimeConfig,
}: {
  sourceHints: AgenticTranscriptRecallSourceHints
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >
}): {
  directFetchRanges: AgenticTranscriptRecallDirectFetchRange[]
  navigationParents: AgenticTranscriptRecallSourceHint[]
} {
  const byAccess = new Map<
    AgenticTranscriptRecallSurfacedRangeAccess,
    AgenticTranscriptRecallSourceHint[]
  >([
    ['direct_fetch', []],
    ['navigation_parent', []],
  ])

  for (const hint of sourceHints.hints) {
    const access = classifyAgenticTranscriptRecallSurfacedRangeAccess({
      hint,
      cutoffOrdinal: sourceHints.cutoffOrdinal,
      runtimeConfig,
    })
    byAccess.get(access)?.push(hint)
  }

  return {
    directFetchRanges: dedupeRangesByKey({
      hints: byAccess.get('direct_fetch') ?? [],
      chooseRepresentative: chooseDirectFetchRepresentative,
    }),
    navigationParents: dedupeRangesByKey({
      hints: byAccess.get('navigation_parent') ?? [],
      chooseRepresentative: chooseNavigationParentRepresentative,
    }),
  }
}

export function deriveAgenticTranscriptRecallSourceMap({
  sourceHints,
  runtimeConfig,
}: {
  sourceHints: AgenticTranscriptRecallSourceHints
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >
}): AgenticTranscriptRecallSourceMap {
  const { directFetchRanges, navigationParents } = buildAccessBuckets({
    sourceHints,
    runtimeConfig,
  })

  return {
    rawContextStartOrdinal: sourceHints.rawContextStartOrdinal,
    cutoffOrdinal: sourceHints.cutoffOrdinal,
    directFetchRanges,
    navigationParents: navigationParents.map((parentRange) => ({
      parentRange,
      childRanges: directFetchRanges.filter(
        (childRange) =>
          childRange.startSeq >= parentRange.startSeq &&
          childRange.endSeq <= parentRange.endSeq &&
          (childRange.startSeq !== parentRange.startSeq ||
            childRange.endSeq !== parentRange.endSeq),
      ),
    })),
  }
}
