import type { SupabaseClient } from '@supabase/supabase-js'
import { isKnownLLMProvider } from '@/lib/api-keys/provider-utils'
import { getDefaultModelForProvider } from '@/lib/llm/default-model'
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

  const { data: apiKey, error: apiKeyError } = await supabase
    .from('api_keys')
    .select<'id, provider, model_preference, is_active'>(
      'id, provider, model_preference, is_active',
    )
    .eq('id', summaryKeyId)
    .eq('user_id', userId)
    .maybeSingle<{
      id: string
      provider: string
      model_preference: string | null
      is_active: boolean
    }>()

  if (apiKeyError || !apiKey) {
    console.warn('[Summary Model] Stored summary API key is not available', {
      userId,
      summaryKeyId,
      error: apiKeyError?.message,
    })
    return null
  }

  if (!apiKey.is_active) {
    console.warn('[Summary Model] Stored summary API key is inactive', {
      userId,
      summaryKeyId,
    })
    return null
  }

  if (!isKnownLLMProvider(apiKey.provider)) {
    console.warn('[Summary Model] Stored summary API key uses unsupported provider', {
      userId,
      summaryKeyId,
      provider: apiKey.provider,
    })
    return null
  }

  const modelName = apiKey.model_preference || getDefaultModelForProvider(apiKey.provider)

  return {
    provider: apiKey.provider,
    modelName,
    apiKeyId: apiKey.id,
  }
}
