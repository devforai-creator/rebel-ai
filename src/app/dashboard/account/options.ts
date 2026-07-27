import type { LlmModelOption } from '@/lib/llm/model-selection'
import type { ApiKey, LlmProvider } from '@/types/database.types'

export type SelectableLlmApiKey = Pick<ApiKey, 'id' | 'key_name' | 'model_preference'> & {
  provider: LlmProvider
  service_tier: ApiKey['service_tier'] | null
}

export type VoyageEmbeddingsKeyOption = Pick<ApiKey, 'id' | 'key_name' | 'is_active'>

export function formatSelectableLlmModelLabel(option: LlmModelOption<SelectableLlmApiKey>): string {
  const serviceTier = option.credential.service_tier ? ` · ${option.credential.service_tier}` : ''
  return `${option.displayName} · ${option.credential.key_name} · ${option.credential.provider}${serviceTier}`
}
