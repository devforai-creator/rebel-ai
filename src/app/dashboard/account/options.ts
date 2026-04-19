import type { ApiKey } from '@/types/database.types'

export type SelectableLlmApiKey = Pick<
  ApiKey,
  'id' | 'key_name' | 'provider' | 'model_preference'
> & {
  service_tier: ApiKey['service_tier'] | null
}

export type VoyageEmbeddingsKeyOption = Pick<ApiKey, 'id' | 'key_name' | 'is_active'>

export function formatSelectableLlmApiKeyLabel(key: SelectableLlmApiKey): string {
  const modelInfo = key.model_preference ? key.model_preference : 'No model set'
  const serviceTier = key.service_tier ? ` · ${key.service_tier}` : ''
  return `${key.key_name} · ${key.provider}${serviceTier} · ${modelInfo}`
}
