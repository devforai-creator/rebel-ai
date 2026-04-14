import type { ChatTurn } from '@/types/database.types'
import { readRowsQuery } from '@/lib/supabase/query'
import { MESSAGE_STATUS_GENERATING, MESSAGE_STATUS_SUPERSEDED } from './message-status'
import type {
  PersistedTurnRow,
  ProjectedConversationMessage,
  ProjectedTurnMessage,
  TurnClient,
} from './turn-types'
import { PROJECTED_CHAT_MESSAGE_COLUMNS } from './turn-types'

export function getTurnMessageIds(turn: PersistedTurnRow | null): string[] {
  if (!turn) return []

  const ids: string[] = []
  if (turn.user_message_id) {
    ids.push(turn.user_message_id)
  }
  if (turn.active_assistant_message_id) {
    ids.push(turn.active_assistant_message_id)
  }
  return ids
}

export function buildProjectedConversationMessages({
  turns,
  messageMap,
}: {
  turns: PersistedTurnRow[]
  messageMap: Map<string, ProjectedTurnMessage>
}): ProjectedConversationMessage[] {
  const messages: ProjectedConversationMessage[] = []

  for (const turn of turns) {
    if (turn.user_message_id) {
      const userMessage = messageMap.get(turn.user_message_id)
      if (userMessage?.role === 'user') {
        messages.push(userMessage as ProjectedConversationMessage)
      }
    }

    if (turn.active_assistant_message_id) {
      const assistantMessage = messageMap.get(turn.active_assistant_message_id)
      if (assistantMessage?.role === 'assistant') {
        messages.push(assistantMessage as ProjectedConversationMessage)
      }
    }
  }

  return messages
}

export function getLowerSequenceBound(
  turn: PersistedTurnRow | null,
  messageMap: Map<string, ProjectedTurnMessage>,
): number | null {
  if (!turn) return null

  const sequences = getTurnMessageIds(turn)
    .map((messageId) => messageMap.get(messageId)?.sequence ?? null)
    .filter((value): value is number => typeof value === 'number')

  if (sequences.length === 0) {
    return null
  }

  return Math.min(...sequences)
}

export async function loadProjectedMessagesByIds({
  supabase,
  messageIds,
}: {
  supabase: TurnClient
  messageIds: string[]
}): Promise<Map<string, ProjectedTurnMessage>> {
  if (messageIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabase
    .from('messages')
    .select(PROJECTED_CHAT_MESSAGE_COLUMNS)
    .in('id', [...new Set(messageIds)])

  if (error) {
    throw new Error(`Failed to load projected messages: ${error.message}`)
  }

  return new Map(
    ((data ?? []) as ProjectedTurnMessage[]).map((message) => [message.id, message] as const),
  )
}

export async function loadStandaloneSystemMessages({
  supabase,
  chatId,
  lowerSequenceBound,
  upperSequenceBound,
}: {
  supabase: TurnClient
  chatId: string
  lowerSequenceBound?: number | null
  upperSequenceBound?: number | null
}): Promise<ProjectedTurnMessage[]> {
  let query = supabase
    .from('messages')
    .select(PROJECTED_CHAT_MESSAGE_COLUMNS)
    .eq('chat_id', chatId)
    .eq('role', 'system')
    .neq('message_status', MESSAGE_STATUS_SUPERSEDED)
    .neq('message_status', MESSAGE_STATUS_GENERATING)

  if (typeof lowerSequenceBound === 'number') {
    query = query.gte('sequence', lowerSequenceBound)
  }

  if (typeof upperSequenceBound === 'number') {
    query = query.lt('sequence', upperSequenceBound)
  }

  const { data, error } = await query.order('sequence', { ascending: true })

  if (error) {
    throw new Error(`Failed to load standalone system messages: ${error.message}`)
  }

  return (data ?? []) as ProjectedTurnMessage[]
}

export async function loadTurnsForChat({
  supabase,
  chatId,
  ascending,
}: {
  supabase: TurnClient
  chatId: string
  ascending: boolean
}): Promise<PersistedTurnRow[]> {
  const turnsResult = await readRowsQuery<PersistedTurnRow>(
    supabase
      .from('chat_turns')
      .select('id, turn_index, user_message_id, active_assistant_message_id')
      .eq('chat_id', chatId)
      .order('turn_index', { ascending }),
  )

  if (turnsResult.error) {
    throw new Error(`Failed to load chat turns: ${turnsResult.error.message}`)
  }

  return turnsResult.data ?? []
}

export async function countTurnConversationMessages({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<Array<Pick<ChatTurn, 'user_message_id' | 'active_assistant_message_id'>>> {
  const turnsResult = await readRowsQuery<
    Pick<ChatTurn, 'user_message_id' | 'active_assistant_message_id'>
  >(
    supabase
      .from('chat_turns')
      .select('user_message_id, active_assistant_message_id')
      .eq('chat_id', chatId),
  )

  if (turnsResult.error) {
    throw new Error(turnsResult.error.message)
  }

  return turnsResult.data ?? []
}
