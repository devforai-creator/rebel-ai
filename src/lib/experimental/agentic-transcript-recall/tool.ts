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
import type { AgenticTranscriptRecallSourceMap } from './source-map'

export const FETCH_SOURCE_RANGE_TOOL_NAME = 'fetch_source_range'
export const FETCH_SOURCE_RANGE_TOOL_DESCRIPTION = [
  'Fetch the raw transcript messages for one older summary range, fact range, or expanded child range when exact wording or exact sequencing matters for the current reply.',
  'Use this only after you already know the exact bounded range you want to inspect. That range must exactly match either a directly fetchable surfaced range such as `[1-10]` or one child range returned by `expand_source_range`.',
  'Do not guess or invent new subranges, and do not merge adjacent child ranges into a larger fetch. For example, if expansion returned `281-290` and `291-300`, you must fetch only one of those exact child ranges at a time.',
  'Use fetched transcript lines as the raw evidence for your answer. If you still cannot verify the detail after one fetch, either fetch one adjacent child range if budget remains or say that you could not fully verify the transcript.',
].join(' ')
export const fetchSourceRangeToolInputSchema = z
  .object({
    startSeq: z
      .number()
      .int()
      .min(1)
      .describe(
        'The exact inclusive start sequence number of one directly fetchable surfaced range or one child range returned by `expand_source_range`.',
      ),
    endSeq: z
      .number()
      .int()
      .min(1)
      .describe(
        'The exact inclusive end sequence number of the same directly fetchable range. It must match one allowed range exactly.',
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
    'Fetch one exact bounded transcript range as raw evidence for an older detail question.',
  )
  .refine((value) => value.endSeq >= value.startSeq, {
    message: 'endSeq must be greater than or equal to startSeq',
    path: ['endSeq'],
  })

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
  startSeq: number | null
  endSeq: number | null
  reason: string | null
}

export type FetchSourceRangeToolFetchedResult = {
  status: 'fetched'
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
}: {
  blockReason: AgenticTranscriptRecallFetchBlockedReason
  message: string
  input: Partial<FetchSourceRangeToolInput> | null
}): FetchSourceRangeToolBlockedResult {
  return {
    status: 'blocked',
    blockReason,
    message,
    startSeq: typeof input?.startSeq === 'number' ? input.startSeq : null,
    endSeq: typeof input?.endSeq === 'number' ? input.endSeq : null,
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
      flattened.fieldErrors.startSeq?.[0] ??
      flattened.fieldErrors.endSeq?.[0] ??
      flattened.fieldErrors.reason?.[0] ??
      flattened.formErrors[0] ??
      'tool input did not match the expected schema'

    return {
      result: toBlockedResult({
        blockReason: 'invalid_range',
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
      }),
      budgetState: toolCallConsumedBudgetState,
    }
  }

  return {
    result: {
      status: 'fetched',
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
