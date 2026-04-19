import type { ApiKey } from '@/types/database.types'

export type ChatSelectableApiKeyOption = Pick<
  ApiKey,
  'id' | 'key_name' | 'provider' | 'model_preference'
>

export type ChatRuntimeApiKeyOption = ChatSelectableApiKeyOption & {
  service_tier: ApiKey['service_tier'] | null
}

export const CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS = 'id, key_name, provider, model_preference'
export const CHAT_RUNTIME_API_KEY_OPTION_COLUMNS = `${CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS}, service_tier`

export function formatChatApiKeyOptionLabel(
  key: ChatSelectableApiKeyOption,
  options: {
    includeModelPreference?: boolean
    prefix?: string
    extraProviderDetail?: string | null
  } = {},
): string {
  const providerDetails = [key.provider, options.extraProviderDetail]
    .filter((detail): detail is string => Boolean(detail))
    .join(' · ')
  const prefix = options.prefix ? `${options.prefix}: ` : ''
  const modelPreferenceSuffix =
    options.includeModelPreference && key.model_preference ? ` - ${key.model_preference}` : ''

  return `${prefix}${key.key_name} (${providerDetails})${modelPreferenceSuffix}`
}
