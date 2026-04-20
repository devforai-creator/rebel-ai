'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { hasPersistableChatModelConfig, normalizeChatModelConfig } from '@/lib/chat/model-config'

function hasOwnModelConfigKey(input: unknown, key: string): boolean {
  return !!input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, key)
}

export async function updateChatPersona(chatId: string, personaId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required' }
  }

  // 1. Verify ownership of the chat
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (chatError || !chat) {
    return { error: 'Chat not found or access denied' }
  }

  // 2. Verify ownership of the persona
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single()

  if (personaError || !persona) {
    return { error: 'Persona not found or access denied' }
  }

  // 3. Update chat
  const { error: updateError } = await supabase
    .from('chats')
    .update({ persona_id: personaId })
    .eq('id', chatId)

  if (updateError) {
    return { error: 'Failed to update chat: ' + updateError.message }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}

export async function updateChatModelConfig(chatId: string, modelConfig: unknown) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required' }
  }

  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id, model_config')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single<{ id: string; model_config: unknown }>()

  if (chatError || !chat) {
    return { error: 'Chat not found or access denied' }
  }

  const normalizedInput = normalizeChatModelConfig(modelConfig)
  const existingNormalized = normalizeChatModelConfig(chat.model_config)
  const normalized = hasOwnModelConfigKey(modelConfig, 'experimental')
    ? normalizedInput
    : {
        ...normalizedInput,
        experimental: existingNormalized.experimental ?? undefined,
      }
  const hasConfig = hasPersistableChatModelConfig(normalized)

  const { error: updateError } = await supabase
    .from('chats')
    .update({ model_config: hasConfig ? normalized : null })
    .eq('id', chatId)

  if (updateError) {
    return { error: 'Failed to update chat: ' + updateError.message }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}
