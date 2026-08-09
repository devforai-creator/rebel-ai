import { streamText } from 'ai'
import { resolveActiveLlmConfigForUser } from '@/lib/chat/llm-config-resolver'
import { CHAT_REPROCESS_LIMITS } from '@/lib/chat/runtime-limits'
import { createLanguageModelFromSecretConfig } from '@/lib/llm/language-model-access'
import { LLM_OUTPUT_LIMITS } from '@/lib/llm/output-limits'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { createClient } from '@/lib/supabase/server'

type ReprocessSupabaseClient = Awaited<ReturnType<typeof createClient>>
type ReprocessAdminSupabaseClient = ReturnType<typeof createAdminClient>

function buildReprocessedMessageUpdate(content: string) {
  return {
    content,
    // Invalidate stale derived bilingual cache whenever the canonical text changes.
    content_en: null,
  }
}

export type ReprocessAssistantMessageResult =
  | { status: 'success'; content: string }
  | { status: 'message_not_found' }
  | { status: 'forbidden' }
  | { status: 'not_assistant' }
  | { status: 'profile_not_found' }
  | { status: 'settings_not_configured' }
  | { status: 'api_key_not_found' }
  | { status: 'unsupported_provider' }
  | { status: 'unsupported_model' }
  | { status: 'decrypt_failed' }
  | { status: 'save_failed' }
  | { status: 'reprocess_failed' }

export async function reprocessAssistantMessageForUser({
  supabase,
  getAdminClient,
  userId,
  messageId,
}: {
  supabase: ReprocessSupabaseClient
  getAdminClient: () => ReprocessAdminSupabaseClient
  userId: string
  messageId: string
}): Promise<ReprocessAssistantMessageResult> {
  const { data: message, error: messageError } = await supabase
    .from('messages')
    .select('id, chat_id, role, content, user_id')
    .eq('id', messageId)
    .single()

  if (messageError || !message) {
    return { status: 'message_not_found' }
  }

  if (message.user_id !== userId) {
    return { status: 'forbidden' }
  }

  if (message.role !== 'assistant') {
    return { status: 'not_assistant' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('reprocess_prompt, reprocess_api_key_id, reprocess_model_name')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    return { status: 'profile_not_found' }
  }

  if (!profile.reprocess_prompt || !profile.reprocess_api_key_id) {
    return { status: 'settings_not_configured' }
  }

  const resolvedConfig = await resolveActiveLlmConfigForUser({
    supabase,
    userId,
    apiKeyId: profile.reprocess_api_key_id,
    preferredModelName: profile.reprocess_model_name,
    defaultModelMode: 'lightweight',
  })

  if (resolvedConfig.status === 'missing_api_key') {
    return { status: 'api_key_not_found' }
  }

  if (resolvedConfig.status === 'unsupported_provider') {
    return { status: 'unsupported_provider' }
  }

  if (resolvedConfig.status === 'unsupported_model') {
    return { status: 'unsupported_model' }
  }

  let model
  try {
    model = await createLanguageModelFromSecretConfig({
      supabase: getAdminClient(),
      config: resolvedConfig.config,
      requester: userId,
      logPrefix: '[Reprocess]',
    })
  } catch {
    return { status: 'decrypt_failed' }
  }

  try {
    const stream = await streamText({
      model,
      system: profile.reprocess_prompt,
      messages: [{ role: 'user', content: message.content }],
      maxOutputTokens: LLM_OUTPUT_LIMITS.utility,
    })

    let fullText = ''
    let lastUpdateAt = 0
    let updateInFlight: Promise<void> | null = null
    let updateError: Error | null = null
    let queuedUpdateContent: string | null = null

    const enqueueMessageUpdate = (content: string) => {
      if (updateError) {
        return
      }
      if (updateInFlight) {
        queuedUpdateContent = content
        return
      }

      const contentSnapshot = content
      updateInFlight = (async () => {
        const { error: messageUpdateError } = await supabase
          .from('messages')
          .update(buildReprocessedMessageUpdate(contentSnapshot))
          .eq('id', messageId)
          .eq('user_id', userId)

        if (messageUpdateError) {
          throw new Error(`Failed to update message content: ${messageUpdateError.message}`)
        }
      })()
        .catch((error) => {
          updateError = error instanceof Error ? error : new Error(String(error))
        })
        .finally(() => {
          updateInFlight = null
          if (queuedUpdateContent && !updateError) {
            const nextContent = queuedUpdateContent
            queuedUpdateContent = null
            enqueueMessageUpdate(nextContent)
          } else {
            queuedUpdateContent = null
          }
        })
    }

    const flushMessageUpdates = async () => {
      if (updateError) {
        throw updateError
      }
      while (updateInFlight) {
        await updateInFlight
        if (updateError) {
          throw updateError
        }
      }
    }

    for await (const chunk of stream.textStream) {
      if (updateError) {
        throw updateError
      }
      fullText += chunk
      const now = Date.now()

      if (now - lastUpdateAt >= CHAT_REPROCESS_LIMITS.streamUpdateIntervalMs) {
        enqueueMessageUpdate(fullText)
        lastUpdateAt = now
      }
    }

    enqueueMessageUpdate(fullText)
    await flushMessageUpdates()

    const { error: finalUpdateError } = await supabase
      .from('messages')
      .update({
        ...buildReprocessedMessageUpdate(fullText),
        model_used: resolvedConfig.config.modelName,
      })
      .eq('id', messageId)
      .eq('user_id', userId)

    if (finalUpdateError) {
      console.error('[Reprocess] Final update failed:', finalUpdateError)
      return { status: 'save_failed' }
    }

    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', resolvedConfig.config.apiKeyId)

    return { status: 'success', content: fullText }
  } catch (error) {
    console.error('[Reprocess] Streaming failed:', error)
    return { status: 'reprocess_failed' }
  }
}
