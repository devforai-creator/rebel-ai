'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import { buildTurnGraphForMessages } from '@/lib/chat/turns'
import { createChatTurn } from '@/lib/chat/turns'
import { parseRisuChatJson, fromRisuFormat, getMessageCount } from '@/lib/chat/risu-converter'
import { buildOperatorDefaultChatModelConfig } from '@/lib/chat/model-config'
import type { ChatImportResult } from '@/types/risu-chat'
import { getCharacterGreetingOptions } from './new/greeting-options'

export async function createChat({
  characterId,
  personaId,
  greetingIndex,
}: {
  characterId: string
  personaId?: string | null
  greetingIndex: number
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

  const normalizedPersonaId = personaId?.trim() || null
  const safeGreetingIndex =
    Number.isInteger(greetingIndex) && greetingIndex >= 0 ? greetingIndex : 0

  const [{ data: character, error: characterError }, personaResult] = await Promise.all([
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

  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .insert({
      user_id: user.id,
      character_id: character.id,
      persona_id: persona?.id ?? null,
      title: `${character.name}와의 대화`,
      model_config: buildOperatorDefaultChatModelConfig({}),
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

  // Verify character exists (also allow starter characters)
  const { data: character, error: charError } = await supabase
    .from('characters')
    .select('id, name')
    .eq('id', characterId)
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .single()

  if (charError || !character) {
    return { success: false, error: 'Character not found' }
  }

  // Parse and validate JSON
  let risuChat
  try {
    risuChat = parseRisuChatJson(jsonContent)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Invalid chat file format',
    }
  }

  const messageCount = getMessageCount(risuChat)
  if (messageCount === 0) {
    return { success: false, error: 'No messages to import' }
  }

  // Convert RisuAI messages to RebelAI format
  const rebelMessages = fromRisuFormat(risuChat)

  // Create new chat
  const { data: newChat, error: chatError } = await supabase
    .from('chats')
    .insert({
      user_id: user.id,
      character_id: characterId,
      title: chatTitle || `Imported Chat (${messageCount} messages)`,
      model_config: buildOperatorDefaultChatModelConfig({}),
    })
    .select('id')
    .single()

  if (chatError || !newChat) {
    console.error('[Chat import] Failed to create chat:', chatError)
    return { success: false, error: 'Failed to create chat' }
  }

  const { turns, messages } = buildTurnGraphForMessages({
    chatId: newChat.id,
    userId: user.id,
    orderedMessages: rebelMessages.map((msg) => ({
      id: msg.id ?? crypto.randomUUID(),
      role: msg.role,
      content: msg.content,
      created_at: msg.created_at,
      model_used: msg.model_used,
      prompt_tokens: msg.prompt_tokens,
      completion_tokens: msg.completion_tokens,
    })),
  })

  const { error: turnInsertError } = await supabase.from('chat_turns').insert(turns)
  if (turnInsertError) {
    console.error('[Chat import] Failed to insert turns:', turnInsertError)
    await supabase.from('chats').delete().eq('id', newChat.id)
    return { success: false, error: 'Failed to insert chat turns' }
  }

  const { error: insertError } = await supabase.from('messages').insert(messages)

  if (insertError) {
    console.error('[Chat import] Failed to insert messages:', insertError)
    // Delete created chat on failure
    await supabase.from('chats').delete().eq('id', newChat.id)
    return { success: false, error: 'Failed to insert messages' }
  }

  // Restore RebelAI extension data (if _rebelai field exists)
  const warnings: string[] = []
  const rebelaiExtension = risuChat.data._rebelai
  if (rebelaiExtension) {
    // Restore summaries
    if (rebelaiExtension.summaries?.length > 0) {
      const summariesToInsert = rebelaiExtension.summaries.map((s) => ({
        chat_id: newChat.id,
        user_id: user.id,
        level: s.level,
        start_seq: s.start_seq,
        end_seq: s.end_seq,
        summary: s.summary,
        token_count: s.token_count,
      }))

      const { error: summaryError } = await supabase
        .from('chat_summaries')
        .insert(summariesToInsert)

      if (summaryError) {
        console.warn('[Chat import] Failed to restore summaries', {
          chatId: newChat.id,
          summaryCount: summariesToInsert.length,
          error: summaryError.message,
          code: summaryError.code,
        })
        // Summary restore failure is not critical, continue with warning
        warnings.push(
          `Failed to restore ${summariesToInsert.length} summaries (will regenerate on next chat)`,
        )
      }
    }

    // Restore facts (excluding embeddings - need regeneration later)
    if (rebelaiExtension.facts?.length > 0) {
      const factsToInsert = rebelaiExtension.facts.map((f) => ({
        chat_id: newChat.id,
        user_id: user.id,
        start_seq: f.start_seq,
        end_seq: f.end_seq,
        facts: f.facts,
      }))

      const { error: factsError } = await supabase.from('chat_facts').insert(factsToInsert)

      if (factsError) {
        console.warn('[Chat import] Failed to restore facts', {
          chatId: newChat.id,
          factsCount: factsToInsert.length,
          error: factsError.message,
          code: factsError.code,
        })
        // Facts restore failure is not critical, continue with warning
        warnings.push(
          `Failed to restore ${factsToInsert.length} facts (will regenerate on next chat)`,
        )
      }
    }
  }

  revalidatePath(`/dashboard/characters/${characterId}`)

  return {
    success: true,
    chatId: newChat.id,
    messageCount,
    ...(warnings.length > 0 && { warnings }),
  }
}
