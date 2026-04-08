import type { SupabaseClient } from '@supabase/supabase-js'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { Database, ChatTurnInsert, ChatTurn, MessageInsert } from '@/types/database.types'
import { MESSAGE_STATUS_COMPLETED, MESSAGE_STATUS_SUPERSEDED } from './message-status'

type TurnClient = Pick<SupabaseClient<Database>, 'from'>

type TurnSequenceRow = Pick<ChatTurn, 'turn_index'>
type PersistedTurnRow = Pick<
  ChatTurn,
  'id' | 'turn_index' | 'user_message_id' | 'active_assistant_message_id'
>
type PersistedMessageRow = Pick<MessageInsert, 'id' | 'role' | 'content'> & {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type OrderedChatMessageDraft = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
  model_used?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
}

export type OrderedChatMessageInsert = Omit<MessageInsert, 'sequence'> & {
  id: string
  role: 'user' | 'assistant' | 'system'
}

export function buildTurnGraphForMessages({
  chatId,
  userId,
  orderedMessages,
}: {
  chatId: string
  userId: string
  orderedMessages: OrderedChatMessageDraft[]
}): {
  turns: ChatTurnInsert[]
  messages: OrderedChatMessageInsert[]
} {
  const turns: ChatTurnInsert[] = []
  const messages: OrderedChatMessageInsert[] = []
  const assignedMessages = new Map<string, OrderedChatMessageInsert>()

  let currentTurn: ChatTurnInsert | null = null
  let turnIndex = 0

  const createTurn = (userMessageId: string | null) => {
    turnIndex += 1
    const turn: ChatTurnInsert = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      user_id: userId,
      turn_index: turnIndex,
      user_message_id: userMessageId,
      active_assistant_message_id: null,
    }
    turns.push(turn)
    currentTurn = turn
    return turn
  }

  for (const message of orderedMessages) {
    if (message.role === 'system') {
      const inserted: OrderedChatMessageInsert = {
        id: message.id,
        chat_id: chatId,
        user_id: userId,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        model_used: message.model_used ?? null,
        prompt_tokens: message.prompt_tokens ?? null,
        completion_tokens: message.completion_tokens ?? null,
        message_status: MESSAGE_STATUS_COMPLETED,
      }
      messages.push(inserted)
      assignedMessages.set(message.id, inserted)
      continue
    }

    if (message.role === 'user') {
      const turn = createTurn(message.id)
      const inserted: OrderedChatMessageInsert = {
        id: message.id,
        chat_id: chatId,
        user_id: userId,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        model_used: message.model_used ?? null,
        prompt_tokens: message.prompt_tokens ?? null,
        completion_tokens: message.completion_tokens ?? null,
        turn_id: turn.id,
        variant_index: null,
        supersedes_message_id: null,
        message_status: MESSAGE_STATUS_COMPLETED,
      }
      messages.push(inserted)
      assignedMessages.set(message.id, inserted)
      continue
    }

    if (!currentTurn) {
      currentTurn = createTurn(null)
    }

    const previousActiveId = currentTurn.active_assistant_message_id
    if (previousActiveId) {
      const previousMessage = assignedMessages.get(previousActiveId)
      if (previousMessage) {
        previousMessage.message_status = MESSAGE_STATUS_SUPERSEDED
      }
    }

    const nextVariantIndex =
      messages.filter(
        (candidate) => candidate.turn_id === currentTurn?.id && candidate.role === 'assistant',
      ).length + 1

    const inserted: OrderedChatMessageInsert = {
      id: message.id,
      chat_id: chatId,
      user_id: userId,
      role: message.role,
      content: message.content,
      created_at: message.created_at,
      model_used: message.model_used ?? null,
      prompt_tokens: message.prompt_tokens ?? null,
      completion_tokens: message.completion_tokens ?? null,
      turn_id: currentTurn.id,
      variant_index: nextVariantIndex,
      supersedes_message_id: previousActiveId ?? null,
      message_status: MESSAGE_STATUS_COMPLETED,
    }
    messages.push(inserted)
    assignedMessages.set(message.id, inserted)

    currentTurn.active_assistant_message_id = message.id
  }

  return { turns, messages }
}

