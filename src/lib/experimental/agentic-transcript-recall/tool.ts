import { z } from 'zod'
import { loadProjectedConversationRange } from '@/lib/chat/turns'
import type { TurnClient } from '@/lib/chat/turn-types'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import {
  evaluateFetchSourceRangeRequest,
  validateFetchedSourceRange,
  type AgenticTranscriptRecallBudgetState,
  type AgenticTranscriptRecallFetchBlockedReason,
} from './policy'
import type {
  AgenticTranscriptRecallDirectFetchRange,
  AgenticTranscriptRecallSourceMap,
} from './source-map'

export const FETCH_SOURCE_RANGE_TOOL_NAME = 'fetch_source_range'
export const FETCH_SOURCE_RANGE_TOOL_DESCRIPTION = [
  'Fetch the raw transcript messages for one older summary range, fact range, or expanded child range when the next reply depends on older source detail that summaries may have compressed away.',
  'This is most useful for exact wording, exact sequence, promises or agreements, plans or boundaries, relationship-turning moments, contradiction checks, or a specific older scene that would materially change the reply if remembered incorrectly.',
  'Use this only after you already know which bounded surfaced range you want to inspect. Pass the exact `rangeId` of one directly fetchable surfaced range or one child range returned by `expand_source_range`.',
  'Do not invent new ids or infer hidden subranges. If expansion returned child ids such as `R3` and `R4`, fetch only one exact child id at a time.',
  'Prefer summaries when broad continuity is enough. Use fetched transcript lines as the raw evidence for your answer. If you still cannot verify the detail after one fetch, either fetch one adjacent child range if budget remains or say that you could not fully verify the transcript.',
].join(' ')
export const fetchSourceRangeToolInputSchema = z
  .object({
    rangeId: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .describe(
        'The request-local id of one directly fetchable surfaced range or one child range returned by `expand_source_range`, such as `R1`.',
      ),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe(
        'A short explanation of what exact older detail you are trying to verify from the raw transcript, such as `Need the exact final fight location.`',
      ),
  })
  .describe(
    'Fetch one exact bounded transcript range by id as raw evidence for an older detail question.',
  )

export type FetchSourceRangeToolInput = z.infer<typeof fetchSourceRangeToolInputSchema>

export type FetchSourceRangeToolMessage = {
  seq: number
  role: 'user' | 'assistant'
  content: string
}

export type FetchSourceRangeToolBlockedResult = {
  status: 'blocked'
  blockReason: AgenticTranscriptRecallFetchBlockedReason
  message: string
  rangeId: string | null
  startSeq: number | null
  endSeq: number | null
  reason: string | null
}

export type FetchSourceRangeToolFetchedResult = {
  status: 'fetched'
  rangeId: string
  startSeq: number
  endSeq: number
  reason: string
  messageCount: number
  messages: FetchSourceRangeToolMessage[]
}

export type FetchSourceRangeToolResult =
  | FetchSourceRangeToolBlockedResult
  | FetchSourceRangeToolFetchedResult

export type ExecuteFetchSourceRangeResult = {
  result: FetchSourceRangeToolResult
  budgetState: AgenticTranscriptRecallBudgetState
}

function toBlockedResult({
  blockReason,
  message,
  input,
  resolvedRange = null,
}: {
  blockReason: AgenticTranscriptRecallFetchBlockedReason
  message: string
  input: Partial<FetchSourceRangeToolInput> | null
  resolvedRange?: Pick<AgenticTranscriptRecallDirectFetchRange, 'startSeq' | 'endSeq'> | null
}): FetchSourceRangeToolBlockedResult {
  return {
    status: 'blocked',
    blockReason,
    message,
    rangeId: typeof input?.rangeId === 'string' ? input.rangeId : null,
    startSeq: resolvedRange?.startSeq ?? null,
    endSeq: resolvedRange?.endSeq ?? null,
    reason: typeof input?.reason === 'string' ? input.reason : null,
  }
}

export async function executeFetchSourceRange({
  supabase,
  chatId,
  runtimeConfig,
  sourceMap,
  budgetState,
  input,
}: {
  supabase: TurnClient
  chatId: string
  runtimeConfig: AgenticTranscriptRecallRuntimeConfig
  sourceMap: AgenticTranscriptRecallSourceMap | null
  budgetState: AgenticTranscriptRecallBudgetState
  input: unknown
}): Promise<ExecuteFetchSourceRangeResult> {
  const parsedInput = fetchSourceRangeToolInputSchema.safeParse(input)
  if (!parsedInput.success) {
    const flattened = parsedInput.error.flatten()
    const fieldMessage =
      flattened.fieldErrors.rangeId?.[0] ??
      flattened.fieldErrors.reason?.[0] ??
      flattened.formErrors[0] ??
      'tool input did not match the expected schema'

    return {
      result: toBlockedResult({
        blockReason: 'invalid_range_id',
        message: fieldMessage,
        input:
          input && typeof input === 'object' ? (input as Partial<FetchSourceRangeToolInput>) : null,
      }),
      budgetState,
    }
  }

  const request = parsedInput.data
  const policyResult = evaluateFetchSourceRangeRequest({
    runtimeConfig,
    sourceMap,
    budgetState,
    request,
  })

  if (policyResult.status === 'blocked') {
    return {
      result: toBlockedResult({
        blockReason: policyResult.blockReason,
        message: policyResult.message,
        input: request,
      }),
      budgetState,
    }
  }

  const toolCallConsumedBudgetState: AgenticTranscriptRecallBudgetState = {
    toolCallsUsed: policyResult.nextBudgetState.toolCallsUsed,
    totalMessagesFetched: budgetState.totalMessagesFetched,
  }

  let projectedMessages: Awaited<ReturnType<typeof loadProjectedConversationRange>>
  try {
    projectedMessages = await loadProjectedConversationRange({
      supabase,
      chatId,
      startOrdinal: policyResult.requestedRange.startSeq,
      endOrdinal: policyResult.requestedRange.endSeq,
    })
  } catch {
    return {
      result: toBlockedResult({
        blockReason: 'tool_execution_failed',
        message: 'transcript recall tool execution failed and was blocked for this request',
        input: request,
        resolvedRange: policyResult.requestedRange,
      }),
      budgetState: toolCallConsumedBudgetState,
    }
  }

  const fetchedRangeValidation = validateFetchedSourceRange({
    requestedStartSeq: policyResult.requestedRange.startSeq,
    requestedEndSeq: policyResult.requestedRange.endSeq,
    fetchedMessageCount: projectedMessages.length,
  })

  if (fetchedRangeValidation) {
    return {
      result: toBlockedResult({
        blockReason: fetchedRangeValidation.blockReason,
        message: fetchedRangeValidation.message,
        input: request,
        resolvedRange: policyResult.requestedRange,
      }),
      budgetState: toolCallConsumedBudgetState,
    }
  }

  return {
    result: {
      status: 'fetched',
      rangeId: request.rangeId,
      startSeq: policyResult.requestedRange.startSeq,
      endSeq: policyResult.requestedRange.endSeq,
      reason: request.reason,
      messageCount: projectedMessages.length,
      messages: projectedMessages.map((message, index) => ({
        seq: policyResult.requestedRange.startSeq + index,
        role: message.role,
        content: message.content,
      })),
    },
    budgetState: policyResult.nextBudgetState,
  }
}
