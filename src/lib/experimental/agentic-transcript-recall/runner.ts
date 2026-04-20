import { stepCountIs, streamText, tool } from 'ai'
import type { TurnClient } from '@/lib/chat/turn-types'
import type { AgenticTranscriptRecallRuntimeConfig } from './config'
import {
  createAgenticTranscriptRecallExpandBudgetState,
  executeExpandSourceRange,
  EXPAND_SOURCE_RANGE_TOOL_NAME,
  expandSourceRangeToolInputSchema,
} from './expand-tool'
import { createAgenticTranscriptRecallBudgetState } from './policy'
import type { AgenticTranscriptRecallSourceMap } from './source-map'
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

const EXACT_DETAIL_RECALL_QUERY_PATTERNS = [
  /\b(first|last|final|beginning|start|exact|specific|original|verbatim|quote|where|location|who|order|before|after)\b/i,
  /(마지막|처음|시작|끝|정확|구체|원문|그대로|어디|위치|장소|누가|누구|순서|먼저|직전|직후|뭐라고|무슨 말)/,
] as const

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (!part || typeof part !== 'object') {
        return ''
      }

      const candidate = part as { type?: unknown; text?: unknown }
      if (candidate.type === 'text' && typeof candidate.text === 'string') {
        return candidate.text
      }

      return typeof candidate.text === 'string' ? candidate.text : ''
    })
    .filter((text) => text.length > 0)
    .join('\n')
}

function getLatestUserMessageText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object') {
      continue
    }

    const candidate = message as { role?: unknown; content?: unknown }
    if (candidate.role !== 'user') {
      continue
    }

    const text = extractTextFromMessageContent(candidate.content).trim()
    if (text.length > 0) {
      return text
    }
  }

  return null
}

function isExactDetailRecallQuery(text: string | null): boolean {
  if (!text) {
    return false
  }

  return EXACT_DETAIL_RECALL_QUERY_PATTERNS.some((pattern) => pattern.test(text))
}

function buildExperimentalInstruction({
  maxToolCalls,
  latestUserMessage,
}: {
  maxToolCalls: number
  latestUserMessage: string | null
}): string {
  const instructions = [
    '=== Experimental Transcript Recall ===',
    'You may call `expand_source_range` when a surfaced parent range such as `[Meta Summary 1-100]` is too large for direct raw fetch.',
    'After expansion, call `fetch_source_range` if one smaller child range is needed to verify your next reply.',
    'Only call `fetch_source_range` for a directly surfaced small range such as `[1-10]`, or for a bounded child range returned by `expand_source_range`.',
    'Do not use this tool for recent raw messages that are already visible in the conversation context.',
    'Do not treat `expand_source_range` output as raw evidence. Expansion only narrows the search space; fetched transcript lines are the raw evidence.',
    'Do not merge sibling child ranges into a larger fetch. If expansion returns `281-290` and `291-300`, you must fetch one exact child range at a time.',
    `You may call \`expand_source_range\` at most 1 time and \`fetch_source_range\` at most ${maxToolCalls} time for this reply. If the summaries and facts are sufficient, answer without calling either tool.`,
  ]

  if (isExactDetailRecallQuery(latestUserMessage)) {
    instructions.push(
      '=== Recall Priority For This User Message ===',
      'The latest user message appears to ask for an exact older detail such as a first/last event, location, order, speaker, or exact wording.',
      'Do not answer that kind of question from summaries alone when transcript recall tools are available for the relevant older range.',
      'If the likely evidence sits inside a surfaced parent range, expand first.',
      'If the user asks about the last/final/end of an older event, inspect the latest relevant child range first.',
      'If the user asks about the first/start/beginning of an older event, inspect the earliest relevant child range first.',
      maxToolCalls > 1
        ? 'If one fetched child range is still insufficient and budget remains, fetch one adjacent child range before answering.'
        : 'If one fetched child range is still insufficient and no fetch budget remains, say that you could not fully verify the raw transcript.',
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
  const latestUserMessage = getLatestUserMessageText(streamRequest.messages)
  const augmentedSystem = [
    streamRequest.system,
    buildExperimentalInstruction({
      maxToolCalls: runtimeConfig.maxToolCalls,
      latestUserMessage,
    }),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n')

  const wrappedStreamRequest: TStreamRequest = {
    ...streamRequest,
    system: augmentedSystem,
  }

  const tools: NonNullable<ExperimentalAgenticTranscriptRecallStreamSettings['tools']> = {}

  if (sourceMap && sourceMap.navigationParents.length > 0) {
    tools[EXPAND_SOURCE_RANGE_TOOL_NAME] = tool({
      description:
        'Expand one surfaced parent range into bounded child ranges that are legal raw transcript fetch targets for this reply.',
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
      description:
        'Fetch the raw transcript messages for one older summary or fact range when exact wording matters for the current reply.',
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
