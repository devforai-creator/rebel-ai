import { isKnownLLMProvider } from '@/lib/api-keys/provider-utils'
import { hasMemoryUpdateWork, updateMemoryState } from '@/lib/chat-memory'
import { normalizeChatModelConfig } from '@/lib/chat/model-config'
import { createLanguageModelFromSecretConfig } from '@/lib/llm/language-model-access'
import type { RegenerateConfig } from '@/lib/chat-summaries/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ApiServiceTier } from '@/types/database.types'

type SummaryAdminSupabaseClient = ReturnType<typeof createAdminClient>

type ChatOwnership = {
  id: string
  user_id: string
  model_config: unknown
}

type ApiKeyRow = {
  id: string
  user_id: string
  provider: string
  model_preference: string | null
  vault_secret_name: string
  is_active: boolean
  service_tier: ApiServiceTier
}

export type GenerateSummariesForChatResult =
  | { status: 'success' }
  | { status: 'skipped_no_work' }
  | { status: 'chat_not_found' }
  | { status: 'forbidden' }
  | { status: 'summary_generation_failed' }
  | { status: 'api_key_not_found' }
  | { status: 'api_key_not_available' }
  | { status: 'api_key_misconfigured' }
  | { status: 'unsupported_provider'; provider: string }
  | { status: 'missing_model_name' }
  | { status: 'decrypt_failed' }

export async function generateSummariesForChat({
  supabase,
  chatId,
  userId,
  provider,
  modelName,
  apiKeyId,
  regenerate,
}: {
  supabase: SummaryAdminSupabaseClient
  chatId: string
  userId: string
  provider: string
  modelName: string
  apiKeyId: string
  regenerate?: RegenerateConfig
}): Promise<GenerateSummariesForChatResult> {
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id, user_id, model_config')
    .eq('id', chatId)
    .single<ChatOwnership>()

  if (chatError || !chat) {
    console.error('[Summaries API] Chat not found:', chatError?.message)
    return { status: 'chat_not_found' }
  }

  if (chat.user_id !== userId) {
    console.error(
      `[Summaries API] Ownership violation: user ${userId} attempted to access chat ${chatId} owned by ${chat.user_id}`,
    )
    return { status: 'forbidden' }
  }

  const modelConfig = normalizeChatModelConfig(chat.model_config)

  let hasWork: boolean
  try {
    hasWork = await hasMemoryUpdateWork({
      supabase,
      chatId,
      regenerate,
      modelConfig,
    })
  } catch (error) {
    console.error('[Summaries API] Failed to inspect summary work:', error)
    return { status: 'summary_generation_failed' }
  }

  if (!hasWork) {
    return { status: 'skipped_no_work' }
  }

  const { data: apiKeyRow, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('id, user_id, provider, model_preference, vault_secret_name, is_active, service_tier')
    .eq('id', apiKeyId)
    .single<ApiKeyRow>()

  if (apiKeyError || !apiKeyRow) {
    console.error('[Summaries API] API key lookup failed:', apiKeyError?.message)
    return { status: 'api_key_not_found' }
  }

  if (apiKeyRow.user_id !== userId || !apiKeyRow.is_active) {
    console.error('[Summaries API] API key ownership or status invalid', {
      apiKeyId,
      expectedUser: userId,
      owner: apiKeyRow.user_id,
      isActive: apiKeyRow.is_active,
    })
    return { status: 'api_key_not_available' }
  }

  if (!apiKeyRow.vault_secret_name) {
    console.error('[Summaries API] API key missing vault secret reference', { apiKeyId })
    return { status: 'api_key_misconfigured' }
  }

  const resolvedProvider = provider === apiKeyRow.provider ? provider : apiKeyRow.provider
  if (resolvedProvider !== provider) {
    console.warn('[Summaries API] Provider mismatch detected, falling back to stored provider', {
      payloadProvider: provider,
      storedProvider: apiKeyRow.provider,
    })
  }

  if (!isKnownLLMProvider(resolvedProvider)) {
    return { status: 'unsupported_provider', provider: resolvedProvider }
  }

  const resolvedModelName = modelName || apiKeyRow.model_preference || ''

  if (!resolvedModelName) {
    return { status: 'missing_model_name' }
  }

  let model
  try {
    model = await createLanguageModelFromSecretConfig({
      supabase,
      requester: userId,
      config: {
        provider: resolvedProvider,
        modelName: resolvedModelName,
        serviceTier: apiKeyRow.service_tier,
        vaultSecretName: apiKeyRow.vault_secret_name,
      },
      logPrefix: '[Summaries API]',
    })
  } catch {
    return { status: 'decrypt_failed' }
  }

  try {
    await updateMemoryState({
      supabase,
      chatId,
      userId,
      model,
      provider: resolvedProvider,
      modelName: resolvedModelName,
      regenerate,
      modelConfig,
    })
  } catch (error) {
    console.error('[Summaries API] Summary generation failed:', error)
    return { status: 'summary_generation_failed' }
  }

  return { status: 'success' }
}
