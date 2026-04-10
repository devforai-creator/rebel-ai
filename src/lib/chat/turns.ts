import type { SupabaseClient } from '@supabase/supabase-js'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import type {
  Database,
  ChatTurnInsert,
  ChatTurn,
  Message,
  MessageInsert,
} from '@/types/database.types'
import {
  MESSAGE_STATUS_COMPLETED,
  MESSAGE_STATUS_GENERATING,
  MESSAGE_STATUS_SUPERSEDED,
} from './message-status'

type TurnClient = Pick<SupabaseClient<Database>, 'from'>

type TurnSequenceRow = Pick<ChatTurn, 'turn_index'>
type PersistedTurnRow = Pick<
  ChatTurn,
  'id' | 'turn_index' | 'user_message_id' | 'active_assistant_message_id'
>
type ProjectedTurnMessage = Pick<
  Message,
  | 'id'
  | 'role'
  | 'content'
  | 'chat_id'
  | 'user_id'
  | 'sequence'
  | 'model_used'
  | 'prompt_tokens'
  | 'completion_tokens'
  | 'latency_ms'
  | 'error_code'
  | 'debug_info'
  | 'content_en'
  | 'created_at'
  | 'turn_id'
  | 'variant_index'
  | 'supersedes_message_id'
  | 'message_status'
>
export type ProjectedConversationMessage = ProjectedTurnMessage & {
  role: 'user' | 'assistant'
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

export type ProjectedChatWindow = {
  messages: ProjectedTurnMessage[]
  hasMore: boolean
  nextCursor: number | null
}

const CHAT_TURN_INSERT_MAX_ATTEMPTS = 3
const CHAT_TURN_INDEX_UNIQUE_CONSTRAINT = 'chat_turns_chat_id_turn_index_key'

export const PROJECTED_CHAT_MESSAGE_COLUMNS =
  'id, role, content, chat_id, user_id, sequence, model_used, prompt_tokens, completion_tokens, latency_ms, error_code, debug_info, content_en, created_at, turn_id, variant_index, supersedes_message_id, message_status'

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

  const turnsResult = await (supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId)
    .lte('turn_index', targetTurn.data.turn_index)
    .order('turn_index', { ascending: true }) as unknown as Promise<{
    data: PersistedTurnRow[]
    error: { message: string } | null
  }>)

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
          messageId: userMessage.id,
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
          messageId: assistantMessage.id,
        })
      }
    }
  }

  return transcript
}

