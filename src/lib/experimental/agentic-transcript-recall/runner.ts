import { stepCountIs, streamText, tool } from 'ai'
import type { TurnClient } from '@/lib/chat/turn-types'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import { createAgenticTranscriptRecallBudgetState } from './policy'
import type { AgenticTranscriptRecallSourceHints } from './source-hints'
import {
  executeFetchSourceRange,
  FETCH_SOURCE_RANGE_TOOL_NAME,
  fetchSourceRangeToolInputSchema,
} from './tool'

type ExperimentalStreamRequest = {
  system?: string
  messages: unknown[]
  providerOptions?: unknown
}

type StreamTextInvocation = Parameters<typeof streamText>[0]
type ExperimentalAgenticTranscriptRecallStreamSettings = Pick<
  StreamTextInvocation,
  'tools' | 'stopWhen' | 'onStepFinish'
>

type ExperimentalAgenticTranscriptRecallWrapperResult<TStreamRequest> = {
  streamRequest: TStreamRequest
  streamTextSettings?: ExperimentalAgenticTranscriptRecallStreamSettings
}

function buildExperimentalInstruction({ maxToolCalls }: { maxToolCalls: number }): string {
  return [
    '=== Experimental Transcript Recall ===',
    'You may optionally call `fetch_source_range` if the exact wording of older summarized context is necessary for your next reply.',
    'Only request a range that exactly matches a summary or fact range already surfaced in the prompt, such as `[1-10]`.',
    'Do not use this tool for recent raw messages that are already visible in the conversation context.',
    `You may use this tool at most ${maxToolCalls} time for this reply. If the summaries and facts are sufficient, answer without calling the tool.`,
  ].join('\n')
}

export function prepareExperimentalAgenticTranscriptRecallRequest<
  TStreamRequest extends ExperimentalStreamRequest,
>({
  supabase,
  chatId,
  runtimeConfig,
  sourceHints,
  streamRequest,
  debugMetrics,
  logDebug = () => undefined,
}: {
  supabase: TurnClient
  chatId: string
  runtimeConfig: AgenticTranscriptRecallRuntimeConfig
  sourceHints: AgenticTranscriptRecallSourceHints | null
  streamRequest: TStreamRequest
  debugMetrics: Record<string, string | number | boolean | null>
  logDebug?: (...args: unknown[]) => void
}): ExperimentalAgenticTranscriptRecallWrapperResult<TStreamRequest> {
  logDebug('[Agentic Transcript Recall] Experimental wrapper active')

  debugMetrics['experimental_agentic_transcript_recall_tool_available'] = false
  debugMetrics['experimental_agentic_transcript_recall_tool_call_count'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_fetch_count'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_total_messages_fetched'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_last_start_seq'] = null
  debugMetrics['experimental_agentic_transcript_recall_tool_last_end_seq'] = null
  debugMetrics['experimental_agentic_transcript_recall_tool_last_reason'] = null
  debugMetrics['experimental_agentic_transcript_recall_tool_last_block_reason'] = null
  debugMetrics['experimental_agentic_transcript_recall_step_count'] = 0

  if (!sourceHints || sourceHints.hints.length === 0) {
    return {
      streamRequest,
    }
  }

  let budgetState = createAgenticTranscriptRecallBudgetState()
  const augmentedSystem = [streamRequest.system, buildExperimentalInstruction(runtimeConfig)]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n')

  const wrappedStreamRequest: TStreamRequest = {
    ...streamRequest,
    system: augmentedSystem,
  }

  const streamTextSettings: ExperimentalAgenticTranscriptRecallStreamSettings = {
    tools: {
      [FETCH_SOURCE_RANGE_TOOL_NAME]: tool({
        description:
          'Fetch the raw transcript messages for one older summary or fact range when exact wording matters for the current reply.',
        inputSchema: fetchSourceRangeToolInputSchema,
        async execute(input) {
          debugMetrics['experimental_agentic_transcript_recall_tool_call_count'] =
            Number(debugMetrics['experimental_agentic_transcript_recall_tool_call_count'] ?? 0) + 1
          debugMetrics['experimental_agentic_transcript_recall_tool_last_start_seq'] =
            input.startSeq
          debugMetrics['experimental_agentic_transcript_recall_tool_last_end_seq'] = input.endSeq
          debugMetrics['experimental_agentic_transcript_recall_tool_last_reason'] = input.reason
          debugMetrics['experimental_agentic_transcript_recall_tool_last_block_reason'] = null

          try {
            const executionResult = await executeFetchSourceRange({
              supabase,
              chatId,
              runtimeConfig,
              sourceHints,
              budgetState,
              input,
            })

            budgetState = executionResult.budgetState

            if (executionResult.result.status === 'fetched') {
              debugMetrics['experimental_agentic_transcript_recall_tool_fetch_count'] =
                Number(
                  debugMetrics['experimental_agentic_transcript_recall_tool_fetch_count'] ?? 0,
                ) + 1
              debugMetrics['experimental_agentic_transcript_recall_tool_total_messages_fetched'] =
                Number(
                  debugMetrics[
                    'experimental_agentic_transcript_recall_tool_total_messages_fetched'
                  ] ?? 0,
                ) + executionResult.result.messageCount

              logDebug('[Agentic Transcript Recall] Fetched transcript source range', {
                chatId,
                startSeq: executionResult.result.startSeq,
                endSeq: executionResult.result.endSeq,
                messageCount: executionResult.result.messageCount,
              })
            } else {
              debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] =
                Number(
                  debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] ?? 0,
                ) + 1
              debugMetrics['experimental_agentic_transcript_recall_tool_last_block_reason'] =
                executionResult.result.blockReason

              logDebug('[Agentic Transcript Recall] Blocked transcript source range request', {
                chatId,
                startSeq: executionResult.result.startSeq,
                endSeq: executionResult.result.endSeq,
                blockReason: executionResult.result.blockReason,
              })
            }

            return executionResult.result
          } catch (error) {
            debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] =
              Number(debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] ?? 0) +
              1
            debugMetrics['experimental_agentic_transcript_recall_tool_last_block_reason'] =
              'tool_execution_failed'

            logDebug('[Agentic Transcript Recall] Tool execution failed', {
              chatId,
              startSeq: input.startSeq,
              endSeq: input.endSeq,
              error: error instanceof Error ? error.message : String(error),
            })

            return {
              status: 'blocked',
              blockReason: 'tool_execution_failed',
              message: 'transcript recall tool execution failed and was blocked for this request',
              startSeq: input.startSeq,
              endSeq: input.endSeq,
              reason: input.reason,
            }
          }
        },
      }),
    },
    stopWhen: stepCountIs(runtimeConfig.maxToolCalls + 1),
    onStepFinish(stepResult) {
      debugMetrics['experimental_agentic_transcript_recall_step_count'] =
        Number(debugMetrics['experimental_agentic_transcript_recall_step_count'] ?? 0) + 1
      debugMetrics['experimental_agentic_transcript_recall_tool_available'] = true

      logDebug('[Agentic Transcript Recall] Step finished', {
        chatId,
        finishReason: stepResult.finishReason,
        stepToolCalls: stepResult.toolCalls.length,
        stepToolResults: stepResult.toolResults.length,
      })
    },
  }

  debugMetrics['experimental_agentic_transcript_recall_tool_available'] = true

  return {
    streamRequest: wrappedStreamRequest,
    streamTextSettings,
  }
}
