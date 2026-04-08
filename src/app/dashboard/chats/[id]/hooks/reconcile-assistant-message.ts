import type { Message } from '@/types/database.types'
import { isVisibleMessageStatus } from '@/lib/chat/message-status'
import type { DisplayMessage } from '../utils'
import { mapMessageToDisplay } from '../utils'

type ReconcileAssistantMessageArgs = {
  prevMessages: DisplayMessage[]
  assistantMessage: Message
  pendingRegenerationTargetId: string | null
}

type ReconcileAssistantMessageResult = {
  nextMessages: DisplayMessage[]
  idsToForget: string[]
}

function sortBySequence(messages: DisplayMessage[]) {
  messages.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  return messages
}

export function reconcileAssistantMessage({
  prevMessages,
  assistantMessage,
  pendingRegenerationTargetId,
}: ReconcileAssistantMessageArgs): ReconcileAssistantMessageResult {
  if (!isVisibleMessageStatus(assistantMessage.message_status)) {
    if (pendingRegenerationTargetId === assistantMessage.id) {
      return { nextMessages: prevMessages, idsToForget: [] }
    }

    return {
      nextMessages: prevMessages.filter((message) => message.id !== assistantMessage.id),
      idsToForget: [assistantMessage.id],
    }
  }

  const mapped = mapMessageToDisplay(assistantMessage)
  const existingIndex = prevMessages.findIndex((message) => message.id === mapped.id)

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
