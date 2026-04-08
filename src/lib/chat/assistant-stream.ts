export const CHAT_ASSISTANT_STREAM_EVENT = 'assistant-stream'

export type AssistantStreamBroadcastPayload =
  | {
      kind: 'snapshot'
      jobId: string
      content: string
      regenerateAssistantMessageId: string | null
    }
  | {
      kind: 'error'
      jobId: string
      error: string
      regenerateAssistantMessageId: string | null
    }

export function getChatAssistantStreamChannelName(chatId: string) {
  return `chat-${chatId}`
}
