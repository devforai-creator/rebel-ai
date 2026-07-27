import type { ApiKey, LlmProvider } from '@/types/database.types'
import type { LlmModelOption } from '@/lib/llm/model-selection'

export type ChatSelectableApiKeyOption = Omit<
  Pick<ApiKey, 'id' | 'key_name' | 'provider' | 'model_preference'>,
  'provider'
> & {
  provider: LlmProvider
}

export type ChatRuntimeApiKeyOption = ChatSelectableApiKeyOption & {
  service_tier: ApiKey['service_tier'] | null
}

export const CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS = 'id, key_name, provider, model_preference'
export const CHAT_RUNTIME_API_KEY_OPTION_COLUMNS = `${CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS}, service_tier`

export function formatChatCredentialLabel(
  key: ChatSelectableApiKeyOption,
  options: {
    extraProviderDetail?: string | null
  } = {},
): string {
  const providerDetails = [key.provider, options.extraProviderDetail]
    .filter((detail): detail is string => Boolean(detail))
    .join(' · ')

  return `${key.key_name} (${providerDetails})`
}

export function formatChatModelOptionLabel(
  option: LlmModelOption<ChatSelectableApiKeyOption>,
  options: {
    prefix?: string
    extraProviderDetail?: string | null
  } = {},
): string {
  const prefix = options.prefix ? `${options.prefix}: ` : ''
  return `${prefix}${option.displayName} · ${formatChatCredentialLabel(option.credential, {
    extraProviderDetail: options.extraProviderDetail,
  })}`
}
