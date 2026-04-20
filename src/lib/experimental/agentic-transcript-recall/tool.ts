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
export const fetchSourceRangeToolInputSchema = z
  .object({
    startSeq: z.number().int().min(1),
    endSeq: z.number().int().min(1),
    reason: z.string().trim().min(1).max(400),
  })
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

  const projectedMessages = await loadProjectedConversationRange({
    supabase,
    chatId,
    startOrdinal: policyResult.requestedRange.startSeq,
    endOrdinal: policyResult.requestedRange.endSeq,
  })

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
      budgetState,
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
