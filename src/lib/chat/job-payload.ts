import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { Json, Provider } from '@/types/database.types'

export const CHAT_JOB_PAYLOAD_VERSION = 1 as const

export type ChatJobStatus = 'pending' | 'processing' | 'success' | 'error'

export interface ChatGenerationJobPayload {
  version: typeof CHAT_JOB_PAYLOAD_VERSION
  requestId: string
  chatId: string
  turnId: string | null
  userId: string
  apiKeyId: string
  provider: Provider
  modelName: string
  sanitizedMessages: SanitizedMessage[]
  isRegeneration: boolean
  regenerateAssistantMessageId: string | null
}

export function serializeChatJobPayload(payload: ChatGenerationJobPayload): Json {
  return payload as unknown as Json
}

export function parseChatJobPayload(payload: unknown): ChatGenerationJobPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload as Partial<ChatGenerationJobPayload>

  if (
    candidate.version !== CHAT_JOB_PAYLOAD_VERSION ||
    typeof candidate.requestId !== 'string' ||
    typeof candidate.chatId !== 'string' ||
    typeof candidate.userId !== 'string' ||
    typeof candidate.apiKeyId !== 'string' ||
    typeof candidate.provider !== 'string' ||
    typeof candidate.modelName !== 'string' ||
    !Array.isArray(candidate.sanitizedMessages) ||
    typeof candidate.isRegeneration !== 'boolean'
  ) {
    return null
  }

  const messagesValid = candidate.sanitizedMessages.every(
    (message) =>
      message &&
      typeof message === 'object' &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string',
  )

  if (!messagesValid) {
    return null
  }

  return {
    version: CHAT_JOB_PAYLOAD_VERSION,
    requestId: candidate.requestId,
    chatId: candidate.chatId,
    turnId: typeof candidate.turnId === 'string' ? candidate.turnId : null,
    userId: candidate.userId,
    apiKeyId: candidate.apiKeyId,
    provider: candidate.provider,
    modelName: candidate.modelName,
    sanitizedMessages: candidate.sanitizedMessages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(typeof message.messageId === 'string' ? { messageId: message.messageId } : {}),
    })),
    isRegeneration: candidate.isRegeneration,
    regenerateAssistantMessageId:
      typeof candidate.regenerateAssistantMessageId === 'string'
        ? candidate.regenerateAssistantMessageId
        : null,
  }
}
