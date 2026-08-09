import type { Message } from '@/types/database.types'
import { MESSAGE_STATUS_COMPLETED, isVisibleMessageStatus } from '@/lib/chat/message-status'
import type { DisplayMessage } from '../utils'

type ReconcileAssistantMessageArgs = {
  prevMessages: DisplayMessage[]
  assistantMessage: AssistantMessageSnapshot
  pendingRegenerationTargetId: string | null
}

type ReconcileAssistantMessageResult = {
  nextMessages: DisplayMessage[]
  idsToForget: string[]
}

export type AssistantMessageSnapshot = Pick<Message, 'id' | 'role'> & Partial<Message>

function sortBySequence(messages: DisplayMessage[]) {
  if (!messages.every((message) => typeof message.sequence === 'number')) {
    return messages
  }

  messages.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  return messages
}

function resolveSnapshotValue<T>(value: T | undefined, fallback: T | undefined): T | undefined {
  return value === undefined ? fallback : value
}

function toDisplayAssistantMessage(
  assistantMessage: AssistantMessageSnapshot,
  existingMessage?: DisplayMessage,
  replacementFallback?: DisplayMessage,
): DisplayMessage | null {
  const content =
    typeof assistantMessage.content === 'string'
      ? assistantMessage.content
      : existingMessage?.content

  if (typeof content !== 'string') {
    return null
  }

  return {
    ...(existingMessage ?? {}),
    id: assistantMessage.id,
    role: 'assistant',
    content,
    chat_id: resolveSnapshotValue(
      assistantMessage.chat_id,
      existingMessage?.chat_id ?? replacementFallback?.chat_id,
    ),
    sequence: resolveSnapshotValue(
      assistantMessage.sequence,
      existingMessage?.sequence ?? replacementFallback?.sequence ?? null,
    ),
    model_used: resolveSnapshotValue(assistantMessage.model_used, existingMessage?.model_used),
    prompt_tokens: resolveSnapshotValue(
      assistantMessage.prompt_tokens,
      existingMessage?.prompt_tokens,
    ),
    completion_tokens: resolveSnapshotValue(
      assistantMessage.completion_tokens,
      existingMessage?.completion_tokens,
    ),
    created_at: resolveSnapshotValue(
      assistantMessage.created_at,
      existingMessage?.created_at ?? replacementFallback?.created_at,
    ),
    debug_info: resolveSnapshotValue(assistantMessage.debug_info, existingMessage?.debug_info),
  }
}

export function reconcileAssistantMessage({
  prevMessages,
  assistantMessage,
  pendingRegenerationTargetId,
}: ReconcileAssistantMessageArgs): ReconcileAssistantMessageResult {
  const resolvedMessageStatus = assistantMessage.message_status ?? MESSAGE_STATUS_COMPLETED

  if (!isVisibleMessageStatus(resolvedMessageStatus)) {
    if (pendingRegenerationTargetId === assistantMessage.id) {
      return { nextMessages: prevMessages, idsToForget: [] }
    }

    return {
      nextMessages: prevMessages.filter((message) => message.id !== assistantMessage.id),
      idsToForget: [assistantMessage.id],
    }
  }

  const existingIndex = prevMessages.findIndex((message) => message.id === assistantMessage.id)
  const existingMessage = existingIndex !== -1 ? prevMessages[existingIndex] : undefined
  const replacementFallback = pendingRegenerationTargetId
    ? prevMessages.find((message) => message.id === pendingRegenerationTargetId)
    : undefined
  const mapped = toDisplayAssistantMessage(assistantMessage, existingMessage, replacementFallback)

  if (!mapped) {
    return { nextMessages: prevMessages, idsToForget: [] }
  }

  if (existingIndex !== -1) {
    const nextMessages = [...prevMessages]
    nextMessages[existingIndex] = mapped
    return { nextMessages, idsToForget: [] }
  }

  if (pendingRegenerationTargetId) {
    const targetIndex = prevMessages.findIndex(
      (message) => message.id === pendingRegenerationTargetId,
    )

    if (targetIndex !== -1) {
      const nextMessages = [...prevMessages]
      nextMessages[targetIndex] = mapped
      return {
        nextMessages: sortBySequence(nextMessages),
        idsToForget: [pendingRegenerationTargetId],
      }
    }

    return {
      nextMessages: sortBySequence([...prevMessages, mapped]),
      idsToForget: [pendingRegenerationTargetId],
    }
  }

  return {
    nextMessages: sortBySequence([...prevMessages, mapped]),
    idsToForget: [],
  }
}
