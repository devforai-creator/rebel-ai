import { generateText, type LanguageModel } from 'ai'
import { resolveActiveLlmConfigForUser } from '@/lib/chat/llm-config-resolver'
import { createLanguageModelFromSecretConfig } from '@/lib/llm/language-model-access'
import { TRANSLATION_SYSTEM_PROMPT } from '@/lib/chat/bilingual-context'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ApiKeyUpdate, MessageUpdate, Profile } from '@/types/database.types'

type TranslationSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from'>
type TranslationAdminSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'rpc'>
type TranslationProfileRow = Pick<Profile, 'translation_api_key_id'>

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

  const resolvedConfig = await resolveActiveLlmConfigForUser({
    supabase,
    userId,
    apiKeyId,
    defaultModelMode: 'lightweight',
  })

  if (resolvedConfig.status === 'missing_api_key') {
    return { status: 'invalid_api_key', apiKeyId }
  }

  if (resolvedConfig.status === 'unsupported_provider') {
    return {
      status: 'translation_error',
      error: new Error(`Unsupported provider: ${resolvedConfig.provider}`),
    }
  }

  let model: LanguageModel
  try {
    const adminSupabase = getAdminClient()
    model = await createLanguageModelFromSecretConfig({
      supabase: adminSupabase,
      config: resolvedConfig.config,
      requester: userId,
      logPrefix: '[Translate]',
    })
  } catch (error) {
    return { status: 'vault_error', error }
  }

  let translatedText: string
  try {
    const { text } = await generateText({
      model,
      system: TRANSLATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }],
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
    .eq('id', resolvedConfig.config.apiKeyId)

  return { status: 'success', content: translatedText }
}