export async function createChatTurn({
  supabase,
  chatId,
  userId,
  turnId = crypto.randomUUID(),
  userMessageId = null,
  activeAssistantMessageId = null,
}: {
  supabase: TurnClient
  chatId: string
  userId: string
  turnId?: string
  userMessageId?: string | null
  activeAssistantMessageId?: string | null
}): Promise<{ turnId: string; turnIndex: number }> {
  const latestTurnResult = await supabase
    .from('chat_turns')
    .select('turn_index')
    .eq('chat_id', chatId)
    .order('turn_index', { ascending: false })
    .limit(1)
    .maybeSingle<TurnSequenceRow>()

  if (latestTurnResult.error && latestTurnResult.error.message !== 'No rows found') {
    throw new Error(`Failed to load latest chat turn: ${latestTurnResult.error.message}`)
  }

  const nextTurnIndex = (latestTurnResult.data?.turn_index ?? 0) + 1
  const turnInsert: ChatTurnInsert = {
    id: turnId,
    chat_id: chatId,
    user_id: userId,
    turn_index: nextTurnIndex,
    user_message_id: userMessageId,
    active_assistant_message_id: activeAssistantMessageId,
  }

  const { error } = await supabase
    .from('chat_turns')
    .insert(turnInsert)
    .select('id')
    .single<{ id: string }>()

  if (error) {
    throw new Error(`Failed to create chat turn: ${error.message}`)
  }

  return { turnId, turnIndex: nextTurnIndex }
}

export async function loadGenerationTranscript({
  supabase,
  chatId,
  turnId,
  excludeAssistantForTurnId = null,
}: {
  supabase: TurnClient
  chatId: string
  turnId: string
  excludeAssistantForTurnId?: string | null
}): Promise<SanitizedMessage[]> {
  const targetTurn = await supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('id', turnId)
    .single<PersistedTurnRow>()

  if (targetTurn.error || !targetTurn.data) {
    throw new Error('Chat turn not found')
  }

  const turnsResult = (await (supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId)
    .lte('turn_index', targetTurn.data.turn_index)
    .order('turn_index', { ascending: true }) as unknown as Promise<{
    data: PersistedTurnRow[]
    error: { message: string } | null
  }>))

  if (turnsResult.error) {
    throw new Error(`Failed to load chat turns: ${turnsResult.error.message}`)
  }

  const turns = turnsResult.data ?? []
  const messageIds = turns.flatMap((turn) => {
    const ids: string[] = []
    if (turn.user_message_id) {
      ids.push(turn.user_message_id)
    }
    if (turn.active_assistant_message_id && turn.id !== excludeAssistantForTurnId) {
      ids.push(turn.active_assistant_message_id)
    }
    return ids
  })

  if (messageIds.length === 0) {
    return []
  }

  const messagesResult = await supabase
    .from('messages')
    .select('id, role, content')
    .in('id', messageIds)

  if (messagesResult.error) {
    throw new Error(`Failed to load transcript messages: ${messagesResult.error.message}`)
  }

  const messageMap = new Map(messagesResult.data.map((message) => [message.id, message]))
  const transcript: SanitizedMessage[] = []

  for (const turn of turns) {
    if (turn.user_message_id) {
      const userMessage = messageMap.get(turn.user_message_id)
      if (userMessage && (userMessage.role === 'user' || userMessage.role === 'assistant')) {
        transcript.push({
          role: userMessage.role,
          content: userMessage.content,
        })
      }
    }

    if (turn.active_assistant_message_id && turn.id !== excludeAssistantForTurnId) {
      const assistantMessage = messageMap.get(turn.active_assistant_message_id)
      if (
        assistantMessage &&
        (assistantMessage.role === 'user' || assistantMessage.role === 'assistant')
      ) {
        transcript.push({
          role: assistantMessage.role,
          content: assistantMessage.content,
        })
      }
    }
  }

  return transcript
}
