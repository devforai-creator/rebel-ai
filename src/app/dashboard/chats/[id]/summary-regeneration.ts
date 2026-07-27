import { resolveActiveLlmConfigForUser } from '@/lib/chat/llm-config-resolver'
import { resolveSummaryModelPreference } from '@/lib/chat/summary-model-preference'
import { readApiErrorMessage } from '@/lib/http/api-contract'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import type { createClient } from '@/lib/supabase/server'
import type { LlmProvider } from '@/types/database.types'

type SummaryActionSupabase = Awaited<ReturnType<typeof createClient>>

export type SummaryRegenerationModelConfig = {
  provider: LlmProvider
  modelName: string
  apiKeyId: string
}

export function buildSummaryRegenerationPayload(summary: {
  level: number
  start_seq: number
  end_seq: number
}): { regenerate: Record<string, unknown> } | { error: string } {
  if (summary.level === 0) {
    return {
      regenerate: {
        chunkRanges: [{ startSeq: summary.start_seq, endSeq: summary.end_seq }],
      },
    }
  }

  if (summary.level === 1) {
    return {
      regenerate: {
        metaRanges: [{ startSeq: summary.start_seq, endSeq: summary.end_seq }],
      },
    }
  }

  return { error: 'This summary type does not support regeneration.' }
}

export function buildFactRegenerationPayload(fact: {
  start_seq: number
  end_seq: number
}): Record<string, unknown> {
  return {
    factRanges: [{ startSeq: fact.start_seq, endSeq: fact.end_seq }],
  }
}

export async function resolveSummaryRegenerationModelConfig(
  supabase: SummaryActionSupabase,
  chatId: string,
  userId: string,
): Promise<SummaryRegenerationModelConfig | { error: string }> {
  const summaryPreference = await resolveSummaryModelPreference({ supabase, userId })
  if (summaryPreference) {
    return summaryPreference
  }

  const { data: usage, error: usageError } = await supabase
    .from('chat_usage_events')
    .select('api_key_id, model_provider, model_name')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      api_key_id: string | null
      model_provider: string | null
      model_name: string | null
    }>()

  if (usageError) {
    console.error('[Summary Actions] Failed to resolve usage event', usageError)
  }

  if (!usage || !usage.api_key_id) {
    return {
      error: 'Could not find a recently used API key. Please run a chat first and try again.',
    }
  }

  const resolvedConfig = await resolveActiveLlmConfigForUser({
    supabase,
    userId,
    apiKeyId: usage.api_key_id,
  })

  if (resolvedConfig.status === 'missing_api_key') {
    return { error: 'Could not find an active API key for regeneration.' }
  }

  if (resolvedConfig.status === 'unsupported_provider') {
    return { error: 'Could not find an active LLM API key for regeneration.' }
  }

  if (resolvedConfig.status === 'unsupported_model') {
    return { error: 'Could not find a supported model for regeneration.' }
  }

  const modelName =
    usage.model_provider === resolvedConfig.config.provider && usage.model_name
      ? usage.model_name
      : resolvedConfig.config.modelName

  return {
    provider: resolvedConfig.config.provider,
    modelName,
    apiKeyId: resolvedConfig.config.apiKeyId,
  }
}

export async function requestSummaryRegeneration({
  chatId,
  userId,
  provider,
  modelName,
  apiKeyId,
  regenerate,
}: SummaryRegenerationModelConfig & {
  chatId: string
  userId: string
  regenerate: Record<string, unknown>
}): Promise<{ success: true } | { error: string }> {
  const summarySecret = process.env.SUMMARY_GENERATION_SECRET

  if (!summarySecret) {
    console.error('[Summary Actions] SUMMARY_GENERATION_SECRET is not configured')
    return { error: 'Cannot proceed with regeneration due to server configuration error.' }
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${summarySecret}`,
  }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  let response: Response
  try {
    response = await fetch(buildInternalApiUrl('/api/summaries/generate'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chatId,
        userId,
        provider,
        modelName,
        apiKeyId,
        regenerate,
      }),
      cache: 'no-store',
    })
  } catch (error) {
    console.error('[Summary Actions] Failed to call summaries endpoint', error)
    return { error: 'Failed to request summary regeneration.' }
  }

  if (!response.ok) {
    const message = await readApiErrorMessage(
      response,
      'An error occurred during summary regeneration.',
    )
    console.error('[Summary Actions] Summaries endpoint returned an error', {
      status: response.status,
      body: message,
    })
    return { error: message || 'An error occurred during summary regeneration.' }
  }

  return { success: true }
}
