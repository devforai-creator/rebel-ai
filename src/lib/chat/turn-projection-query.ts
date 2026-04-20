import { readMaybeSingleQuery, readRowsQuery } from '@/lib/supabase/query'
import { MESSAGE_STATUS_GENERATING, MESSAGE_STATUS_SUPERSEDED } from './message-status'
import type {
  PersistedTurnRow,
  ProjectedConversationMessage,
  ProjectedTurnMessage,
  TurnClient,
} from './turn-types'
import { PROJECTED_CHAT_MESSAGE_COLUMNS } from './turn-types'

const MESSAGE_ID_QUERY_CHUNK_SIZE = 100

export async function loadMessageRowsByIds<Row extends { id: string }>({
  supabase,
  columns,
  messageIds,
}: {
  supabase: TurnClient
  columns: string
  messageIds: string[]
}): Promise<Row[]> {
  if (messageIds.length === 0) {
    return []
  }

  const uniqueMessageIds = [...new Set(messageIds)]
  const rows: Row[] = []

  for (let index = 0; index < uniqueMessageIds.length; index += MESSAGE_ID_QUERY_CHUNK_SIZE) {
    const chunk = uniqueMessageIds.slice(index, index + MESSAGE_ID_QUERY_CHUNK_SIZE)
    const { data, error } = await supabase.from('messages').select(columns).in('id', chunk)

    if (error) {
      throw new Error(`Failed to load messages by id: ${error.message}`)
    }

    rows.push(...((data ?? []) as unknown as Row[]))
  }

  return rows
}

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

  const data = await loadMessageRowsByIds<ProjectedTurnMessage>({
    supabase,
    columns: PROJECTED_CHAT_MESSAGE_COLUMNS,
    messageIds,
  }).catch((error) => {
    throw new Error(
      `Failed to load projected messages: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  })

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
  limit,
}: {
  supabase: TurnClient
  chatId: string
  ascending: boolean
  limit?: number
}): Promise<PersistedTurnRow[]> {
  let turnsQuery = supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId)
    .order('turn_index', { ascending })

  if (typeof limit === 'number') {
    turnsQuery = turnsQuery.limit(limit)
  }

  const turnsResult = await readRowsQuery<PersistedTurnRow>(turnsQuery)

  if (turnsResult.error) {
    throw new Error(`Failed to load chat turns: ${turnsResult.error.message}`)
  }

  return turnsResult.data ?? []
}

async function countTurnsWithMessageField({
  supabase,
  chatId,
  field,
}: {
  supabase: TurnClient
  chatId: string
  field: 'user_message_id' | 'active_assistant_message_id'
}): Promise<number> {
  const { count, error } = await supabase
    .from('chat_turns')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .not(field, 'is', null)

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

export async function countTurnsWithUserMessage({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<number> {
  return countTurnsWithMessageField({
    supabase,
    chatId,
    field: 'user_message_id',
  })
}

export async function countTurnsWithActiveAssistantMessage({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<number> {
  return countTurnsWithMessageField({
    supabase,
    chatId,
    field: 'active_assistant_message_id',
  })
}

export async function loadLatestActiveAssistantMessageId({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<string | null> {
  const latestAssistantTurnResult = await readMaybeSingleQuery<{
    active_assistant_message_id: string | null
  }>(
    supabase
      .from('chat_turns')
      .select('active_assistant_message_id')
      .eq('chat_id', chatId)
      .not('active_assistant_message_id', 'is', null)
      .order('turn_index', { ascending: false })
      .limit(1)
      .maybeSingle(),
  )

  if (latestAssistantTurnResult.error && latestAssistantTurnResult.error.code !== 'PGRST116') {
    throw new Error(latestAssistantTurnResult.error.message)
  }

  return latestAssistantTurnResult.data?.active_assistant_message_id ?? null
}