function getTurnMessageIds(turn: PersistedTurnRow | null): string[] {
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

function buildProjectedConversationMessages({
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

function getLowerSequenceBound(
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

async function loadProjectedMessagesByIds({
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

async function loadStandaloneSystemMessages({
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

export async function loadProjectedChatWindow({
  supabase,
  chatId,
  beforeTurnIndex = null,
  limitTurns,
}: {
  supabase: TurnClient
  chatId: string
  beforeTurnIndex?: number | null
  limitTurns: number
}): Promise<ProjectedChatWindow> {
  let turnsQuery = supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId)
    .order('turn_index', { ascending: false })
    .limit(limitTurns + 1)

  if (typeof beforeTurnIndex === 'number') {
    turnsQuery = turnsQuery.lt('turn_index', beforeTurnIndex)
  }

  const [turnsResult, boundaryTurnResult] = await Promise.all([
    turnsQuery as unknown as Promise<{
      data: PersistedTurnRow[] | null
      error: { message: string } | null
    }>,
    typeof beforeTurnIndex === 'number'
      ? (supabase
          .from('chat_turns')
          .select('id, turn_index, user_message_id, active_assistant_message_id')
          .eq('chat_id', chatId)
          .eq('turn_index', beforeTurnIndex)
          .maybeSingle() as unknown as Promise<{
          data: PersistedTurnRow | null
          error: { code: string; message: string } | null
        }>)
      : Promise.resolve({
          data: null,
          error: null,
        }),
  ])

  if (turnsResult.error) {
    throw new Error(`Failed to load chat turns: ${turnsResult.error.message}`)
  }

  if (boundaryTurnResult.error && boundaryTurnResult.error.code !== 'PGRST116') {
    throw new Error(`Failed to load boundary chat turn: ${boundaryTurnResult.error.message}`)
  }

  const fetchedTurns = turnsResult.data ?? []
  const hasMore = fetchedTurns.length > limitTurns
  const visibleTurnsDesc = hasMore ? fetchedTurns.slice(0, limitTurns) : fetchedTurns
  const visibleTurns = visibleTurnsDesc.slice().sort((a, b) => a.turn_index - b.turn_index)
  const oldestVisibleTurn = visibleTurns[0] ?? null
  const boundaryTurn = boundaryTurnResult.data ?? null

  const projectionMessageIds = [
    ...visibleTurns.flatMap((turn) => getTurnMessageIds(turn)),
    ...getTurnMessageIds(boundaryTurn),
  ]
  const messageMap = await loadProjectedMessagesByIds({
    supabase,
    messageIds: projectionMessageIds,
  })

  const turnMessages = visibleTurns
    .flatMap((turn) =>
      getTurnMessageIds(turn).map((messageId) => messageMap.get(messageId) ?? null),
    )
    .filter((message): message is ProjectedTurnMessage => message !== null)

  const lowerSequenceBound =
    oldestVisibleTurn?.turn_index === 1
      ? null
      : getLowerSequenceBound(oldestVisibleTurn, messageMap)
  const upperSequenceBound = getLowerSequenceBound(boundaryTurn, messageMap)
  const systemMessages =
    visibleTurns.length === 0 && typeof beforeTurnIndex !== 'number'
      ? await loadStandaloneSystemMessages({ supabase, chatId })
      : await loadStandaloneSystemMessages({
          supabase,
          chatId,
          lowerSequenceBound,
          upperSequenceBound,
        })

  const mergedMessages = [...turnMessages, ...systemMessages].sort(
    (a, b) => a.sequence - b.sequence,
  )
  const nextCursor = hasMore ? (oldestVisibleTurn?.turn_index ?? null) : null

  return {
    messages: mergedMessages,
    hasMore,
    nextCursor,
  }
}

export async function loadProjectedChatMessages({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<ProjectedTurnMessage[]> {
  const turnsResult = await (supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId)
    .order('turn_index', { ascending: true }) as unknown as Promise<{
    data: PersistedTurnRow[] | null
    error: { message: string } | null
  }>)

  if (turnsResult.error) {
    throw new Error(`Failed to load chat turns: ${turnsResult.error.message}`)
  }

  const turns = turnsResult.data ?? []
  const messageMap = await loadProjectedMessagesByIds({
    supabase,
    messageIds: turns.flatMap((turn) => getTurnMessageIds(turn)),
  })

  const turnMessages = turns
    .flatMap((turn) =>
      getTurnMessageIds(turn).map((messageId) => messageMap.get(messageId) ?? null),
    )
    .filter((message): message is ProjectedTurnMessage => message !== null)
  const systemMessages = await loadStandaloneSystemMessages({ supabase, chatId })

  return [...turnMessages, ...systemMessages].sort((a, b) => a.sequence - b.sequence)
}

export async function loadProjectedConversationMessages({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<ProjectedConversationMessage[]> {
  const turnsResult = await (supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId)
    .order('turn_index', { ascending: true }) as unknown as Promise<{
    data: PersistedTurnRow[] | null
    error: { message: string } | null
  }>)

  if (turnsResult.error) {
    throw new Error(`Failed to load chat turns: ${turnsResult.error.message}`)
  }

  const turns = turnsResult.data ?? []
  const messageMap = await loadProjectedMessagesByIds({
    supabase,
    messageIds: turns.flatMap((turn) => getTurnMessageIds(turn)),
  })

  return buildProjectedConversationMessages({
    turns,
    messageMap,
  })
}

export async function loadProjectedConversationRange({
  supabase,
  chatId,
  startOrdinal,
  endOrdinal,
}: {
  supabase: TurnClient
  chatId: string
  startOrdinal: number
  endOrdinal: number
}): Promise<ProjectedConversationMessage[]> {
  const messages = await loadProjectedConversationMessages({
    supabase,
    chatId,
  })

  return messages.slice(Math.max(0, startOrdinal - 1), Math.max(0, endOrdinal))
}

export async function loadLatestProjectedMessage({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<ProjectedTurnMessage | null> {
  const { messages } = await loadProjectedChatWindow({
    supabase,
    chatId,
    limitTurns: 1,
  })

  return messages[messages.length - 1] ?? null
}

export async function loadLatestProjectedAssistantMessage({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<ProjectedTurnMessage | null> {
  const turnsResult = await (supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId)
    .order('turn_index', { ascending: false }) as unknown as Promise<{
    data: PersistedTurnRow[] | null
    error: { message: string } | null
  }>)

  if (turnsResult.error) {
    throw new Error(`Failed to load chat turns: ${turnsResult.error.message}`)
  }

  const latestAssistantId =
    (turnsResult.data ?? []).find((turn) => !!turn.active_assistant_message_id)
      ?.active_assistant_message_id ?? null

  if (!latestAssistantId) {
    return null
  }

  const messageMap = await loadProjectedMessagesByIds({
    supabase,
    messageIds: [latestAssistantId],
  })

  return messageMap.get(latestAssistantId) ?? null
}

export async function countProjectedChatMessages({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<number> {
  const [turnsResult, systemCountResult] = await Promise.all([
    supabase
      .from('chat_turns')
      .select('user_message_id, active_assistant_message_id')
      .eq('chat_id', chatId) as unknown as Promise<{
      data: Array<Pick<ChatTurn, 'user_message_id' | 'active_assistant_message_id'>> | null
      error: { message: string } | null
    }>,
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .eq('role', 'system')
      .neq('message_status', MESSAGE_STATUS_SUPERSEDED)
      .neq('message_status', MESSAGE_STATUS_GENERATING),
  ])

  if (turnsResult.error) {
    throw new Error(`Failed to count projected chat turns: ${turnsResult.error.message}`)
  }

  if (systemCountResult.error) {
    throw new Error(`Failed to count projected system messages: ${systemCountResult.error.message}`)
  }

  const turnMessageCount = (turnsResult.data ?? []).reduce((count, turn) => {
    return count + (turn.user_message_id ? 1 : 0) + (turn.active_assistant_message_id ? 1 : 0)
  }, 0)

  return turnMessageCount + (systemCountResult.count ?? 0)
}

export async function countProjectedConversationMessages({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<number> {
  const turnsResult = await (supabase
    .from('chat_turns')
    .select('user_message_id, active_assistant_message_id')
    .eq('chat_id', chatId) as unknown as Promise<{
    data: Array<Pick<ChatTurn, 'user_message_id' | 'active_assistant_message_id'>> | null
    error: { message: string } | null
  }>)

  if (turnsResult.error) {
    throw new Error(`Failed to count projected conversation messages: ${turnsResult.error.message}`)
  }

  return (turnsResult.data ?? []).reduce((count, turn) => {
    return count + (turn.user_message_id ? 1 : 0) + (turn.active_assistant_message_id ? 1 : 0)
  }, 0)
}
