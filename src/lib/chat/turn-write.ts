import type { ChatTurnInsert } from '@/types/database.types'
import type { TurnClient, TurnSequenceRow } from './turn-types'

const CHAT_TURN_INSERT_MAX_ATTEMPTS = 3
const CHAT_TURN_INDEX_UNIQUE_CONSTRAINT = 'chat_turns_chat_id_turn_index_key'

type TurnInsertError = {
  code?: string | null
  message?: string | null
} | null

export class ConcurrentChatTurnConflictError extends Error {
  constructor() {
    super('Concurrent chat turn creation conflict')
    this.name = 'ConcurrentChatTurnConflictError'
  }
}

function isChatTurnIndexConflict(error: TurnInsertError): boolean {
  return (
    error?.code === '23505' && error.message?.includes(CHAT_TURN_INDEX_UNIQUE_CONSTRAINT) === true
  )
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
  for (let attempt = 0; attempt < CHAT_TURN_INSERT_MAX_ATTEMPTS; attempt += 1) {
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

    if (!error) {
      return { turnId, turnIndex: nextTurnIndex }
    }

    if (isChatTurnIndexConflict(error)) {
      if (attempt === CHAT_TURN_INSERT_MAX_ATTEMPTS - 1) {
        throw new ConcurrentChatTurnConflictError()
      }

      continue
    }

    throw new Error(`Failed to create chat turn: ${error.message}`)
  }

  throw new ConcurrentChatTurnConflictError()
}
