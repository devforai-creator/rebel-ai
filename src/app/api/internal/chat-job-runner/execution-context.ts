import { createAdminClient } from '@/lib/supabase/admin'
import type { ApiKey, Chat, Character, Persona } from '@/types/database.types'
import { ensureUserFirstForAnthropic } from '@/lib/chat/anthropic-user-first'
import { buildMemoryPlan } from '@/lib/chat-memory'
import { CHAT_RUNNER_LIMITS } from '@/lib/chat/runtime-limits'
import { getGlobalSystemPrompt } from '@/lib/chat/global-system-prompt'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { applyBilingualContext, isBilingualEnabled } from '@/lib/chat/bilingual-context'
import {
  normalizeChatModelConfig,
  resolveChatMemoryConfig,
  type ChatMemoryMode,
} from '@/lib/chat/model-config'
import {
  resolveAgenticTranscriptRecallRuntimeConfig,
  type AgenticTranscriptRecallRuntimeConfig,
} from '@/lib/experimental/agentic-transcript-recall/config'
import {
  deriveAgenticTranscriptRecallSourceHints,
  type AgenticTranscriptRecallSourceHints,
} from '@/lib/experimental/agentic-transcript-recall/source-hints'
import {
  deriveAgenticTranscriptRecallSourceMap,
  type AgenticTranscriptRecallSourceMap,
} from '@/lib/experimental/agentic-transcript-recall/source-map'
import { getLastSummaryEnd } from '@/lib/chat-summaries/db-helpers'
import { CONTEXT_WINDOW, SUMMARY_LEVEL_CHUNK } from '@/lib/chat-summaries/config'
import {
  loadChatLorebookState,
  lorebookNeedsChatHistory,
  renderActiveLorebookBlock,
} from '@/lib/lorebook/runtime'
import {
  countProjectedConversationMessages,
  loadGenerationTranscript,
  loadProjectedConversationTail,
} from '@/lib/chat/turns'
import type { ProjectedConversationMessage } from '@/lib/chat/turns'
import { buildSystemPrompt } from './system-prompt-builder'
import { decryptSecret } from './vault'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type DebugMetricValue = string | number | boolean | null
type RunnerApiKeyRow = Pick<ApiKey, 'vault_secret_name' | 'service_tier' | 'reasoning_effort'>
type RunnerChatRow = Pick<
  Chat,
  'id' | 'user_id' | 'character_id' | 'persona_id' | 'custom_system_prompt' | 'model_config'
>
type RunnerPersonaRow = Pick<Persona, 'name' | 'description'>
type RunnerCharacterRow = Pick<Character, 'id' | 'name' | 'system_prompt'> & {
  post_history_instructions: string | null
}
type MemoryPlanResult = Awaited<ReturnType<typeof buildMemoryPlan>>
type GenerationTranscript = ChatGenerationJobPayload['sanitizedMessages']
type TranscriptSource = 'payload' | 'payload_tail' | 'db_tail' | 'db_full'
type LorebookHistorySource = 'payload' | 'db_full' | 'not_needed'
export type TranscriptSourceReason =
  | 'payload_covers_full_conversation'
  | 'payload_satisfies_required_window'
  | 'lorebook_requires_full_history'
  | 'payload_missing_regeneration_exclusion'
  | 'payload_shorter_than_required_window'
export type LorebookHistorySourceReason =
  | 'history_not_needed'
  | 'payload_covers_full_conversation'
  | 'lorebook_requires_full_history'
  | 'no_persisted_turn'

export type LoadedChatJobExecutionContext = {
  apiKeyData: RunnerApiKeyRow
  decryptedApiKey: string
  generationTranscript: ChatGenerationJobPayload['sanitizedMessages']
  finalSystemPrompt: string
  staticSystemPrompt: string
  dynamicContext: MemoryPlanResult['dynamicContext']
  dynamicContextTokens: number
  promptBlocks: MemoryPlanResult['promptBlocks']
  recentMessages: MemoryPlanResult['fallbackMessages']
  ragInfo: MemoryPlanResult['ragInfo']
  agenticTranscriptRecall: AgenticTranscriptRecallRuntimeConfig
  agenticTranscriptRecallSourceHints: AgenticTranscriptRecallSourceHints | null
  agenticTranscriptRecallSourceMap: AgenticTranscriptRecallSourceMap | null
  bilingualEnabled: boolean
  anthropicConversationMessages: MemoryPlanResult['fallbackMessages']
  anthropicPlaceholderAdded: boolean
  totalInputTokens: number
  staticPromptTokens: number
  debugMetrics: Record<string, DebugMetricValue>
}

