import { stepCountIs, streamText, tool } from 'ai'
import type { TurnClient } from '@/lib/chat/turn-types'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import {
  createAgenticTranscriptRecallExpandBudgetState,
  executeExpandSourceRange,
  EXPAND_SOURCE_RANGE_TOOL_DESCRIPTION,
  EXPAND_SOURCE_RANGE_TOOL_NAME,
  expandSourceRangeToolInputSchema,
} from './expand-tool'
import { createAgenticTranscriptRecallBudgetState } from './policy'
import type { AgenticTranscriptRecallSourceMap } from './source-map'
import type { AgenticTranscriptRecallSourceHints } from './source-hints'
import {
  executeFetchSourceRange,
  FETCH_SOURCE_RANGE_TOOL_DESCRIPTION,
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
  'toolChoice' | 'tools' | 'stopWhen' | 'onStepFinish' | 'prepareStep'
>

type ExperimentalAgenticTranscriptRecallWrapperResult<TStreamRequest> = {
  streamRequest: TStreamRequest
  streamTextSettings?: ExperimentalAgenticTranscriptRecallStreamSettings
}

function buildExperimentalInstruction({
  maxToolCalls,
  fetchAvailable,
  expandAvailable,
}: {
  maxToolCalls: number
  fetchAvailable: boolean
  expandAvailable: boolean
}): string {
  const instructions = [
    '=== Experimental Transcript Recall ===',
    'Use summaries and recent raw context by default.',
    'Use transcript recall when the next reply likely depends on older conversation detail that is not already visible, summaries may not be specific enough, and getting that detail wrong would materially change the reply.',
    'Think in terms of three checks: oldness, exactness, and materiality.',
    'Common recall-friendly cases include first or last occurrence, exact wording or exact sequence, promises or agreements, plans or boundaries, relationship-changing moments, contradiction checks against earlier dialogue, and vague references to a specific older scene or incident.',
    '=== Recall Priority ===',
  ]

  if (expandAvailable) {
    instructions.push(
      'Use `expand_source_range` when the likely evidence sits inside a surfaced older parent range such as `[Meta Summary 1-100]` but the right child range is still unclear.',
    )
  }

  if (fetchAvailable && expandAvailable) {
    instructions.push(
      'After expansion, call `fetch_source_range` if one smaller child range is needed to verify the next reply.',
    )
  }

  if (fetchAvailable) {
    instructions.push(
      expandAvailable
        ? 'Only call `fetch_source_range` for a directly surfaced small range such as `[1-10]`, or for a bounded child range returned by `expand_source_range`.'
        : 'Only call `fetch_source_range` for a directly surfaced small range such as `[1-10]` that is available for this reply.',
      'Use `fetch_source_range` when exact older source detail matters more than broad continuity, especially for wording, sequence, promises, boundaries, turning points, or contradiction checks.',
      'Do not use this tool for recent raw messages that are already visible in the conversation context.',
      'Use fetched transcript lines as the raw evidence for exact wording, exact sequencing, and concrete older scene detail.',
      maxToolCalls > 1
        ? `You may call \`fetch_source_range\` at most ${maxToolCalls} time for this reply. If one fetched child range is still insufficient and budget remains, fetch one adjacent child range before answering.`
        : 'You may call `fetch_source_range` at most 1 time for this reply. If one fetched child range is still insufficient, say that you could not fully verify the raw transcript.',
      'If broad continuity is enough, answer from summaries instead of using transcript recall.',
    )
  } else {
    instructions.push(
      'No `fetch_source_range` tool is available for this reply. Do not claim exact wording, exact sequence, or other unverified specifics from summaries or expansion previews alone.',
    )
  }

  if (expandAvailable) {
    instructions.push(
      'Do not treat `expand_source_range` output as raw evidence. Expansion only narrows the search space; fetched transcript lines are the raw evidence.',
      'Do not merge sibling child ranges into a larger fetch. If expansion returns `281-290` and `291-300`, you must fetch one exact child range at a time.',
      fetchAvailable
        ? `You may call \`expand_source_range\` at most 1 time and \`fetch_source_range\` at most ${maxToolCalls} time for this reply. If the summaries and facts are sufficient, answer without calling either tool.`
        : 'You may call `expand_source_range` at most 1 time for this reply. Use it only to narrow the search space, not as raw evidence.',
      'If the likely evidence sits inside a surfaced parent range and the best child range is unclear, expand first.',
      'If the user asks about the last or final part of an older event, inspect the latest relevant child range first.',
      'If the user asks about the first or beginning of an older event, inspect the earliest relevant child range first.',
    )
  }

  return instructions.join('\n')
}

export function prepareExperimentalAgenticTranscriptRecallRequest<
  TStreamRequest extends ExperimentalStreamRequest,
>({
  supabase,
  chatId,
  runtimeConfig,
  sourceHints,
  sourceMap,
  streamRequest,
  debugMetrics,
  logDebug = () => undefined,
}: {
  supabase: TurnClient
  chatId: string
  runtimeConfig: AgenticTranscriptRecallRuntimeConfig
  sourceHints: AgenticTranscriptRecallSourceHints | null
  sourceMap: AgenticTranscriptRecallSourceMap | null
  streamRequest: TStreamRequest
  debugMetrics: Record<string, string | number | boolean | null>
  logDebug?: (...args: unknown[]) => void
}): ExperimentalAgenticTranscriptRecallWrapperResult<TStreamRequest> {
  logDebug('[Agentic Transcript Recall] Experimental wrapper active')

  debugMetrics['experimental_agentic_transcript_recall_tool_available'] = false
  debugMetrics['experimental_agentic_transcript_recall_expand_available'] = false
  debugMetrics['experimental_agentic_transcript_recall_expand_call_count'] = 0
  debugMetrics['experimental_agentic_transcript_recall_expand_last_parent_start_seq'] = null
  debugMetrics['experimental_agentic_transcript_recall_expand_last_parent_end_seq'] = null
  debugMetrics['experimental_agentic_transcript_recall_expand_last_reason'] = null
  debugMetrics['experimental_agentic_transcript_recall_expand_last_block_reason'] = null
  debugMetrics['experimental_agentic_transcript_recall_expand_last_child_range_count'] = null
  debugMetrics['experimental_agentic_transcript_recall_tool_call_count'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_fetch_count'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_total_messages_fetched'] = 0
  debugMetrics['experimental_agentic_transcript_recall_tool_last_start_seq'] = null
  debugMetrics['experimental_agentic_transcript_recall_tool_last_end_seq'] = null
  debugMetrics['experimental_agentic_transcript_recall_tool_last_reason'] = null
  debugMetrics['experimental_agentic_transcript_recall_tool_last_block_reason'] = null
  debugMetrics['experimental_agentic_transcript_recall_step_count'] = 0

  if (
    (!sourceMap ||
      (sourceMap.directFetchRanges.length === 0 && sourceMap.navigationParents.length === 0)) &&
    (!sourceHints || sourceHints.hints.length === 0)
  ) {
    return {
      streamRequest,
    }
  }

  let budgetState = createAgenticTranscriptRecallBudgetState()
  let expandBudgetState = createAgenticTranscriptRecallExpandBudgetState()
  const tools: NonNullable<ExperimentalAgenticTranscriptRecallStreamSettings['tools']> = {}

  if (sourceMap && sourceMap.navigationParents.length > 0) {
    tools[EXPAND_SOURCE_RANGE_TOOL_NAME] = tool({
      description: EXPAND_SOURCE_RANGE_TOOL_DESCRIPTION,
      inputSchema: expandSourceRangeToolInputSchema,
      async execute(input) {
        debugMetrics['experimental_agentic_transcript_recall_expand_call_count'] =
          Number(debugMetrics['experimental_agentic_transcript_recall_expand_call_count'] ?? 0) + 1
        debugMetrics['experimental_agentic_transcript_recall_expand_last_parent_start_seq'] =
          input.parentStartSeq
        debugMetrics['experimental_agentic_transcript_recall_expand_last_parent_end_seq'] =
          input.parentEndSeq
        debugMetrics['experimental_agentic_transcript_recall_expand_last_reason'] = input.reason
        debugMetrics['experimental_agentic_transcript_recall_expand_last_block_reason'] = null
        debugMetrics['experimental_agentic_transcript_recall_expand_last_child_range_count'] = null

        const executionResult = await executeExpandSourceRange({
          runtimeConfig,
          sourceMap,
          budgetState: expandBudgetState,
          input,
        })

        expandBudgetState = executionResult.budgetState

        if (executionResult.result.status === 'expanded') {
          debugMetrics['experimental_agentic_transcript_recall_expand_last_child_range_count'] =
            executionResult.result.childRangeCount

          logDebug('[Agentic Transcript Recall] Expanded transcript source parent range', {
            chatId,
            parentStartSeq: executionResult.result.parentStartSeq,
            parentEndSeq: executionResult.result.parentEndSeq,
            childRangeCount: executionResult.result.childRangeCount,
          })
        } else {
          debugMetrics['experimental_agentic_transcript_recall_expand_last_block_reason'] =
            executionResult.result.blockReason

          logDebug('[Agentic Transcript Recall] Blocked transcript source parent expansion', {
            chatId,
            parentStartSeq: executionResult.result.parentStartSeq,
            parentEndSeq: executionResult.result.parentEndSeq,
            blockReason: executionResult.result.blockReason,
          })
        }

        return executionResult.result
      },
    })
  }

  if (sourceMap && sourceMap.directFetchRanges.length > 0) {
    tools[FETCH_SOURCE_RANGE_TOOL_NAME] = tool({
      description: FETCH_SOURCE_RANGE_TOOL_DESCRIPTION,
      inputSchema: fetchSourceRangeToolInputSchema,
      async execute(input) {
        debugMetrics['experimental_agentic_transcript_recall_tool_call_count'] =
          Number(debugMetrics['experimental_agentic_transcript_recall_tool_call_count'] ?? 0) + 1
        debugMetrics['experimental_agentic_transcript_recall_tool_last_start_seq'] = input.startSeq
        debugMetrics['experimental_agentic_transcript_recall_tool_last_end_seq'] = input.endSeq
        debugMetrics['experimental_agentic_transcript_recall_tool_last_reason'] = input.reason
        debugMetrics['experimental_agentic_transcript_recall_tool_last_block_reason'] = null

        try {
          const executionResult = await executeFetchSourceRange({
            supabase,
            chatId,
            runtimeConfig,
            sourceMap,
            budgetState,
            input,
          })

          budgetState = executionResult.budgetState

          if (executionResult.result.status === 'fetched') {
            debugMetrics['experimental_agentic_transcript_recall_tool_fetch_count'] =
              Number(debugMetrics['experimental_agentic_transcript_recall_tool_fetch_count'] ?? 0) +
              1
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
              Number(debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] ?? 0) +
              1
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
            Number(debugMetrics['experimental_agentic_transcript_recall_tool_block_count'] ?? 0) + 1
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
    })
  }

  if (Object.keys(tools).length === 0) {
    return {
      streamRequest,
    }
  }

  const fetchAvailable = FETCH_SOURCE_RANGE_TOOL_NAME in tools
  const expandAvailable = EXPAND_SOURCE_RANGE_TOOL_NAME in tools

  const augmentedSystem = [
    streamRequest.system,
    buildExperimentalInstruction({
      maxToolCalls: runtimeConfig.maxToolCalls,
      fetchAvailable,
      expandAvailable,
    }),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n')

  const wrappedStreamRequest: TStreamRequest = {
    ...streamRequest,
    system: augmentedSystem,
  }

  const streamTextSettings: ExperimentalAgenticTranscriptRecallStreamSettings = {
    tools,
    stopWhen: stepCountIs(runtimeConfig.maxToolCalls + 2),
    onStepFinish(stepResult) {
      debugMetrics['experimental_agentic_transcript_recall_step_count'] =
        Number(debugMetrics['experimental_agentic_transcript_recall_step_count'] ?? 0) + 1
      debugMetrics['experimental_agentic_transcript_recall_tool_available'] = true
      debugMetrics['experimental_agentic_transcript_recall_expand_available'] = !!(
        sourceMap && sourceMap.navigationParents.length > 0
      )

      logDebug('[Agentic Transcript Recall] Step finished', {
        chatId,
        finishReason: stepResult.finishReason,
        stepToolCalls: stepResult.toolCalls.length,
        stepToolResults: stepResult.toolResults.length,
      })
    },
  }

  debugMetrics['experimental_agentic_transcript_recall_tool_available'] = true
  debugMetrics['experimental_agentic_transcript_recall_expand_available'] = !!(
    sourceMap && sourceMap.navigationParents.length > 0
  )

  return {
    streamRequest: wrappedStreamRequest,
    streamTextSettings,
  }
}
