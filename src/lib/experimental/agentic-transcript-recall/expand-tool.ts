import { z } from 'zod'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import {
  findAgenticTranscriptRecallDirectFetchRange,
  findAgenticTranscriptRecallNavigationParentEntry,
  type AgenticTranscriptRecallSourceMap,
} from './source-map'

const MAX_EXPAND_SOURCE_RANGE_CALLS = 1

export const EXPAND_SOURCE_RANGE_TOOL_NAME = 'expand_source_range'
export const EXPAND_SOURCE_RANGE_TOOL_DESCRIPTION = [
  'Expand one surfaced navigation parent range into smaller child ranges that are legal raw transcript fetch targets for this reply.',
  'Use this when the answer likely depends on an older scene, turning point, promise, or other specific historical detail, but you do not yet know which bounded child range should be fetched as raw evidence.',
  'Call this only with the exact start and end sequence numbers of one surfaced navigation parent range. Do not call it for recent raw context, directly fetchable small ranges, or invented subranges such as `210-220` unless those exact child ranges were already returned by this tool.',
  'The result is a list of bounded child ranges. Expansion narrows the search space, but it is not raw evidence by itself. If exact older detail still matters after expansion, fetch at most one exact child range at a time with `fetch_source_range`.',
].join(' ')
export const expandSourceRangeToolInputSchema = z
  .object({
    parentStartSeq: z
      .number()
      .int()
      .min(1)
      .describe(
        'The exact inclusive start sequence number of one surfaced navigation parent range, such as `201` from `[Meta Summary 201-300]`.',
      ),
    parentEndSeq: z
      .number()
      .int()
      .min(1)
      .describe(
        'The exact inclusive end sequence number of the same surfaced navigation parent range, such as `300` from `[Meta Summary 201-300]`.',
      ),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe(
        'A short explanation of what exact older detail you are trying to verify, such as `Need the final fight location.`',
      ),
  })
  .describe(
    'Expand one surfaced parent transcript range into smaller child ranges that can later be fetched exactly.',
  )
  .refine((value) => value.parentEndSeq >= value.parentStartSeq, {
    message: 'parentEndSeq must be greater than or equal to parentStartSeq',
    path: ['parentEndSeq'],
  })

export type ExpandSourceRangeToolInput = z.infer<typeof expandSourceRangeToolInputSchema>

export type AgenticTranscriptRecallExpandBudgetState = {
  expandCallsUsed: number
}

export type AgenticTranscriptRecallExpandBlockedReason =
  | 'feature_disabled'
  | 'provider_not_allowed'
  | 'source_map_unavailable'
  | 'invalid_parent_range'
  | 'max_expand_calls_exceeded'
  | 'parent_range_not_available'
  | 'parent_range_not_expandable'

export type ExpandSourceRangeToolBlockedResult = {
  status: 'blocked'
  blockReason: AgenticTranscriptRecallExpandBlockedReason
  message: string
  parentStartSeq: number | null
  parentEndSeq: number | null
  reason: string | null
}

export type ExpandSourceRangeToolExpandedResult = {
  status: 'expanded'
  parentStartSeq: number
  parentEndSeq: number
  reason: string
  childRangeCount: number
  childRanges: AgenticTranscriptRecallSourceMap['directFetchRanges']
}

export type ExpandSourceRangeToolResult =
  | ExpandSourceRangeToolBlockedResult
  | ExpandSourceRangeToolExpandedResult

export type ExecuteExpandSourceRangeResult = {
  result: ExpandSourceRangeToolResult
  budgetState: AgenticTranscriptRecallExpandBudgetState
}

export function createAgenticTranscriptRecallExpandBudgetState(): AgenticTranscriptRecallExpandBudgetState {
  return {
    expandCallsUsed: 0,
  }
}

