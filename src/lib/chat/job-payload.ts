import {
  isReasoningPreference,
  supportsReasoningPreference,
  type ReasoningSnapshot,
} from '@/lib/llm/reasoning'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import { isGoogleServiceTier, supportsGoogleFlex } from '@/lib/llm/service-tier'
import { isKnownLLMProvider } from '@/lib/api-keys/provider-utils'
import type { ApiServiceTier, Json, LlmProvider } from '@/types/database.types'
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
  provider: LlmProvider
  modelName: string
  reasoning?: ReasoningSnapshot
  serviceTier?: ApiServiceTier
  deliveryMode: ChatDeliveryMode
  sanitizedMessages: SanitizedMessage[]
  isRegeneration: boolean
  regenerateAssistantMessageId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && isKnownLLMProvider(value)
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
    ...(payload.reasoning ? { reasoning: { ...payload.reasoning } } : {}),
    ...(payload.serviceTier ? { serviceTier: payload.serviceTier } : {}),
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
    !isLlmProvider(payload.provider) ||
    typeof payload.modelName !== 'string' ||
    !Array.isArray(payload.sanitizedMessages) ||
    typeof payload.isRegeneration !== 'boolean'
  ) {
    return null
  }

  let reasoning: ReasoningSnapshot | undefined
  // Internal snapshots also retain inherited legacy OpenAI priority/batch settings.
  // Public requests accept only Standard/Flex and validate model support before enqueueing.
  if (
    payload.serviceTier !== undefined &&
    !(
      (payload.provider === 'openai' &&
        typeof payload.serviceTier === 'string' &&
        ['standard', 'flex', 'priority', 'batch'].includes(payload.serviceTier)) ||
      (payload.provider === 'google' &&
        isGoogleServiceTier(payload.serviceTier) &&
        (payload.serviceTier !== 'flex' || supportsGoogleFlex(payload.provider, payload.modelName)))
    )
  ) {
    return null
  }
  if (payload.reasoning !== undefined) {
    const value = payload.reasoning
    if (
      !isRecord(value) ||
      !['chat', 'legacy-key', 'model-default'].includes(String(value.source)) ||
      !(
        value.effort === null ||
        (isReasoningPreference(value.effort) &&
          value.effort !== 'default' &&
          supportsReasoningPreference(payload.provider, payload.modelName, value.effort))
      )
    )
      return null
    reasoning = { effort: value.effort, source: value.source as ReasoningSnapshot['source'] }
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
    ...(reasoning ? { reasoning } : {}),
    ...(payload.serviceTier ? { serviceTier: payload.serviceTier as ApiServiceTier } : {}),
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
