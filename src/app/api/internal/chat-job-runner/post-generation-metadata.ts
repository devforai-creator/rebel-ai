import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ApiKeyUpdate, LlmProvider, MessageUpdate } from '@/types/database.types'
import { buildChatUsageEvent, type UsageMetrics } from './usage-debug'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>

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

function isUniqueViolation(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === '23505'
}

export async function clearStaleAssistantDebugInfo({
  supabase,
  chatId,
  userId,
  apiKeyId,
  requestId,
  retainedAssistantMessageId,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  userId: string
  apiKeyId: string
  requestId: string
  retainedAssistantMessageId: string
}): Promise<void> {
  const clearDebugInfoUpdate: MessageUpdate = {
    debug_info: null,
  }

  const { error } = await supabase
    .from('messages')
    .update(clearDebugInfoUpdate as never)
    .eq('chat_id', chatId)
    .eq('role', 'assistant')
    .eq('user_id', userId)
    .neq('id', retainedAssistantMessageId)
    .not('debug_info', 'is', null)

  if (error) {
    logPostGenerationPersistenceWarning({
      action: '[Chat Job Runner] Failed to clear stale assistant debug_info',
      chatId,
      userId,
      apiKeyId,
      requestId,
      error: error.message,
    })
  }
}

export async function recordPostGenerationMetadata({
  supabase,
  chatId,
  userId,
  apiKeyId,
  provider,
  modelName,
  requestId,
  usage,
  usageCost,
  now,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  userId: string
  apiKeyId: string
  provider: LlmProvider
  modelName: string
  requestId: string
  usage: UsageMetrics
  usageCost: UsageCostBreakdown | null
  now: () => number
}): Promise<{ usageEventInsertDurationMs: number }> {
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
    if (isUniqueViolation(usageEventInsertError)) {
      logPostGenerationDebug('[Chat Job Runner] Skipped duplicate chat usage event insert', {
        chatId,
        userId,
        apiKeyId,
        requestId,
      })
    } else {
      logPostGenerationPersistenceWarning({
        action: '[Chat Job Runner] Failed to insert chat usage event',
        chatId,
        userId,
        apiKeyId,
        requestId,
        error: usageEventInsertError.message,
      })
    }
  }

  return {
    usageEventInsertDurationMs,
  }
}
