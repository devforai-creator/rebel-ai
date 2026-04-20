import type { TurnClient } from '@/lib/chat/turn-types'
import { SUMMARY_LEVEL_META, SUMMARY_LEVEL_SUPER_META } from '@/lib/chat-summaries/config'
import type { ChatFacts, ChatSummary } from '@/types/database.types'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import {
  classifyAgenticTranscriptRecallSurfacedRangeAccess,
  type AgenticTranscriptRecallSurfacedRangeAccess,
} from './range-access'
import type {
  AgenticTranscriptRecallSourceHint,
  AgenticTranscriptRecallSourceHints,
  AgenticTranscriptRecallSummaryHintLabel,
} from './source-hints'

type SummaryChildRow = Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>
type FactChildRow = Pick<ChatFacts, 'start_seq' | 'end_seq' | 'facts'>

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

function mapSummaryLevelToLabel(level: number): AgenticTranscriptRecallSummaryHintLabel {
  if (level === SUMMARY_LEVEL_META) {
    return 'meta_summary'
  }

  if (level === SUMMARY_LEVEL_SUPER_META) {
    return 'super_meta_summary'
  }

  return 'summary'
}

function toSummaryHint(row: SummaryChildRow): AgenticTranscriptRecallSourceHint {
  return {
    kind: 'summary',
    label: mapSummaryLevelToLabel(row.level),
    startSeq: row.start_seq,
    endSeq: row.end_seq,
    preview: row.summary.trim(),
  }
}

function toFactHint(row: FactChildRow): AgenticTranscriptRecallSourceHint {
  return {
    kind: 'fact',
    label: null,
    startSeq: row.start_seq,
    endSeq: row.end_seq,
    preview: row.facts.trim(),
  }
}

function isRangeInsideAnyParentRange({
  hint,
  parents,
}: {
  hint: Pick<AgenticTranscriptRecallSourceHint, 'startSeq' | 'endSeq'>
  parents: AgenticTranscriptRecallSourceHint[]
}): boolean {
  return parents.some((parent) => hint.startSeq >= parent.startSeq && hint.endSeq <= parent.endSeq)
}

function buildSourceMapFromRanges({
  sourceHints,
  runtimeConfig,
  discoveredDirectFetchHints = [],
}: {
  sourceHints: AgenticTranscriptRecallSourceHints
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >
  discoveredDirectFetchHints?: AgenticTranscriptRecallSourceHint[]
}): AgenticTranscriptRecallSourceMap {
  const { directFetchRanges: surfacedDirectFetchRanges, navigationParents } = buildAccessBuckets({
    sourceHints,
    runtimeConfig,
  })

  const directFetchRanges = dedupeRangesByKey({
    hints: [...surfacedDirectFetchRanges, ...discoveredDirectFetchHints],
    chooseRepresentative: chooseDirectFetchRepresentative,
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

async function loadDiscoveredDirectFetchHints({
  supabase,
  chatId,
  sourceHints,
  runtimeConfig,
  navigationParents,
}: {
  supabase: TurnClient
  chatId: string
  sourceHints: AgenticTranscriptRecallSourceHints
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >
  navigationParents: AgenticTranscriptRecallSourceHint[]
}): Promise<AgenticTranscriptRecallSourceHint[]> {
  if (navigationParents.length === 0) {
    return []
  }

  const minParentStartSeq = Math.min(...navigationParents.map((parent) => parent.startSeq))
  const maxParentEndSeq = Math.min(
    sourceHints.cutoffOrdinal,
    Math.max(...navigationParents.map((parent) => parent.endSeq)),
  )

  if (maxParentEndSeq < minParentStartSeq) {
    return []
  }

  const [{ data: summaries, error: summaryError }, { data: facts, error: factsError }] =
    await Promise.all([
      supabase
        .from('chat_summaries')
        .select<'level, start_seq, end_seq, summary'>('level, start_seq, end_seq, summary')
        .eq('chat_id', chatId)
        .gte('start_seq', minParentStartSeq)
        .lte('end_seq', maxParentEndSeq)
        .order('start_seq', { ascending: true }),
      supabase
        .from('chat_facts')
        .select<'start_seq, end_seq, facts'>('start_seq, end_seq, facts')
        .eq('chat_id', chatId)
        .gte('start_seq', minParentStartSeq)
        .lte('end_seq', maxParentEndSeq)
        .order('start_seq', { ascending: true }),
    ])

  if (summaryError) {
    throw new Error(`Failed to load transcript recall child summaries: ${summaryError.message}`)
  }

  if (factsError) {
    throw new Error(`Failed to load transcript recall child facts: ${factsError.message}`)
  }

  const candidateHints = [
    ...((summaries ?? []) as SummaryChildRow[]).map(toSummaryHint),
    ...((facts ?? []) as FactChildRow[]).map(toFactHint),
  ].filter((hint) => {
    if (
      classifyAgenticTranscriptRecallSurfacedRangeAccess({
        hint,
        cutoffOrdinal: sourceHints.cutoffOrdinal,
        runtimeConfig,
      }) !== 'direct_fetch'
    ) {
      return false
    }

    return isRangeInsideAnyParentRange({
      hint,
      parents: navigationParents,
    })
  })

  return dedupeRangesByKey({
    hints: candidateHints,
    chooseRepresentative: chooseDirectFetchRepresentative,
  })
}

export function deriveAgenticTranscriptRecallSourceMap({
  sourceHints,
  runtimeConfig,
  discoveredDirectFetchHints = [],
}: {
  sourceHints: AgenticTranscriptRecallSourceHints
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >
  discoveredDirectFetchHints?: AgenticTranscriptRecallSourceHint[]
}): AgenticTranscriptRecallSourceMap {
  return buildSourceMapFromRanges({
    sourceHints,
    runtimeConfig,
    discoveredDirectFetchHints,
  })
}

export async function loadAgenticTranscriptRecallSourceMap({
  supabase,
  chatId,
  sourceHints,
  runtimeConfig,
}: {
  supabase: TurnClient
  chatId: string
  sourceHints: AgenticTranscriptRecallSourceHints
  runtimeConfig: Pick<
    AgenticTranscriptRecallRuntimeConfig,
    'maxMessagesPerCall' | 'maxTotalMessages'
  >
}): Promise<AgenticTranscriptRecallSourceMap> {
  const surfacedSourceMap = buildSourceMapFromRanges({
    sourceHints,
    runtimeConfig,
  })

  if (surfacedSourceMap.navigationParents.length === 0) {
    return surfacedSourceMap
  }

  const discoveredDirectFetchHints = await loadDiscoveredDirectFetchHints({
    supabase,
    chatId,
    sourceHints,
    runtimeConfig,
    navigationParents: surfacedSourceMap.navigationParents.map((entry) => entry.parentRange),
  })

  return buildSourceMapFromRanges({
    sourceHints,
    runtimeConfig,
    discoveredDirectFetchHints,
  })
}