function buildPayloadGenerationTranscript(payload: ChatGenerationJobPayload): {
  transcript: GenerationTranscript
  excludedAssistant: boolean
} {
  if (!payload.isRegeneration || !payload.regenerateAssistantMessageId) {
    return {
      transcript: payload.sanitizedMessages,
      excludedAssistant: false,
    }
  }

  const transcript = payload.sanitizedMessages.filter(
    (message) => message.messageId !== payload.regenerateAssistantMessageId,
  )

  return {
    transcript,
    excludedAssistant: transcript.length !== payload.sanitizedMessages.length,
  }
}

function mapProjectedConversationTail(
  messages: ProjectedConversationMessage[],
): GenerationTranscript {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    messageId: message.id,
  }))
}

function getTranscriptStartOrdinal(totalMessages: number, transcriptLength: number): number {
  return transcriptLength > 0
    ? Math.max(1, totalMessages - transcriptLength + 1)
    : totalMessages + 1
}

function getTranscriptSuffixStartOrdinal({
  transcriptStartOrdinal,
  transcriptLength,
  suffixLength,
}: {
  transcriptStartOrdinal: number
  transcriptLength: number
  suffixLength: number
}): number {
  return transcriptStartOrdinal + Math.max(0, transcriptLength - Math.max(0, suffixLength))
}

function takeTranscriptTail({
  transcript,
  totalMessages,
  requiredMessageCount,
}: {
  transcript: GenerationTranscript
  totalMessages: number
  requiredMessageCount: number
}): { transcript: GenerationTranscript; transcriptStartOrdinal: number } {
  const trimmedTranscript =
    requiredMessageCount > 0
      ? transcript.slice(-requiredMessageCount)
      : ([] as GenerationTranscript)

  return {
    transcript: trimmedTranscript,
    transcriptStartOrdinal: getTranscriptStartOrdinal(totalMessages, trimmedTranscript.length),
  }
}

export function resolveTranscriptSourcePlan({
  memoryMode,
  payloadTranscriptLength,
  effectiveConversationMessageCount,
  payloadTranscriptCanRepresentGeneration,
  lorebookRequiresHistory,
  lastChunkEnd,
}: {
  memoryMode: ChatMemoryMode
  payloadTranscriptLength: number
  effectiveConversationMessageCount: number
  payloadTranscriptCanRepresentGeneration: boolean
  lorebookRequiresHistory: boolean
  lastChunkEnd: number | null
}): {
  requiredMessageCount: number
  payloadCoversFullConversation: boolean
  shouldLoadFullConversationTranscript: boolean
  shouldUsePayloadWindow: boolean
  reason: TranscriptSourceReason
} {
  const requiredMessageCount =
    memoryMode === 'summary_window'
      ? Math.min(effectiveConversationMessageCount, CONTEXT_WINDOW)
      : Math.max(0, effectiveConversationMessageCount - (lastChunkEnd ?? 0))

  const payloadCoversFullConversation =
    payloadTranscriptCanRepresentGeneration &&
    payloadTranscriptLength >= effectiveConversationMessageCount

  if (lorebookRequiresHistory && !payloadCoversFullConversation) {
    return {
      requiredMessageCount,
      payloadCoversFullConversation,
      shouldLoadFullConversationTranscript: true,
      shouldUsePayloadWindow: false,
      reason: payloadTranscriptCanRepresentGeneration
        ? 'lorebook_requires_full_history'
        : 'payload_missing_regeneration_exclusion',
    }
  }

  if (payloadTranscriptCanRepresentGeneration && payloadTranscriptLength >= requiredMessageCount) {
    return {
      requiredMessageCount,
      payloadCoversFullConversation,
      shouldLoadFullConversationTranscript: false,
      shouldUsePayloadWindow: true,
      reason: payloadCoversFullConversation
        ? 'payload_covers_full_conversation'
        : 'payload_satisfies_required_window',
    }
  }

  return {
    requiredMessageCount,
    payloadCoversFullConversation,
    shouldLoadFullConversationTranscript: false,
    shouldUsePayloadWindow: false,
    reason: payloadTranscriptCanRepresentGeneration
      ? 'payload_shorter_than_required_window'
      : 'payload_missing_regeneration_exclusion',
  }
}

