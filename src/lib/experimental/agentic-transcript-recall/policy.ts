import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import type { AgenticTranscriptRecallSourceMap } from './source-map'
import {
  findAgenticTranscriptRecallDirectFetchRangeById,
  findAgenticTranscriptRecallNavigationParentEntryById,
  isAgenticTranscriptRecallParentId,
  isAgenticTranscriptRecallRangeId,
} from './source-map'

export type FetchSourceRangeRequest = {
  rangeId: string
  reason: string
}

export type AgenticTranscriptRecallBudgetState = {
  toolCallsUsed: number
  totalMessagesFetched: number
}

export type AgenticTranscriptRecallFetchBlockedReason =
  | 'feature_disabled'
  | 'provider_not_allowed'
  | 'source_map_unavailable'
  | 'invalid_range_id'
  | 'range_id_not_available'
  | 'parent_range_requires_expansion'
  | 'max_tool_calls_exceeded'
  | 'max_messages_per_call_exceeded'
  | 'max_total_messages_exceeded'
  | 'range_not_in_chat'
  | 'tool_execution_failed'

type AgenticTranscriptRecallFetchBlocked = {
  status: 'blocked'
  blockReason: AgenticTranscriptRecallFetchBlockedReason
  message: string
}

type AgenticTranscriptRecallFetchAllowed = {
  status: 'allowed'
  requestedRange: {
    startSeq: number
    endSeq: number
  }
  expectedMessageCount: number
  nextBudgetState: AgenticTranscriptRecallBudgetState
}

export type AgenticTranscriptRecallFetchPolicyResult =
  | AgenticTranscriptRecallFetchBlocked
  | AgenticTranscriptRecallFetchAllowed

export function createAgenticTranscriptRecallBudgetState(): AgenticTranscriptRecallBudgetState {
  return {
    toolCallsUsed: 0,
    totalMessagesFetched: 0,
  }
}

function block(
  blockReason: AgenticTranscriptRecallFetchBlockedReason,
  message: string,
): AgenticTranscriptRecallFetchBlocked {
  return {
    status: 'blocked',
    blockReason,
    message,
  }
}

function findExactAllowedRange(
  sourceMap: AgenticTranscriptRecallSourceMap,
  rangeId: string,
): AgenticTranscriptRecallSourceMap['directFetchRanges'][number] | null {
  if (!isAgenticTranscriptRecallRangeId(rangeId)) {
    return null
  }

  return findAgenticTranscriptRecallDirectFetchRangeById(sourceMap, rangeId)
}

export function evaluateFetchSourceRangeRequest({
  runtimeConfig,
  sourceMap,
  budgetState,
  request,
}: {
  runtimeConfig: AgenticTranscriptRecallRuntimeConfig
  sourceMap: AgenticTranscriptRecallSourceMap | null
  budgetState: AgenticTranscriptRecallBudgetState
  request: FetchSourceRangeRequest
}): AgenticTranscriptRecallFetchPolicyResult {
  if (!runtimeConfig.enabled) {
    return block('feature_disabled', 'experimental transcript recall is disabled for this request')
  }

  if (!runtimeConfig.providerAllowed || !runtimeConfig.providerSupported) {
    return block('provider_not_allowed', 'transcript recall is not allowed for this provider')
  }

  if (!sourceMap) {
    return block(
      'source_map_unavailable',
      'no bounded transcript source ranges are available for recall',
    )
  }

  const { rangeId } = request
  if (!isAgenticTranscriptRecallRangeId(rangeId)) {
    if (
      isAgenticTranscriptRecallParentId(rangeId) &&
      findAgenticTranscriptRecallNavigationParentEntryById(sourceMap, rangeId)
    ) {
      return block(
        'parent_range_requires_expansion',
        'requested transcript range id refers to a surfaced parent range and must be expanded into a smaller child range before raw fetch',
      )
    }

    return block(
      'invalid_range_id',
      'requested transcript range id must be a valid direct-fetch or child-range id such as `R1`',
    )
  }

  const exactAllowedRange = findExactAllowedRange(sourceMap, rangeId)
  if (!exactAllowedRange) {
    return block(
      'range_id_not_available',
      'requested transcript range id must match one directly fetchable surfaced range or expanded child range available to this reply',
    )
  }

  if (budgetState.toolCallsUsed >= runtimeConfig.maxToolCalls) {
    return block(
      'max_tool_calls_exceeded',
      'transcript recall tool-call budget has already been used',
    )
  }

  const expectedMessageCount = exactAllowedRange.endSeq - exactAllowedRange.startSeq + 1
  if (expectedMessageCount > runtimeConfig.maxMessagesPerCall) {
    return block(
      'max_messages_per_call_exceeded',
      'requested transcript range exceeds the per-call message budget',
    )
  }

  if (budgetState.totalMessagesFetched + expectedMessageCount > runtimeConfig.maxTotalMessages) {
    return block(
      'max_total_messages_exceeded',
      'requested transcript range exceeds the total per-request message budget',
    )
  }

  return {
    status: 'allowed',
    requestedRange: {
      startSeq: exactAllowedRange.startSeq,
      endSeq: exactAllowedRange.endSeq,
    },
    expectedMessageCount,
    nextBudgetState: {
      toolCallsUsed: budgetState.toolCallsUsed + 1,
      totalMessagesFetched: budgetState.totalMessagesFetched + expectedMessageCount,
    },
  }
}

export function validateFetchedSourceRange({
  requestedStartSeq,
  requestedEndSeq,
  fetchedMessageCount,
}: {
  requestedStartSeq: number
  requestedEndSeq: number
  fetchedMessageCount: number
}): AgenticTranscriptRecallFetchBlocked | null {
  const expectedMessageCount = requestedEndSeq - requestedStartSeq + 1

  if (fetchedMessageCount !== expectedMessageCount) {
    return block(
      'range_not_in_chat',
      'requested transcript range could not be resolved from the current chat transcript',
    )
  }

  return null
}
