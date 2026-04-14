import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { Json, Provider } from '@/types/database.types'
import {
  CHAT_DELIVERY_MODE_STREAMING,
  isChatDeliveryMode,
  type ChatDeliveryMode,
} from './delivery-mode'

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
  deliveryMode: ChatDeliveryMode
  sanitizedMessages: SanitizedMessage[]
  isRegeneration: boolean
  regenerateAssistantMessageId: string | null
}

const CHAT_JOB_PROVIDERS: Provider[] = [
  'google',
  'openai',
  'anthropic',
  'deepseek',
  'openrouter',
  'voyage_embeddings',
]
const CHAT_JOB_PROVIDER_SET = new Set<string>(CHAT_JOB_PROVIDERS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && CHAT_JOB_PROVIDER_SET.has(value)
}

function isSanitizedMessage(value: unknown): value is SanitizedMessage {
  return (
    isRecord(value) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    (typeof value.messageId === 'undefined' ||
      value.messageId === null ||
      typeof value.messageId === 'string')
  )
}

function serializeSanitizedMessage(message: SanitizedMessage) {
  return {
    role: message.role,
    content: message.content,
    ...(typeof message.messageId === 'string' ? { messageId: message.messageId } : {}),
  }
}

export function serializeChatJobPayload(payload: ChatGenerationJobPayload): Json {
  return {
    version: payload.version,
    requestId: payload.requestId,
    chatId: payload.chatId,
    turnId: payload.turnId,
    userId: payload.userId,
    apiKeyId: payload.apiKeyId,
    provider: payload.provider,
    modelName: payload.modelName,
    deliveryMode: payload.deliveryMode,
    sanitizedMessages: payload.sanitizedMessages.map(serializeSanitizedMessage),
    isRegeneration: payload.isRegeneration,
    regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
  }
}

export function parseChatJobPayload(payload: unknown): ChatGenerationJobPayload | null {
  if (!isRecord(payload)) {
    return null
  }

  if (
    payload.version !== CHAT_JOB_PAYLOAD_VERSION ||
    typeof payload.requestId !== 'string' ||
    typeof payload.chatId !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.apiKeyId !== 'string' ||
    !isProvider(payload.provider) ||
    typeof payload.modelName !== 'string' ||
    !Array.isArray(payload.sanitizedMessages) ||
    typeof payload.isRegeneration !== 'boolean'
  ) {
    return null
  }

  if (!payload.sanitizedMessages.every(isSanitizedMessage)) {
    return null
  }

  return {
    version: CHAT_JOB_PAYLOAD_VERSION,
    requestId: payload.requestId,
    chatId: payload.chatId,
    turnId: typeof payload.turnId === 'string' ? payload.turnId : null,
    userId: payload.userId,
    apiKeyId: payload.apiKeyId,
    provider: payload.provider,
    modelName: payload.modelName,
    deliveryMode: isChatDeliveryMode(payload.deliveryMode)
      ? payload.deliveryMode
      : CHAT_DELIVERY_MODE_STREAMING,
    sanitizedMessages: payload.sanitizedMessages.map(serializeSanitizedMessage),
    isRegeneration: payload.isRegeneration,
    regenerateAssistantMessageId:
      typeof payload.regenerateAssistantMessageId === 'string'
        ? payload.regenerateAssistantMessageId
        : null,
  }
}
