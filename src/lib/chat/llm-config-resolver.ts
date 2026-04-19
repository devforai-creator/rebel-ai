import type { SupabaseClient } from '@supabase/supabase-js'
import { isKnownLLMProvider } from '@/lib/api-keys/provider-utils'
import { getDefaultModelForProvider } from '@/lib/models'
import type { ApiServiceTier, Database, LlmProvider } from '@/types/database.types'

type LlmConfigSupabaseClient = Pick<SupabaseClient<Database>, 'from'>

type StoredActiveApiKeyRow = {
  id: string
  provider: string
  model_preference: string | null
  service_tier: ApiServiceTier | null
  vault_secret_name: string
}

export type ResolvedLlmConfig = {
  apiKeyId: string
  provider: LlmProvider
  modelName: string
  serviceTier: ApiServiceTier | null
  vaultSecretName: string
}

type DefaultModelMode = 'default' | 'lightweight'

export type ResolveActiveLlmConfigResult =
  | {
      status: 'success'
      config: ResolvedLlmConfig
    }
  | {
      status: 'missing_api_key'
      errorMessage?: string
    }
  | {
      status: 'unsupported_provider'
      provider: string
    }

function normalizeConfiguredModelName(modelName?: string | null): string | null {
  if (typeof modelName !== 'string') {
    return null
  }

  const trimmed = modelName.trim()
  return trimmed ? trimmed : null
}

export async function resolveActiveLlmConfigForUser({
  supabase,
  userId,
  apiKeyId,
  preferredModelName,
  defaultModelMode = 'default',
}: {
  supabase: LlmConfigSupabaseClient
  userId: string
  apiKeyId: string
  preferredModelName?: string | null
  defaultModelMode?: DefaultModelMode
}): Promise<ResolveActiveLlmConfigResult> {
  const { data: apiKeyRow, error: apiKeyError } = await supabase
    .from('api_keys')
    .select<'id, provider, model_preference, service_tier, vault_secret_name'>(
      'id, provider, model_preference, service_tier, vault_secret_name',
    )
    .eq('id', apiKeyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single<StoredActiveApiKeyRow>()

  if (apiKeyError || !apiKeyRow) {
    return {
      status: 'missing_api_key',
      errorMessage: apiKeyError?.message,
    }
  }

  if (!isKnownLLMProvider(apiKeyRow.provider)) {
    return {
      status: 'unsupported_provider',
      provider: apiKeyRow.provider,
    }
  }

  const modelName =
    normalizeConfiguredModelName(preferredModelName) ??
    normalizeConfiguredModelName(apiKeyRow.model_preference) ??
    getDefaultModelForProvider(
      apiKeyRow.provider,
      defaultModelMode === 'lightweight' ? { lightweight: true } : {},
    )

  return {
    status: 'success',
    config: {
      apiKeyId: apiKeyRow.id,
      provider: apiKeyRow.provider,
      modelName,
      serviceTier: apiKeyRow.service_tier ?? null,
      vaultSecretName: apiKeyRow.vault_secret_name,
    },
  }
}
