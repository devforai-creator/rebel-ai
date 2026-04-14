import type { SanitizedMessage } from '@/lib/chat-summaries'
import { readMaybeSingleQuery, readRowsQuery } from '@/lib/supabase/query'
import { MESSAGE_STATUS_GENERATING, MESSAGE_STATUS_SUPERSEDED } from './message-status'
import {
  buildProjectedConversationMessages,
  countTurnsWithActiveAssistantMessage,
  countTurnsWithUserMessage,
  getLowerSequenceBound,
  getTurnMessageIds,
  loadLatestActiveAssistantMessageId,
  loadProjectedMessagesByIds,
  loadStandaloneSystemMessages,
  loadTurnsForChat,
} from './turn-projection-query'
import type {
  PersistedTurnRow,
  ProjectedChatWindow,
  ProjectedConversationMessage,
  ProjectedTurnMessage,
  TurnClient,
} from './turn-types'

export type GenerationTranscriptMetrics = {
  targetTurnIndex: number
  turnCount: number
  fetchedMessageCount: number
  transcriptMessageCount: number
  excludedAssistant: boolean
}

export async function loadGenerationTranscript({
  supabase,
  chatId,
  turnId,
  excludeAssistantForTurnId = null,
  onMetrics,
}: {
  supabase: TurnClient
  chatId: string
  turnId: string
  excludeAssistantForTurnId?: string | null
  onMetrics?: (metrics: GenerationTranscriptMetrics) => void
}): Promise<SanitizedMessage[]> {
  const targetTurn = await supabase
    .from('chat_turns')
    .select('id, turn_index, user_message_id, active_assistant_message_id')
    .eq('id', turnId)
    .single<PersistedTurnRow>()

  if (targetTurn.error || !targetTurn.data) {
    throw new Error('Chat turn not found')
  }

  const turnsResult = await readRowsQuery<PersistedTurnRow>(
    supabase
      .from('chat_turns')
      .select('id, turn_index, user_message_id, active_assistant_message_id')
      .eq('chat_id', chatId)
      .lte('turn_index', targetTurn.data.turn_index)
      .order('turn_index', { ascending: true }),
  )

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
    onMetrics?.({
      targetTurnIndex: targetTurn.data.turn_index,
      turnCount: turns.length,
      fetchedMessageCount: 0,
      transcriptMessageCount: 0,
      excludedAssistant: excludeAssistantForTurnId !== null,
    })
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

  onMetrics?.({
    targetTurnIndex: targetTurn.data.turn_index,
    turnCount: turns.length,
    fetchedMessageCount: messagesResult.data?.length ?? 0,
    transcriptMessageCount: transcript.length,
    excludedAssistant: excludeAssistantForTurnId !== null,
  })

  return transcript
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
    readRowsQuery<PersistedTurnRow>(turnsQuery),
    typeof beforeTurnIndex === 'number'
      ? readMaybeSingleQuery<PersistedTurnRow>(
          supabase
            .from('chat_turns')
            .select('id, turn_index, user_message_id, active_assistant_message_id')
            .eq('chat_id', chatId)
            .eq('turn_index', beforeTurnIndex)
            .maybeSingle(),
        )
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
  const turns = await loadTurnsForChat({
    supabase,
    chatId,
    ascending: true,
  })

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
  const turns = await loadTurnsForChat({
    supabase,
    chatId,
    ascending: true,
  })

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
  const latestAssistantId = await loadLatestActiveAssistantMessageId({
    supabase,
    chatId,
  })

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
  let userMessageCount: number
  let activeAssistantCount: number
  let systemCountResult: { count: number | null; error: { message: string } | null }

  try {
    ;[userMessageCount, activeAssistantCount, systemCountResult] = await Promise.all([
      countTurnsWithUserMessage({
        supabase,
        chatId,
      }),
      countTurnsWithActiveAssistantMessage({
        supabase,
        chatId,
      }),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chatId)
        .eq('role', 'system')
        .neq('message_status', MESSAGE_STATUS_SUPERSEDED)
        .neq('message_status', MESSAGE_STATUS_GENERATING),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to count projected chat messages: ${message}`)
  }

  if (systemCountResult.error) {
    throw new Error(`Failed to count projected system messages: ${systemCountResult.error.message}`)
  }

  return userMessageCount + activeAssistantCount + (systemCountResult.count ?? 0)
}

export async function countProjectedConversationMessages({
  supabase,
  chatId,
}: {
  supabase: TurnClient
  chatId: string
}): Promise<number> {
  let userMessageCount: number
  let activeAssistantCount: number

  try {
    ;[userMessageCount, activeAssistantCount] = await Promise.all([
      countTurnsWithUserMessage({
        supabase,
        chatId,
      }),
      countTurnsWithActiveAssistantMessage({
        supabase,
        chatId,
      }),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to count projected conversation messages: ${message}`)
  }

  return userMessageCount + activeAssistantCount
}
