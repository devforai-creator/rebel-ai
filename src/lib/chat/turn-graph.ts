import type { ChatTurnInsert } from '@/types/database.types'
import { MESSAGE_STATUS_COMPLETED, MESSAGE_STATUS_SUPERSEDED } from './message-status'
import type { OrderedChatMessageDraft, OrderedChatMessageInsert } from './turn-types'

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