export function resolveLorebookHistoryPlan({
  hasPersistedTurn,
  lorebookRequiresHistory,
  payloadCoversFullConversation,
  fullConversationTranscriptLoaded,
}: {
  hasPersistedTurn: boolean
  lorebookRequiresHistory: boolean
  payloadCoversFullConversation: boolean
  fullConversationTranscriptLoaded: boolean
}): {
  source: LorebookHistorySource
  reason: LorebookHistorySourceReason
} {
  if (!lorebookRequiresHistory) {
    return {
      source: 'not_needed',
      reason: 'history_not_needed',
    }
  }

  if (fullConversationTranscriptLoaded) {
    return {
      source: 'db_full',
      reason: 'lorebook_requires_full_history',
    }
  }

  if (hasPersistedTurn && payloadCoversFullConversation) {
    return {
      source: 'payload',
      reason: 'payload_covers_full_conversation',
    }
  }

  return {
    source: 'payload',
    reason: 'no_persisted_turn',
  }
}

async function loadConversationTranscriptTail({
  supabase,
  chatId,
  limitMessages,
  excludeAssistantForTurnId,
  totalMessages,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  limitMessages: number
  excludeAssistantForTurnId: string | null
  totalMessages: number
}): Promise<{ transcript: GenerationTranscript; transcriptStartOrdinal: number }> {
  const tailMessages = await loadProjectedConversationTail({
    supabase,
    chatId,
    limitMessages,
    excludeAssistantForTurnId,
  })

  const transcript = mapProjectedConversationTail(tailMessages)

  return {
    transcript,
    transcriptStartOrdinal: getTranscriptStartOrdinal(totalMessages, transcript.length),
  }
}

