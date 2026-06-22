import type { SupabaseClient } from '@supabase/supabase-js'
import { buildOperatorDefaultChatModelConfig } from '@/lib/chat/model-config'
import { buildTurnGraphForMessages } from '@/lib/chat/turns'
import { fromRisuFormat, getMessageCount, parseRisuChatJson } from '@/lib/chat/risu-converter'
import type { ChatImportResult } from '@/types/risu-chat'
import type { ChatSummaryInsert, Database } from '@/types/database.types'

export async function importChatForUser({
  supabase,
  userId,
  characterId,
  jsonContent,
  chatTitle,
}: {
  supabase: SupabaseClient<Database>
  userId: string
  characterId: string
  jsonContent: string
  chatTitle?: string
}): Promise<ChatImportResult> {
  const { data: character, error: charError } = await supabase
    .from('characters')
    .select('id, name')
    .eq('id', characterId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .single()

  if (charError || !character) {
    return { success: false, error: 'Character not found' }
  }

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

  const rebelMessages = fromRisuFormat(risuChat)

  const { data: newChat, error: chatError } = await supabase
    .from('chats')
    .insert({
      user_id: userId,
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
    userId,
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
    await supabase.from('chats').delete().eq('id', newChat.id)
    return { success: false, error: 'Failed to insert messages' }
  }

  const warnings: string[] = []
  const rebelaiExtension = risuChat.data._rebelai

  if (rebelaiExtension) {
    if (rebelaiExtension.summaries?.length > 0) {
      const summariesToInsert: ChatSummaryInsert[] = rebelaiExtension.summaries.map((s) => ({
        chat_id: newChat.id,
        user_id: userId,
        level: s.level,
        start_seq: s.start_seq,
        end_seq: s.end_seq,
        summary: s.summary,
        summary_status: s.summary_status === 'fallback' ? 'fallback' : 'ok',
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
        warnings.push(
          `Failed to restore ${summariesToInsert.length} summaries (will regenerate on next chat)`,
        )
      }
    }

    if (rebelaiExtension.facts?.length > 0) {
      const factsToInsert = rebelaiExtension.facts.map((f) => ({
        chat_id: newChat.id,
        user_id: userId,
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
        warnings.push(
          `Failed to restore ${factsToInsert.length} facts (will regenerate on next chat)`,
        )
      }
    }
  }

  return {
    success: true,
    chatId: newChat.id,
    messageCount,
    ...(warnings.length > 0 && { warnings }),
  }
}
