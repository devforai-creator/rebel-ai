import { createAdminClient } from '@/lib/supabase/admin'
import type { ApiKey, Chat, Character, Persona } from '@/types/database.types'
import { ensureUserFirstForAnthropic } from '@/lib/chat/anthropic-user-first'
import { buildMemoryPlan } from '@/lib/chat-memory'
import { CHAT_RUNNER_LIMITS } from '@/lib/chat/runtime-limits'
import { getGlobalSystemPrompt } from '@/lib/chat/global-system-prompt'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { applyBilingualContext, isBilingualEnabled } from '@/lib/chat/bilingual-context'
import { normalizeChatModelConfig } from '@/lib/chat/model-config'
import { buildLorebookDynamicContext } from '@/lib/lorebook/runtime'
import { loadGenerationTranscript } from '@/lib/chat/turns'
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
  bilingualEnabled: boolean
  anthropicConversationMessages: MemoryPlanResult['fallbackMessages']
  anthropicPlaceholderAdded: boolean
  totalInputTokens: number
  staticPromptTokens: number
  debugMetrics: Record<string, DebugMetricValue>
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
  let stepStart = performance.now()
  const generationTranscript = payload.turnId
    ? await loadGenerationTranscript({
        supabase,
        chatId,
        turnId: payload.turnId,
        excludeAssistantForTurnId: payload.isRegeneration ? payload.turnId : null,
        onMetrics(metrics) {
          debugMetrics['transcript_source'] = 'db'
          debugMetrics['transcript_target_turn_index'] = metrics.targetTurnIndex
          debugMetrics['transcript_turn_count'] = metrics.turnCount
          debugMetrics['transcript_db_message_row_count'] = metrics.fetchedMessageCount
          debugMetrics['transcript_message_count'] = metrics.transcriptMessageCount
          debugMetrics['transcript_excluded_assistant'] = metrics.excludedAssistant
        },
      })
    : payload.sanitizedMessages
  timings['5b_load_generation_transcript'] = performance.now() - stepStart

  if (!payload.turnId) {
    debugMetrics['transcript_source'] = 'payload'
    debugMetrics['transcript_message_count'] = generationTranscript.length
    debugMetrics['transcript_excluded_assistant'] = false
  }

  stepStart = performance.now()
  const systemPrompt = await buildSystemPrompt({
    character,
    persona,
    defaultSystemPrompt,
    customSystemPrompt: chat.custom_system_prompt,
  })
  timings['6_build_system_prompt'] = performance.now() - stepStart

  stepStart = performance.now()
  const lorebookDynamicContext = await buildLorebookDynamicContext({
    supabase,
    chatId,
    characterId: character.id,
    chatHistory: generationTranscript,
    onMetrics(metrics) {
      debugMetrics['lorebook_module_count'] = metrics.moduleCount
      debugMetrics['lorebook_entry_count'] = metrics.entryCount
      debugMetrics['lorebook_override_count'] = metrics.overrideCount
      debugMetrics['lorebook_has_context'] = metrics.hasContext
      debugMetrics['lorebook_context_chars'] = metrics.contextCharCount
    },
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
    baseSystemPrompt: systemPrompt,
    extraDynamicContext: lorebookDynamicContext ? [lorebookDynamicContext] : undefined,
    modelConfig: normalizedModelConfig,
  })
  const finalSystemPrompt = fallbackSystemPrompt
  timings['7_build_context'] = performance.now() - stepStart
  debugMetrics['memory_mode'] = mode
  debugMetrics['memory_recent_message_count'] = rawRecentMessages.length
  debugMetrics['memory_prompt_block_count'] = promptBlocks.length
  debugMetrics['memory_dynamic_context_chars'] = dynamicContext?.length ?? 0
  debugMetrics['rag_enabled'] = ragInfo?.enabled ?? false
  debugMetrics['rag_result_count'] = ragInfo?.results?.length ?? 0

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
