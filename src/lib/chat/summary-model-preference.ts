import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveActiveLlmConfigForUser } from '@/lib/chat/llm-config-resolver'
import type { Database, LlmProvider } from '@/types/database.types'

export type SummaryModelConfig = {
  provider: LlmProvider
  modelName: string
  apiKeyId: string
}

export async function resolveSummaryModelPreference({
  supabase,
  userId,
}: {
  supabase: SupabaseClient<Database>
  userId: string
}): Promise<SummaryModelConfig | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select<'summary_api_key_id'>('summary_api_key_id')
    .eq('id', userId)
    .maybeSingle<{ summary_api_key_id: string | null }>()

  if (profileError) {
    console.error('[Summary Model] Failed to load profile preference', {
      userId,
      error: profileError.message,
    })
    return null
  }

  const summaryKeyId = profile?.summary_api_key_id
  if (!summaryKeyId) {
    return null
  }

  const resolvedConfig = await resolveActiveLlmConfigForUser({
    supabase,
    userId,
    apiKeyId: summaryKeyId,
  })

  if (resolvedConfig.status === 'missing_api_key') {
    console.warn('[Summary Model] Stored summary API key is not available', {
      userId,
      summaryKeyId,
      error: resolvedConfig.errorMessage,
    })
    return null
  }

  if (resolvedConfig.status === 'unsupported_provider') {
    console.warn('[Summary Model] Stored summary API key uses unsupported provider', {
      userId,
      summaryKeyId,
      provider: resolvedConfig.provider,
    })
    return null
  }

  return {
    provider: resolvedConfig.config.provider,
    modelName: resolvedConfig.config.modelName,
    apiKeyId: resolvedConfig.config.apiKeyId,
  }
}