export async function loadChatJobExecutionContext({
  supabase,
  payload,
  timings,
}: {
  supabase: AdminSupabaseClient
  payload: ChatGenerationJobPayload
  timings: Record<string, number>
}): Promise<LoadedChatJobExecutionContext> {
  const { chatId, userId, apiKeyId, provider } = payload
  const debugMetrics: Record<string, DebugMetricValue> = {}

  const apiKeyQueryStart = performance.now()
  const apiKeyQueryPromise = supabase
    .from('api_keys')
    .select<'vault_secret_name, service_tier, reasoning_effort'>(
      'vault_secret_name, service_tier, reasoning_effort',
    )
    .eq('id', apiKeyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single<RunnerApiKeyRow>()
    .then((result) => {
      timings['1_api_key_query'] = performance.now() - apiKeyQueryStart
      return result
    })

  const chatQueryStart = performance.now()
  const chatQueryPromise = supabase
    .from('chats')
    .select<'id, user_id, character_id, persona_id, custom_system_prompt, model_config'>(
      'id, user_id, character_id, persona_id, custom_system_prompt, model_config',
    )
    .eq('id', chatId)
    .eq('user_id', userId)
    .single<RunnerChatRow>()
    .then((result) => {
      timings['2_chat_query'] = performance.now() - chatQueryStart
      return result
    })

  const [{ data: apiKeyData, error: apiKeyError }, { data: chat, error: chatError }] =
    await Promise.all([apiKeyQueryPromise, chatQueryPromise])

  if (apiKeyError || !apiKeyData) {
    throw new Error('API key not found or inactive')
  }
  if (chatError || !chat) {
    throw new Error('Chat not found')
  }

  const apiKeyDecryptStart = performance.now()
  const apiKeyDecryptPromise = decryptSecret({
    supabase,
    secretName: apiKeyData.vault_secret_name,
    requester: userId,
  }).then((decrypted) => {
    timings['3_api_key_decrypt'] = performance.now() - apiKeyDecryptStart
    return decrypted
  })

  const personaQueryStart = performance.now()
  const personaPromise = chat.persona_id
    ? supabase
        .from('personas')
        .select<'name, description'>('name, description')
        .eq('id', chat.persona_id)
        .eq('user_id', userId)
        .single<RunnerPersonaRow>()
        .then((result) => {
          timings['4_persona_query'] = performance.now() - personaQueryStart
          return result
        })
    : Promise.resolve({
        data: null as RunnerPersonaRow | null,
        error: null,
      }).then((result) => {
        timings['4_persona_query'] = performance.now() - personaQueryStart
        return result
      })

  const characterQueryStart = performance.now()
  const characterPromise = supabase
    .from('characters')
    .select(
      `
      id,
      name,
      system_prompt,
      post_history_instructions:metadata->>post_history_instructions
    `,
    )
    .eq('id', chat.character_id)
    .single<RunnerCharacterRow>()
    .then((result) => {
      timings['5_character_query'] = performance.now() - characterQueryStart
      return result
    })

  const [decryptedApiKey, { data: persona }, { data: character, error: characterError }] =
    await Promise.all([apiKeyDecryptPromise, personaPromise, characterPromise])

  if (characterError || !character) {
    throw new Error('Character not found')
  }

  const defaultSystemPrompt = getGlobalSystemPrompt()
  const normalizedModelConfig = normalizeChatModelConfig(chat.model_config)
  const memoryConfig = resolveChatMemoryConfig(normalizedModelConfig)
  const agenticTranscriptRecall = resolveAgenticTranscriptRecallRuntimeConfig({
    modelConfig: normalizedModelConfig,
    provider,
  })
  debugMetrics['experimental_agentic_transcript_recall_configured'] =
    agenticTranscriptRecall.configured
  debugMetrics['experimental_agentic_transcript_recall_globally_enabled'] =
    agenticTranscriptRecall.globallyEnabled
  debugMetrics['experimental_agentic_transcript_recall_provider_supported'] =
    agenticTranscriptRecall.providerSupported
  debugMetrics['experimental_agentic_transcript_recall_provider_allowed'] =
    agenticTranscriptRecall.providerAllowed
  debugMetrics['experimental_agentic_transcript_recall_enabled'] = agenticTranscriptRecall.enabled
  debugMetrics['experimental_agentic_transcript_recall_skip_reason'] =
    agenticTranscriptRecall.skipReason
  debugMetrics['experimental_agentic_transcript_recall_max_tool_calls'] =
    agenticTranscriptRecall.maxToolCalls
  debugMetrics['experimental_agentic_transcript_recall_max_messages_per_call'] =
    agenticTranscriptRecall.maxMessagesPerCall
  debugMetrics['experimental_agentic_transcript_recall_max_total_messages'] =
    agenticTranscriptRecall.maxTotalMessages
  const { transcript: payloadTranscript, excludedAssistant: payloadExcludedAssistant } =
    buildPayloadGenerationTranscript(payload)

  let stepStart = performance.now()
  const excludeAssistantForTurnId = payload.isRegeneration ? payload.turnId : null
  const excludeAssistantFromTranscript = excludeAssistantForTurnId !== null
  const payloadTranscriptCanRepresentGeneration =
    !excludeAssistantFromTranscript || payloadExcludedAssistant
  let generationTranscript = payloadTranscript
  let transcriptSource: TranscriptSource = 'payload'
  let transcriptStartOrdinal = 1
  let effectiveConversationMessageCount = payloadTranscript.length
  let lorebookHistory = payloadTranscript
  let lorebookEntries: Awaited<ReturnType<typeof loadChatLorebookState>>['entries'] = []
  let lorebookOverrideMap = new Map<string, boolean>()
  let lastChunkEnd: number | null = null

  if (payload.turnId) {
    const totalConversationMessageCount = await countProjectedConversationMessages({
      supabase,
      chatId,
    })

    effectiveConversationMessageCount = Math.max(
      0,
      totalConversationMessageCount - (excludeAssistantFromTranscript ? 1 : 0),
    )

    const lorebookState = await loadChatLorebookState({
      supabase,
      chatId,
      characterId: character.id,
    })
    lorebookEntries = lorebookState.entries
    lorebookOverrideMap = lorebookState.overrideMap
    const lorebookRequiresHistory = lorebookNeedsChatHistory(lorebookState)

    debugMetrics['lorebook_module_count'] = new Set(
      lorebookState.entries.map((entry) => entry.moduleId),
    ).size
    debugMetrics['lorebook_entry_count'] = lorebookState.entries.length
    debugMetrics['lorebook_override_count'] = lorebookState.overrideMap.size
    debugMetrics['lorebook_requires_history'] = lorebookRequiresHistory

    if (memoryConfig.mode === 'prefix_live_blocks') {
      lastChunkEnd = (await getLastSummaryEnd(supabase as never, chatId, SUMMARY_LEVEL_CHUNK)) ?? 0
      debugMetrics['memory_last_chunk_end'] = lastChunkEnd
    }

    const transcriptPlan = resolveTranscriptSourcePlan({
      memoryMode: memoryConfig.mode,
      payloadTranscriptLength: payloadTranscript.length,
      effectiveConversationMessageCount,
      payloadTranscriptCanRepresentGeneration,
      lorebookRequiresHistory,
      lastChunkEnd,
    })

    let fullConversationTranscript: GenerationTranscript | null = null

    if (transcriptPlan.shouldLoadFullConversationTranscript) {
      fullConversationTranscript = await loadGenerationTranscript({
        supabase,
        chatId,
        turnId: payload.turnId,
        excludeAssistantForTurnId,
        onMetrics(metrics) {
          debugMetrics['transcript_target_turn_index'] = metrics.targetTurnIndex
          debugMetrics['transcript_turn_count'] = metrics.turnCount
          debugMetrics['transcript_db_message_row_count'] = metrics.fetchedMessageCount
        },
      })
    }

    const lorebookHistoryPlan = resolveLorebookHistoryPlan({
      hasPersistedTurn: true,
      lorebookRequiresHistory,
      payloadCoversFullConversation: transcriptPlan.payloadCoversFullConversation,
      fullConversationTranscriptLoaded: fullConversationTranscript !== null,
    })
    lorebookHistory =
      lorebookHistoryPlan.source === 'db_full'
        ? fullConversationTranscript!
        : lorebookRequiresHistory
          ? payloadTranscript
          : []
    debugMetrics['lorebook_history_source'] = lorebookHistoryPlan.source
    debugMetrics['lorebook_history_source_reason'] = lorebookHistoryPlan.reason
    debugMetrics['lorebook_history_message_count'] = lorebookHistory.length
    debugMetrics['transcript_required_message_count'] = transcriptPlan.requiredMessageCount
    debugMetrics['transcript_payload_can_represent_generation'] =
      payloadTranscriptCanRepresentGeneration
    debugMetrics['transcript_payload_covers_full_conversation'] =
      transcriptPlan.payloadCoversFullConversation
    debugMetrics['transcript_source_reason'] = transcriptPlan.reason

    if (fullConversationTranscript) {
      const resolvedWindow = takeTranscriptTail({
        transcript: fullConversationTranscript,
        totalMessages: effectiveConversationMessageCount,
        requiredMessageCount: transcriptPlan.requiredMessageCount,
      })
      generationTranscript = resolvedWindow.transcript
      transcriptStartOrdinal = resolvedWindow.transcriptStartOrdinal
      transcriptSource = 'db_full'
    } else if (transcriptPlan.shouldUsePayloadWindow) {
      const resolvedWindow = takeTranscriptTail({
        transcript: payloadTranscript,
        totalMessages: effectiveConversationMessageCount,
        requiredMessageCount: transcriptPlan.requiredMessageCount,
      })
      generationTranscript = resolvedWindow.transcript
      transcriptStartOrdinal = resolvedWindow.transcriptStartOrdinal
      transcriptSource =
        transcriptPlan.requiredMessageCount === payloadTranscript.length
          ? 'payload'
          : 'payload_tail'
    } else {
      const resolvedWindow = await loadConversationTranscriptTail({
        supabase,
        chatId,
        limitMessages: transcriptPlan.requiredMessageCount,
        excludeAssistantForTurnId,
        totalMessages: effectiveConversationMessageCount,
      })
      generationTranscript = resolvedWindow.transcript
      transcriptStartOrdinal = resolvedWindow.transcriptStartOrdinal
      transcriptSource = 'db_tail'
    }
  } else {
    const lorebookState = await loadChatLorebookState({
      supabase,
      chatId,
      characterId: character.id,
    })
    const lorebookRequiresHistory = lorebookNeedsChatHistory(lorebookState)

    lorebookEntries = lorebookState.entries
    lorebookOverrideMap = lorebookState.overrideMap
    lorebookHistory = lorebookRequiresHistory ? payloadTranscript : []

    debugMetrics['lorebook_module_count'] = new Set(
      lorebookState.entries.map((entry) => entry.moduleId),
    ).size
    debugMetrics['lorebook_entry_count'] = lorebookState.entries.length
    debugMetrics['lorebook_override_count'] = lorebookState.overrideMap.size
    debugMetrics['lorebook_requires_history'] = lorebookRequiresHistory
    const lorebookHistoryPlan = resolveLorebookHistoryPlan({
      hasPersistedTurn: false,
      lorebookRequiresHistory,
      payloadCoversFullConversation: true,
      fullConversationTranscriptLoaded: false,
    })
    debugMetrics['lorebook_history_source'] = lorebookHistoryPlan.source
    debugMetrics['lorebook_history_source_reason'] = lorebookHistoryPlan.reason
    debugMetrics['lorebook_history_message_count'] = lorebookHistory.length
  }
  timings['5b_load_generation_transcript'] = performance.now() - stepStart

  if (!('transcript_required_message_count' in debugMetrics)) {
    debugMetrics['transcript_required_message_count'] = generationTranscript.length
  }
  if (!('transcript_payload_can_represent_generation' in debugMetrics)) {
    debugMetrics['transcript_payload_can_represent_generation'] =
      payloadTranscriptCanRepresentGeneration
  }
  if (!('transcript_payload_covers_full_conversation' in debugMetrics)) {
    debugMetrics['transcript_payload_covers_full_conversation'] =
      generationTranscript.length >= effectiveConversationMessageCount
  }
  if (!('transcript_source_reason' in debugMetrics)) {
    debugMetrics['transcript_source_reason'] = 'payload_covers_full_conversation'
  }

  debugMetrics['transcript_source'] = transcriptSource
  debugMetrics['transcript_message_count'] = generationTranscript.length
  debugMetrics['transcript_total_message_count'] = effectiveConversationMessageCount
  debugMetrics['transcript_start_ordinal'] = transcriptStartOrdinal
  debugMetrics['transcript_excluded_assistant'] =
    payloadExcludedAssistant ||
    (excludeAssistantFromTranscript && transcriptSource.startsWith('db'))

  stepStart = performance.now()
  const systemPrompt = await buildSystemPrompt({
    character,
    persona,
    defaultSystemPrompt,
    customSystemPrompt: chat.custom_system_prompt,
  })
  timings['6_build_system_prompt'] = performance.now() - stepStart

  stepStart = performance.now()
  const lorebookDynamicContext = renderActiveLorebookBlock({
    entries: lorebookEntries,
    overrideMap: lorebookOverrideMap,
    chatHistory: lorebookHistory,
  })
  timings['6b_build_lorebook_context'] = performance.now() - stepStart
  debugMetrics['lorebook_has_context'] = lorebookDynamicContext !== null
  debugMetrics['lorebook_context_chars'] = lorebookDynamicContext?.length ?? 0

  stepStart = performance.now()
  const {
    mode,
    dynamicContext,
    fallbackMessages: rawRecentMessages,
    fallbackSystemPrompt,
    promptBlocks,
    staticSystemPrompt,
    ragInfo,
  } = await buildMemoryPlan({
    supabase,
    chatId,
    sanitizedMessages: generationTranscript,
    totalConversationMessages: effectiveConversationMessageCount,
    baseSystemPrompt: systemPrompt,
    extraDynamicContext: lorebookDynamicContext ? [lorebookDynamicContext] : undefined,
    modelConfig: normalizedModelConfig,
    transcriptCoverage:
      generationTranscript.length >= effectiveConversationMessageCount ? 'full' : 'window',
    transcriptStartOrdinal,
  })
  const finalSystemPrompt = fallbackSystemPrompt
  timings['7_build_context'] = performance.now() - stepStart
  debugMetrics['memory_mode'] = mode
  debugMetrics['memory_recent_message_count'] = rawRecentMessages.length
  debugMetrics['memory_prompt_block_count'] = promptBlocks.length
  debugMetrics['memory_dynamic_context_chars'] = dynamicContext?.length ?? 0
  debugMetrics['rag_enabled'] = ragInfo?.enabled ?? false
  debugMetrics['rag_result_count'] = ragInfo?.results?.length ?? 0
  debugMetrics['rag_recent_messages'] = ragInfo?.diagnostics?.recentMessagesCount ?? null
  debugMetrics['rag_query_messages'] = ragInfo?.diagnostics?.queryMessagesCount ?? null
  debugMetrics['rag_query_text_chars'] = ragInfo?.diagnostics?.queryTextChars ?? null
  debugMetrics['rag_fallback_query_ms'] = ragInfo?.diagnostics?.fallbackFactsQueryMs ?? null
  debugMetrics['rag_fallback_fact_rows'] = ragInfo?.diagnostics?.fallbackFactsLoadedCount ?? null
  debugMetrics['rag_embedding_ms'] = ragInfo?.diagnostics?.embeddingMs ?? null
  debugMetrics['rag_rpc_ms'] = ragInfo?.diagnostics?.matchRpcMs ?? null
  debugMetrics['rag_total_ms'] = ragInfo?.diagnostics?.totalRetrievalMs ?? null
  debugMetrics['rag_candidate_fact_count'] = ragInfo?.diagnostics?.candidateFactCount ?? null
  debugMetrics['rag_skipped_reason'] = ragInfo?.diagnostics?.skippedReason ?? null

  const rawRecentContextStartOrdinal = getTranscriptSuffixStartOrdinal({
    transcriptStartOrdinal,
    transcriptLength: generationTranscript.length,
    suffixLength: rawRecentMessages.length,
  })
  const agenticTranscriptRecallSourceHints = agenticTranscriptRecall.configured
    ? deriveAgenticTranscriptRecallSourceHints({
        promptBlocks,
        rawContextStartOrdinal: rawRecentContextStartOrdinal,
      })
    : null
  const agenticTranscriptRecallSourceMap = agenticTranscriptRecallSourceHints
    ? deriveAgenticTranscriptRecallSourceMap({
        sourceHints: agenticTranscriptRecallSourceHints,
        runtimeConfig: agenticTranscriptRecall,
      })
    : null
  debugMetrics['experimental_agentic_transcript_recall_source_hint_count'] =
    agenticTranscriptRecallSourceHints?.hints.length ?? 0
  debugMetrics['experimental_agentic_transcript_recall_source_hint_raw_context_start_ordinal'] =
    agenticTranscriptRecallSourceHints?.rawContextStartOrdinal ?? rawRecentContextStartOrdinal
  debugMetrics['experimental_agentic_transcript_recall_source_hint_summary_count'] =
    agenticTranscriptRecallSourceHints?.hints.filter((hint) => hint.kind === 'summary').length ?? 0
  debugMetrics['experimental_agentic_transcript_recall_source_hint_fact_count'] =
    agenticTranscriptRecallSourceHints?.hints.filter((hint) => hint.kind === 'fact').length ?? 0
  debugMetrics['experimental_agentic_transcript_recall_direct_fetch_range_count'] =
    agenticTranscriptRecallSourceMap?.directFetchRanges.length ?? 0
  debugMetrics['experimental_agentic_transcript_recall_navigation_parent_count'] =
    agenticTranscriptRecallSourceMap?.navigationParents.length ?? 0
  debugMetrics['experimental_agentic_transcript_recall_navigation_parent_with_children_count'] =
    agenticTranscriptRecallSourceMap?.navigationParents.filter(
      (entry) => entry.childRanges.length > 0,
    ).length ?? 0

  stepStart = performance.now()
  const bilingualEnabled = await isBilingualEnabled(supabase, userId)
  timings['7a_bilingual_flag_query'] = performance.now() - stepStart
  debugMetrics['bilingual_enabled'] = bilingualEnabled

  stepStart = performance.now()
  const recentMessages = bilingualEnabled
    ? await applyBilingualContext({
        supabase,
        chatId,
        messages: rawRecentMessages,
        recentKoreanCount: 4,
        onMetrics(metrics) {
          debugMetrics['bilingual_total_messages'] = metrics.totalMessages
          debugMetrics['bilingual_recent_messages_kept'] = metrics.recentMessagesKept
          debugMetrics['bilingual_translation_candidates'] = metrics.translationCandidateCount
          debugMetrics['bilingual_translation_rows_fetched'] = metrics.fetchedTranslationRowCount
          debugMetrics['bilingual_translated_messages'] = metrics.translatedCount
          debugMetrics['bilingual_untranslated_candidates'] = metrics.untranslatedCandidateCount
          debugMetrics['bilingual_query_executed'] = metrics.queryExecuted
        },
      })
    : rawRecentMessages
  timings['7b_bilingual_context'] = performance.now() - stepStart

  if (!bilingualEnabled) {
    debugMetrics['bilingual_total_messages'] = rawRecentMessages.length
    debugMetrics['bilingual_recent_messages_kept'] = rawRecentMessages.length
    debugMetrics['bilingual_translation_candidates'] = 0
    debugMetrics['bilingual_translation_rows_fetched'] = 0
    debugMetrics['bilingual_translated_messages'] = 0
    debugMetrics['bilingual_untranslated_candidates'] = 0
    debugMetrics['bilingual_query_executed'] = false
  }

  const { messages: anthropicConversationMessages, placeholderAdded: anthropicPlaceholderAdded } =
    provider === 'anthropic'
      ? ensureUserFirstForAnthropic(recentMessages)
      : { messages: recentMessages, placeholderAdded: false }

  const systemPromptTokens = estimateTokens(finalSystemPrompt)
  const messagesTokens = recentMessages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
  const anthropicPlaceholderTokens = anthropicPlaceholderAdded ? estimateTokens('(continue)') : 0
  const totalInputTokens = systemPromptTokens + messagesTokens + anthropicPlaceholderTokens

  if (totalInputTokens > CHAT_RUNNER_LIMITS.maxTotalInputTokens) {
    throw new Error(`Input context too large (${totalInputTokens.toLocaleString()} tokens)`)
  }

  debugMetrics['anthropic_placeholder_added'] = anthropicPlaceholderAdded
  debugMetrics['estimated_total_input_tokens'] = totalInputTokens
  debugMetrics['estimated_static_prompt_tokens'] = estimateTokens(staticSystemPrompt)

  return {
    apiKeyData,
    decryptedApiKey,
    generationTranscript,
    finalSystemPrompt,
    staticSystemPrompt,
    dynamicContext,
    dynamicContextTokens: dynamicContext ? estimateTokens(dynamicContext) : 0,
    promptBlocks,
    recentMessages,
    ragInfo,
    agenticTranscriptRecall,
    agenticTranscriptRecallSourceHints,
    agenticTranscriptRecallSourceMap,
    bilingualEnabled,
    anthropicConversationMessages,
    anthropicPlaceholderAdded,
    totalInputTokens,
    staticPromptTokens: estimateTokens(staticSystemPrompt),
    debugMetrics,
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}
