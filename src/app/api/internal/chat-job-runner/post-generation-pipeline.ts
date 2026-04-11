import type { createAdminClient } from '@/lib/supabase/admin'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type {
  ApiKeyUpdate,
  Json,
  Message,
  MessageInsert,
  MessageUpdate,
} from '@/types/database.types'
import {
  MESSAGE_STATUS_COMPLETED,
  MESSAGE_STATUS_GENERATING,
  MESSAGE_STATUS_SUPERSEDED,
} from '@/lib/chat/message-status'
import {
  resolveSummaryModelPreference,
  type SummaryModelConfig,
} from '@/lib/chat/summary-model-preference'
import { triggerSummaryGeneration, type TriggerResult } from '@/lib/chat/summary-trigger'
import {
  buildChatUsageEvent,
  appendSummaryWarningToDebugInfo,
  type UsageMetrics,
} from './usage-debug'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type MessageIdRow = Pick<Message, 'id'>
type TurnStateRow = {
  id: string
  active_assistant_message_id: string | null
}
type AssistantVariantRow = {
  id: string
  variant_index: number | null
}

type ResolveSummaryModelPreferenceFn = (args: {
  supabase: AdminSupabaseClient
  userId: string
}) => Promise<SummaryModelConfig | null>

type TriggerSummaryGenerationFn = (args: {
  origin: string
  chatId: string
  userId: string
  provider: string
  modelName: string
  apiKeyId: string
}) => Promise<TriggerResult>

type TriggerMessageTranslationFn = (assistantMessageId: string, userId: string) => void

type RunPostGenerationPipelineArgs = {
  supabase: AdminSupabaseClient
  chatId: string
  userId: string
  apiKeyId: string
  provider: string
  modelName: string
  origin: string
  requestId: string
  assistantText: string
  assistantMessageId: string | null
  turnId: string | null
  regenerateAssistantMessageId: string | null
  promptTokens: number | null
  completionTokens: number | null
  debugInfo: Record<string, unknown>
  bilingualEnabled: boolean
  messageInsertDuration: number | null
  usage: UsageMetrics
  usageCost: UsageCostBreakdown | null
  triggerMessageTranslationFn: TriggerMessageTranslationFn
  resolveSummaryModelPreferenceFn?: ResolveSummaryModelPreferenceFn
  triggerSummaryGenerationFn?: TriggerSummaryGenerationFn
  now?: () => number
}

export type PostGenerationPipelineResult = {
  assistantMessageId: string
  messageInsertDuration: number | null
  usageEventInsertDurationMs: number
  summaryTriggerDurationMs: number
}

const CHAT_JOB_RUNNER_DEBUG_ENABLED = process.env.CHAT_JOB_RUNNER_DEBUG === 'true'