function toBlockedResult({
  blockReason,
  message,
  input,
}: {
  blockReason: AgenticTranscriptRecallExpandBlockedReason
  message: string
  input: Partial<ExpandSourceRangeToolInput> | null
}): ExpandSourceRangeToolBlockedResult {
  return {
    status: 'blocked',
    blockReason,
    message,
    parentStartSeq: typeof input?.parentStartSeq === 'number' ? input.parentStartSeq : null,
    parentEndSeq: typeof input?.parentEndSeq === 'number' ? input.parentEndSeq : null,
    reason: typeof input?.reason === 'string' ? input.reason : null,
  }
}

export async function executeExpandSourceRange({
  runtimeConfig,
  sourceMap,
  budgetState,
  input,
}: {
  runtimeConfig: AgenticTranscriptRecallRuntimeConfig
  sourceMap: AgenticTranscriptRecallSourceMap | null
  budgetState: AgenticTranscriptRecallExpandBudgetState
  input: unknown
}): Promise<ExecuteExpandSourceRangeResult> {
  const parsedInput = expandSourceRangeToolInputSchema.safeParse(input)
  if (!parsedInput.success) {
    const flattened = parsedInput.error.flatten()
    const fieldMessage =
      flattened.fieldErrors.parentStartSeq?.[0] ??
      flattened.fieldErrors.parentEndSeq?.[0] ??
      flattened.fieldErrors.reason?.[0] ??
      flattened.formErrors[0] ??
      'tool input did not match the expected schema'

    return {
      result: toBlockedResult({
        blockReason: 'invalid_parent_range',
        message: fieldMessage,
        input:
          input && typeof input === 'object'
            ? (input as Partial<ExpandSourceRangeToolInput>)
            : null,
      }),
      budgetState,
    }
  }

  const request = parsedInput.data

  if (!runtimeConfig.enabled) {
    return {
      result: toBlockedResult({
        blockReason: 'feature_disabled',
        message: 'experimental transcript recall is disabled for this request',
        input: request,
      }),
      budgetState,
    }
  }

  if (!runtimeConfig.providerAllowed || !runtimeConfig.providerSupported) {
    return {
      result: toBlockedResult({
        blockReason: 'provider_not_allowed',
        message: 'transcript recall is not allowed for this provider',
        input: request,
      }),
      budgetState,
    }
  }

  if (!sourceMap) {
    return {
      result: toBlockedResult({
        blockReason: 'source_map_unavailable',
        message: 'no bounded transcript source map is available for recall',
        input: request,
      }),
      budgetState,
    }
  }

  if (budgetState.expandCallsUsed >= MAX_EXPAND_SOURCE_RANGE_CALLS) {
    return {
      result: toBlockedResult({
        blockReason: 'max_expand_calls_exceeded',
        message: 'transcript recall parent expansion has already been used for this request',
        input: request,
      }),
      budgetState,
    }
  }

  const directFetchRange = findAgenticTranscriptRecallDirectFetchRange(
    sourceMap,
    request.parentStartSeq,
    request.parentEndSeq,
  )
  if (directFetchRange) {
    return {
      result: toBlockedResult({
        blockReason: 'parent_range_not_expandable',
        message:
          'requested parent range is already directly fetchable; call fetch_source_range instead',
        input: request,
      }),
      budgetState,
    }
  }

  const parentEntry = findAgenticTranscriptRecallNavigationParentEntry(
    sourceMap,
    request.parentStartSeq,
    request.parentEndSeq,
  )
  if (!parentEntry) {
    return {
      result: toBlockedResult({
        blockReason: 'parent_range_not_available',
        message:
          'requested parent range must exactly match one surfaced navigation range available to this reply',
        input: request,
      }),
      budgetState,
    }
  }

  return {
    result: {
      status: 'expanded',
      parentStartSeq: request.parentStartSeq,
      parentEndSeq: request.parentEndSeq,
      reason: request.reason,
      childRangeCount: parentEntry.childRanges.length,
      childRanges: parentEntry.childRanges,
    },
    budgetState: {
      expandCallsUsed: budgetState.expandCallsUsed + 1,
    },
  }
}
