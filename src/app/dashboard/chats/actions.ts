'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import { createChatTurn } from '@/lib/chat/turns'
import { buildOperatorDefaultChatModelConfig } from '@/lib/chat/model-config'
import { importChatForUser } from '@/lib/chat/import-service'
import { isKnownLLMProvider } from '@/lib/api-keys/provider-utils'
import type { LlmModelSelection } from '@/lib/llm/model-selection'
import { listUiModelIdsByProvider } from '@/lib/models'
import type { ChatImportResult } from '@/types/risu-chat'
import { getCharacterGreetingOptions } from './new/greeting-options'

export async function createChat({
  characterId,
  personaId,
  greetingIndex,
  modelSelection,
}: {
  characterId: string
  personaId?: string | null
  greetingIndex: number
  modelSelection: LlmModelSelection
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: '로그인이 필요합니다' }
  }

  const normalizedCharacterId = characterId.trim()
  if (!normalizedCharacterId) {
    return { error: '캐릭터를 찾을 수 없습니다' }
  }

  if (
    !modelSelection ||
    typeof modelSelection.apiKeyId !== 'string' ||
    typeof modelSelection.modelName !== 'string'
  ) {
    return { error: '사용할 모델을 선택해주세요' }
  }

  const normalizedPersonaId = personaId?.trim() || null
  const normalizedApiKeyId = modelSelection.apiKeyId.trim()
  const requestedModelName = modelSelection.modelName.trim()
  const safeGreetingIndex =
    Number.isInteger(greetingIndex) && greetingIndex >= 0 ? greetingIndex : 0

  if (!normalizedApiKeyId || !requestedModelName) {
    return { error: '사용할 모델을 선택해주세요' }
  }

  const [{ data: character, error: characterError }, personaResult, apiKeyResult] =
    await Promise.all([
      supabase
        .from('characters')
        .select('id, user_id, name, greeting_message, metadata, archived_at')
        .eq('id', normalizedCharacterId)
        .maybeSingle(),
      normalizedPersonaId
        ? supabase
            .from('personas')
            .select('id, user_id, name')
            .eq('id', normalizedPersonaId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('api_keys')
        .select('id, provider')
        .eq('id', normalizedApiKeyId)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle(),
    ])

  if (characterError && characterError.message !== 'No rows found') {
    return { error: '캐릭터를 불러오지 못했습니다' }
  }

  if (
    !character ||
    character.archived_at !== null ||
    (character.user_id !== user.id && character.user_id !== null)
  ) {
    return { error: '캐릭터를 찾을 수 없습니다' }
  }

  if (personaResult.error && personaResult.error.message !== 'No rows found') {
    return { error: '페르소나를 불러오지 못했습니다' }
  }

  const persona = personaResult.data
  if (normalizedPersonaId && (!persona || persona.user_id !== user.id)) {
    return { error: '페르소나를 찾을 수 없습니다' }
  }

  const selectedApiKey = apiKeyResult.data
  if (
    apiKeyResult.error ||
    !selectedApiKey ||
    typeof selectedApiKey.provider !== 'string' ||
    !isKnownLLMProvider(selectedApiKey.provider)
  ) {
    return { error: '선택한 API 키를 사용할 수 없습니다' }
  }

  const selectedModelName = listUiModelIdsByProvider(selectedApiKey.provider).find(
    (modelName) => modelName.toLowerCase() === requestedModelName.toLowerCase(),
  )
  if (!selectedModelName) {
    return { error: '선택한 모델을 사용할 수 없습니다' }
  }

  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .insert({
      user_id: user.id,
      character_id: character.id,
      persona_id: persona?.id ?? null,
      title: `${character.name}와의 대화`,
      model_config: buildOperatorDefaultChatModelConfig({
        alternateModels: {
          enabled: false,
          primaryApiKeyId: normalizedApiKeyId,
          primaryModelName: selectedModelName,
          secondaryApiKeyId: null,
          secondaryModelName: null,
        },
      }),
    })
    .select('id')
    .single()

  if (chatError || !chat) {
    return { error: '채팅 생성에 실패했습니다' }
  }

  const currentGreeting = getCharacterGreetingOptions(character)[safeGreetingIndex] ?? null

  if (currentGreeting) {
    const userName = persona?.name || 'User'
    const processedGreeting = currentGreeting.replace(/\{\{user\}\}/g, userName)
    const greetingMessageId = crypto.randomUUID()
    const greetingTurnId = crypto.randomUUID()

    try {
      await createChatTurn({
        supabase,
        chatId: chat.id,
        userId: user.id,
        turnId: greetingTurnId,
        userMessageId: null,
        activeAssistantMessageId: greetingMessageId,
      })

      const { error: greetingInsertError } = await supabase.from('messages').insert({
        id: greetingMessageId,
        chat_id: chat.id,
        user_id: user.id,
        role: 'assistant',
        content: processedGreeting,
        turn_id: greetingTurnId,
        variant_index: 1,
        supersedes_message_id: null,
        message_status: MESSAGE_STATUS_COMPLETED,
      })

      if (greetingInsertError) {
        throw greetingInsertError
      }
    } catch {
      await supabase.from('chats').delete().eq('id', chat.id).eq('user_id', user.id)
      return { error: '채팅 생성에 실패했습니다' }
    }
  }

  revalidatePath(`/dashboard/characters/${character.id}`)

  return { chatId: chat.id }
}

export async function deleteChat(chatId: string, shouldRedirect: boolean = true) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required' }
  }

  // Verify ownership
  const { data: chat } = await supabase
    .from('chats')
    .select('id, user_id, character_id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    return { error: 'Chat not found or access denied' }
  }

  // Delete chat (related messages, summaries, etc. are auto-deleted via DB CASCADE)
  const { error } = await supabase.from('chats').delete().eq('id', chatId).eq('user_id', user.id)

  if (error) {
    return { error: 'Failed to delete chat: ' + error.message }
  }

  revalidatePath(`/dashboard/characters/${chat.character_id}`)

  if (shouldRedirect) {
    redirect(`/dashboard/characters/${chat.character_id}`)
  }

  return { success: true }
}

/**
 * Compatibility-only import path for archived RisuAI chat JSON.
 * RBX/SUU remains the primary product surface.
 */
export async function importChat(
  characterId: string,
  jsonContent: string,
  chatTitle?: string,
): Promise<ChatImportResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Login required' }
  }

  return importChatForUser({
    supabase,
    userId: user.id,
    characterId,
    jsonContent,
    chatTitle,
  })
}