function logPostGenerationDebug(...args: unknown[]): void {
  if (CHAT_JOB_RUNNER_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function logPostGenerationPersistenceWarning({
  action,
  chatId,
  userId,
  apiKeyId,
  requestId,
  error,
}: {
  action: string
  chatId: string
  userId: string
  apiKeyId: string
  requestId: string
  error: string
}) {
  console.warn(action, {
    chatId,
    userId,
    apiKeyId,
    requestId,
    error,
  })
}

function scheduleSummaryGeneration({
  supabase,
  chatId,
  userId,
  apiKeyId,
  provider,
  modelName,
  origin,
  assistantMessageId,
  debugInfo,
  resolveSummaryModelPreferenceFn,
  triggerSummaryGenerationFn,
  now,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  userId: string
  apiKeyId: string
  provider: string
  modelName: string
  origin: string
  assistantMessageId: string
  debugInfo: Record<string, unknown>
  resolveSummaryModelPreferenceFn: ResolveSummaryModelPreferenceFn
  triggerSummaryGenerationFn: TriggerSummaryGenerationFn
  now: () => number
}): void {
  void (async () => {
    const summaryTriggerStart = now()
    let summaryFailure: { error: string; attempts?: number } | null = null

    try {
      const summaryPreference = await resolveSummaryModelPreferenceFn({ supabase, userId })
      const summaryConfig = summaryPreference ?? { provider, modelName, apiKeyId }

      if (summaryPreference) {
        logPostGenerationDebug('[Chat Job Runner] Using summary-specific model', {
          chatId,
          provider: summaryPreference.provider,
          modelName: summaryPreference.modelName,
        })
      }

      const summaryResult = await triggerSummaryGenerationFn({
        origin,
        chatId,
        userId,
        provider: summaryConfig.provider,
        modelName: summaryConfig.modelName,
        apiKeyId: summaryConfig.apiKeyId,
      })

      const summaryTriggerDurationMs = now() - summaryTriggerStart
      logPostGenerationDebug('[Chat Job Runner] Summary trigger finished', {
        chatId,
        userId,
        durationMs: summaryTriggerDurationMs,
        success: summaryResult.success,
        attempts: summaryResult.attempts,
      })

      if (!summaryResult.success) {
        summaryFailure = {
          error: summaryResult.error ?? 'Unknown summary trigger failure',
          attempts: summaryResult.attempts,
        }
        console.warn('[Chat Job Runner] Summary generation trigger failed', {
          chatId,
          userId,
          error: summaryResult.error,
          attempts: summaryResult.attempts,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown summary trigger failure'
      summaryFailure = { error: message }
      console.error('[Chat Job Runner] Summary generation background task failed', {
        chatId,
        userId,
        error,
      })
    }

    if (!summaryFailure) {
      return
    }

    const summaryWarningUpdate: MessageUpdate = {
      debug_info: appendSummaryWarningToDebugInfo(debugInfo, summaryFailure) as Json,
    }
    const { error: summaryWarningError } = await supabase
      .from('messages')
      .update(summaryWarningUpdate as never)
      .eq('id', assistantMessageId)
      .eq('chat_id', chatId)

    if (summaryWarningError) {
      console.warn('[Chat Job Runner] Failed to persist summary warning', {
        chatId,
        userId,
        assistantMessageId,
        error: summaryWarningError.message,
      })
    }
  })()
}

export async function runPostGenerationPipeline({
  supabase,
  chatId,
  userId,
  apiKeyId,
  provider,
  modelName,
  origin,
  requestId,
  assistantText,
  assistantMessageId,
  turnId,
  regenerateAssistantMessageId,
  promptTokens,
  completionTokens,
  debugInfo,
  bilingualEnabled,
  messageInsertDuration,
  usage,
  usageCost,
  triggerMessageTranslationFn,
  resolveSummaryModelPreferenceFn = resolveSummaryModelPreference,
  triggerSummaryGenerationFn = triggerSummaryGeneration,
  now = () => performance.now(),
}: RunPostGenerationPipelineArgs): Promise<PostGenerationPipelineResult> {
  if (regenerateAssistantMessageId && !turnId) {
    const { error: regenerationDeleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', regenerateAssistantMessageId)
      .eq('chat_id', chatId)
      .eq('user_id', userId)

    if (regenerationDeleteError) {
      throw new Error('Failed to remove assistant message for regeneration')
    }
  }

  let finalAssistantMessageId = assistantMessageId
  let finalMessageInsertDuration = messageInsertDuration
  let previousActiveAssistantId: string | null = null
  let nextVariantIndex: number | null = null
  let insertedAssistantInPipeline = false
  let activeAssistantPointerUpdated = false
  let previousAssistantSuperseded = false

  if (turnId) {
    const { data: turnState, error: turnStateError } = await supabase
      .from('chat_turns')
      .select('id, active_assistant_message_id')
      .eq('id', turnId)
      .eq('chat_id', chatId)
      .single<TurnStateRow>()

    if (turnStateError || !turnState) {
      throw new Error('Failed to load chat turn for assistant finalization')
    }

    previousActiveAssistantId = turnState.active_assistant_message_id
    if (
      regenerateAssistantMessageId &&
      previousActiveAssistantId !== regenerateAssistantMessageId
    ) {
      throw new Error('Regeneration target is no longer the active assistant message')
    }

    const { data: latestVariant, error: latestVariantError } = await supabase
      .from('messages')
      .select('id, variant_index')
      .eq('turn_id', turnId)
      .eq('role', 'assistant')
      .order('variant_index', { ascending: false })
      .limit(1)
      .maybeSingle<AssistantVariantRow>()

    if (latestVariantError && latestVariantError.code !== 'PGRST116') {
      throw new Error('Failed to load current assistant variants for turn')
    }

    nextVariantIndex = (latestVariant?.variant_index ?? 0) + 1
  }

  if (!finalAssistantMessageId) {
    const insertStart = now()
    const messageInsert: MessageInsert = {
      chat_id: chatId,
      role: 'assistant',
      content: assistantText,
      model_used: modelName,
      turn_id: turnId,
      variant_index: nextVariantIndex,
      supersedes_message_id: previousActiveAssistantId,
      message_status: turnId ? MESSAGE_STATUS_GENERATING : MESSAGE_STATUS_COMPLETED,
      user_id: userId,
    }
    const { data: insertedMessage, error: messageInsertError } = await supabase
      .from('messages')
      .insert(messageInsert as never)
      .select('id')
      .single<MessageIdRow>()

    finalMessageInsertDuration = now() - insertStart

    if (messageInsertError || !insertedMessage) {
      throw new Error('Failed to insert assistant message')
    }

    finalAssistantMessageId = insertedMessage.id
    insertedAssistantInPipeline = true
  }

  if (!finalAssistantMessageId) {
    throw new Error('Failed to resolve assistant message id')
  }

  try {
    const assistantFinalizeUpdate: MessageUpdate = {
      content: assistantText,
      model_used: modelName,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      debug_info: debugInfo as Json,
      turn_id: turnId,
      variant_index: nextVariantIndex,
      supersedes_message_id: previousActiveAssistantId,
      message_status: MESSAGE_STATUS_COMPLETED,
      user_id: userId,
    }
    const { error: assistantFinalizeError } = await supabase
      .from('messages')
      .update(assistantFinalizeUpdate as never)
      .eq('id', finalAssistantMessageId)
      .eq('chat_id', chatId)

    if (assistantFinalizeError) {
      throw new Error(
        `Failed to update assistant message content: ${assistantFinalizeError.message}`,
      )
    }

    if (turnId) {
      const { error: activeAssistantUpdateError } = await supabase
        .from('chat_turns')
        .update({ active_assistant_message_id: finalAssistantMessageId } as never)
        .eq('id', turnId)
        .eq('chat_id', chatId)

      if (activeAssistantUpdateError) {
        throw new Error('Failed to update active assistant variant for turn')
      }
      activeAssistantPointerUpdated = true

      if (previousActiveAssistantId && previousActiveAssistantId !== finalAssistantMessageId) {
        const supersedeUpdate: MessageUpdate = {
          message_status: MESSAGE_STATUS_SUPERSEDED,
        }
        const { error: supersedeError } = await supabase
          .from('messages')
          .update(supersedeUpdate as never)
          .eq('id', previousActiveAssistantId)
          .eq('chat_id', chatId)

        if (supersedeError) {
          throw new Error('Failed to supersede previous assistant variant')
        }
        previousAssistantSuperseded = true
      }
    }
  } catch (error) {
    if (turnId && activeAssistantPointerUpdated) {
      await supabase
        .from('chat_turns')
        .update({ active_assistant_message_id: previousActiveAssistantId } as never)
        .eq('id', turnId)
        .eq('chat_id', chatId)
    }

    if (previousAssistantSuperseded && previousActiveAssistantId) {
      await supabase
        .from('messages')
        .update({ message_status: MESSAGE_STATUS_COMPLETED } as never)
        .eq('id', previousActiveAssistantId)
        .eq('chat_id', chatId)
    }

    if (insertedAssistantInPipeline) {
      await supabase
        .from('messages')
        .delete()
        .eq('id', finalAssistantMessageId)
        .eq('chat_id', chatId)
    }

    throw error
  }

  if (bilingualEnabled) {
    triggerMessageTranslationFn(finalAssistantMessageId, userId)
  }

  const apiKeyUpdate: ApiKeyUpdate = { last_used_at: new Date().toISOString() }
  const { error: apiKeyUpdateError } = await supabase
    .from('api_keys')
    .update(apiKeyUpdate as never)
    .eq('id', apiKeyId)

  if (apiKeyUpdateError) {
    logPostGenerationPersistenceWarning({
      action: '[Chat Job Runner] Failed to update api key last_used_at',
      chatId,
      userId,
      apiKeyId,
      requestId,
      error: apiKeyUpdateError.message,
    })
  }

  const usageEventInsertStart = now()
  const usageEvent = buildChatUsageEvent({
    userId,
    chatId,
    apiKeyId,
    provider,
    modelName,
    usage,
    usageCost,
    requestId,
  })
  const { error: usageEventInsertError } = await supabase
    .from('chat_usage_events')
    .insert(usageEvent as never)
  const usageEventInsertDurationMs = now() - usageEventInsertStart

  if (usageEventInsertError) {
    logPostGenerationPersistenceWarning({
      action: '[Chat Job Runner] Failed to insert chat usage event',
      chatId,
      userId,
      apiKeyId,
      requestId,
      error: usageEventInsertError.message,
    })
  }

  // Summary generation is best-effort and should not block the chat worker.
  scheduleSummaryGeneration({
    supabase,
    chatId,
    userId,
    apiKeyId,
    provider,
    modelName,
    origin,
    assistantMessageId: finalAssistantMessageId,
    debugInfo,
    resolveSummaryModelPreferenceFn,
    triggerSummaryGenerationFn,
    now,
  })

  return {
    assistantMessageId: finalAssistantMessageId,
    messageInsertDuration: finalMessageInsertDuration,
    usageEventInsertDurationMs,
    summaryTriggerDurationMs: 0,
  }
}
