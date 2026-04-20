import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import type { AgenticTranscriptRecallSourceHints } from './source-hints'

export type FetchSourceRangeRequest = {
  startSeq: number
  endSeq: number
  reason: string
}

export type AgenticTranscriptRecallBudgetState = {
  toolCallsUsed: number
  totalMessagesFetched: number
}

export type AgenticTranscriptRecallFetchBlockedReason =
  | 'feature_disabled'
  | 'provider_not_allowed'
  | 'source_hints_unavailable'
  | 'invalid_range'
  | 'range_not_allowed'
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

function hasExactAllowedRange(
  sourceHints: AgenticTranscriptRecallSourceHints,
  startSeq: number,
  endSeq: number,
): boolean {
  return sourceHints.hints.some((hint) => hint.startSeq === startSeq && hint.endSeq === endSeq)
}

export function evaluateFetchSourceRangeRequest({
  runtimeConfig,
  sourceHints,
  budgetState,
  request,
}: {
  runtimeConfig: AgenticTranscriptRecallRuntimeConfig
  sourceHints: AgenticTranscriptRecallSourceHints | null
  budgetState: AgenticTranscriptRecallBudgetState
  request: FetchSourceRangeRequest
}): AgenticTranscriptRecallFetchPolicyResult {
  if (!runtimeConfig.enabled) {
    return block('feature_disabled', 'experimental transcript recall is disabled for this request')
  }

  if (!runtimeConfig.providerAllowed || !runtimeConfig.providerSupported) {
    return block('provider_not_allowed', 'transcript recall is not allowed for this provider')
  }

  if (!sourceHints) {
    return block(
      'source_hints_unavailable',
      'no bounded transcript source ranges are available for recall',
    )
  }

  const { startSeq, endSeq } = request
  if (
    !Number.isInteger(startSeq) ||
    !Number.isInteger(endSeq) ||
    startSeq < 1 ||
    endSeq < startSeq
  ) {
    return block(
      'invalid_range',
      'requested transcript range must be a valid 1-based inclusive span',
    )
  }

  if (!hasExactAllowedRange(sourceHints, startSeq, endSeq)) {
    return block(
      'range_not_allowed',
      'requested transcript range must exactly match one of the surfaced summary or fact ranges',
    )
  }

  if (budgetState.toolCallsUsed >= runtimeConfig.maxToolCalls) {
    return block(
      'max_tool_calls_exceeded',
      'transcript recall tool-call budget has already been used',
    )
  }

  const expectedMessageCount = endSeq - startSeq + 1
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
      startSeq,
      endSeq,
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
