import { generateText } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model-factory'
import { getDefaultModelForProvider } from '@/lib/models'
import { getDecryptedSecret } from '@/lib/supabase/rpc'
import { TRANSLATION_SYSTEM_PROMPT } from '@/lib/chat/bilingual-context'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ApiKey, ApiKeyUpdate, MessageUpdate, Profile } from '@/types/database.types'

type TranslationSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from'>
type TranslationAdminSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'rpc'>
type TranslationProfileRow = Pick<Profile, 'translation_api_key_id'>
type TranslationApiKeyRow = Pick<
  ApiKey,
  'id' | 'provider' | 'vault_secret_name' | 'model_preference' | 'service_tier'
>

export type TranslationResult =
  | { status: 'success'; content: string }
  | { status: 'missing_profile' }
  | { status: 'missing_api_key' }
  | { status: 'invalid_api_key'; apiKeyId?: string }
  | { status: 'vault_error'; error: unknown }
  | { status: 'translation_error'; error: unknown }
  | { status: 'save_error'; error: unknown }

type TranslationRequest = {
  supabase: TranslationSupabaseClient
  getAdminClient: () => TranslationAdminSupabaseClient
  userId: string
  messageId: string
  messageContent: string
  trimOutput: boolean
}

export async function translateMessageForUser({
  supabase,
  getAdminClient,
  userId,
  messageId,
  messageContent,
  trimOutput,
}: TranslationRequest): Promise<TranslationResult> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select<'translation_api_key_id'>('translation_api_key_id')
    .eq('id', userId)
    .single<TranslationProfileRow>()

  if (profileError || !profile) {
    return { status: 'missing_profile' }
  }

  if (!profile.translation_api_key_id) {
    return { status: 'missing_api_key' }
  }

  const apiKeyId = profile.translation_api_key_id

  const { data: apiKeyData, error: apiKeyError } = await supabase
    .from('api_keys')
    .select<'id, provider, vault_secret_name, model_preference, service_tier'>(
      'id, provider, vault_secret_name, model_preference, service_tier',
    )
    .eq('id', apiKeyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single<TranslationApiKeyRow>()

  if (apiKeyError || !apiKeyData) {
    return { status: 'invalid_api_key', apiKeyId }
  }

  let decryptedApiKey: string
  try {
    const adminSupabase = getAdminClient()
    decryptedApiKey = await decryptSecret({
      supabase: adminSupabase,
      secretName: apiKeyData.vault_secret_name,
      requester: userId,
    })
  } catch (error) {
    return { status: 'vault_error', error }
  }

  let translatedText: string
  try {
    const model = buildLanguageModel({
      provider: apiKeyData.provider,
      modelName:
        apiKeyData.model_preference ??
        getDefaultModelForProvider(apiKeyData.provider, { lightweight: true }),
      apiKey: decryptedApiKey,
      serviceTier: apiKeyData.service_tier,
    })

    const { text } = await generateText({
      model,
      system: TRANSLATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }],
      temperature: 0.3,
    })

    translatedText = trimOutput ? text.trim() : text
  } catch (error) {
    return { status: 'translation_error', error }
  }

  const messageUpdate: MessageUpdate = { content_en: translatedText }
  const { error: updateError } = await supabase
    .from('messages')
    .update(messageUpdate as never)
    .eq('id', messageId)
    .eq('user_id', userId)

  if (updateError) {
    return { status: 'save_error', error: updateError }
  }

  const apiKeyUpdate: ApiKeyUpdate = { last_used_at: new Date().toISOString() }
  await supabase
    .from('api_keys')
    .update(apiKeyUpdate as never)
    .eq('id', apiKeyData.id)

  return { status: 'success', content: translatedText }
}

async function decryptSecret({
  supabase,
  secretName,
  requester,
}: {
  supabase: TranslationAdminSupabaseClient
  secretName: string
  requester: string
}): Promise<string> {
  const rpcArgs = {
    secret_name: secretName,
    requester,
  }
  const { data, error } = await getDecryptedSecret(supabase, rpcArgs)

  if (error) {
    console.error('[Translate] Vault decryption failed:', error)
    throw new Error('Vault decryption failed')
  }

  if (!data) {
    throw new Error('Vault returned empty secret')
  }
  return data
}
