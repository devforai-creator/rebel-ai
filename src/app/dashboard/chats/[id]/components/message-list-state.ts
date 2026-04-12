import type { DisplayMessage, StreamingAssistantDraft } from '../utils'

export function buildVisibleMessages(
  messages: DisplayMessage[],
  streamingDraft?: StreamingAssistantDraft | null,
): DisplayMessage[] {
  if (!streamingDraft) {
    return messages
  }

  if (streamingDraft.replaceMessageId) {
    const targetIndex = messages.findIndex(
      (message) => message.id === streamingDraft.replaceMessageId,
    )

    if (targetIndex !== -1) {
      const nextMessages = [...messages]
      nextMessages[targetIndex] = streamingDraft
      return nextMessages
    }
  }

  return [...messages, streamingDraft]
}

export function findLastAssistantIndex(messages: DisplayMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return index
    }
  }

  return -1
}
