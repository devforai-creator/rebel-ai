import type { SanitizedMessage } from '@/lib/chat-summaries'
import { CHAT_REQUEST_LIMITS } from '@/lib/chat/runtime-limits'
import { z } from 'zod'
import { createErrorResponse } from './responses'

const chatRequestSchema = z
  .object({
    messages: z.array(z.unknown()).optional().nullable(),
    userMessage: z.unknown().optional(),
    chatId: z.unknown().optional(),
    apiKeyId: z.unknown().optional(),
    deliveryMode: z.unknown().optional(),
    isRegeneration: z.unknown().optional(),
    regenerateAssistantMessageId: z.unknown().optional(),
  })
  .passthrough()

export interface ParsedChatRequest {
  chatId: string
  apiKeyId: string
  rawDeliveryMode: unknown
  isRegeneration: boolean
  regenerateAssistantMessageId: string | null
  normalizedUserMessage: string
  messageToPersist: string | null
  payloadSanitizedMessages: SanitizedMessage[]
}

type ParseChatRequestResult =
  | {
      status: 'success'
      value: ParsedChatRequest
    }
  | {
      status: 'error'
      response: Response
    }

export async function parseChatRequest({
  req,
  requestId,
}: {
  req: Request
  requestId: string
}): Promise<ParseChatRequestResult> {
  const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null))

  if (!parsed.success) {
    return {
      status: 'error',
      response: createErrorResponse('Invalid request body', 400),
    }
  }

  const {
    messages,
    userMessage: rawUserMessage,
    chatId,
    apiKeyId,
    deliveryMode: rawDeliveryMode,
    isRegeneration: rawIsRegeneration,
    regenerateAssistantMessageId: rawRegenerateAssistantMessageId,
  } = parsed.data

  if (typeof chatId !== 'string' || !chatId) {
    return {
      status: 'error',
      response: createErrorResponse('Invalid chatId', 400),
    }
  }

  if (typeof apiKeyId !== 'string' || !apiKeyId) {
    return {
      status: 'error',
      response: createErrorResponse('Invalid apiKeyId', 400),
    }
  }

  const sanitizedMessagesFromRequest = sanitizeRequestMessages(messages)
  const normalizedUserMessage = typeof rawUserMessage === 'string' ? rawUserMessage.trim() : ''
  const regenerateAssistantMessageId = normalizeRegenerationTarget(rawRegenerateAssistantMessageId)
  const isRegeneration = rawIsRegeneration === true || regenerateAssistantMessageId !== null

  if (isRegeneration && !regenerateAssistantMessageId) {
    return {
      status: 'error',
      response: createErrorResponse('regenerateAssistantMessageId is required', 400),
    }
  }

  const normalizedMessageResult = normalizeRequestMessage({
    chatId,
    isRegeneration,
    normalizedUserMessage,
    requestId,
    sanitizedMessagesFromRequest,
  })

  if (normalizedMessageResult.status === 'error') {
    return normalizedMessageResult
  }

  return {
    status: 'success',
    value: {
      chatId,
      apiKeyId,
      rawDeliveryMode,
      isRegeneration,
      regenerateAssistantMessageId,
      normalizedUserMessage,
      messageToPersist: normalizedMessageResult.messageToPersist,
      payloadSanitizedMessages: normalizedMessageResult.payloadSanitizedMessages,
    },
  }
}

function sanitizeRequestMessages(messages: unknown): SanitizedMessage[] {
  if (!Array.isArray(messages)) {
    return []
  }

  return messages
    .filter((message): message is { role: string; content: string } => {
      if (!message || typeof message !== 'object') {
        return false
      }

      const candidate = message as Record<string, unknown>
      return typeof candidate.role === 'string' && typeof candidate.content === 'string'
    })
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const candidate = message as Record<string, unknown>
      return {
        role: message.role as 'user' | 'assistant',
        content: message.content,
        messageId: typeof candidate.messageId === 'string' ? candidate.messageId : null,
      }
    })
}

function normalizeRegenerationTarget(rawValue: unknown): string | null {
  return typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue : null
}

function normalizeRequestMessage({
  chatId,
  isRegeneration,
  normalizedUserMessage,
  requestId,
  sanitizedMessagesFromRequest,
}: {
  chatId: string
  isRegeneration: boolean
  normalizedUserMessage: string
  requestId: string
  sanitizedMessagesFromRequest: SanitizedMessage[]
}):
  | {
      status: 'success'
      messageToPersist: string | null
      payloadSanitizedMessages: SanitizedMessage[]
    }
  | {
      status: 'error'
      response: Response
    } {
  if (isRegeneration) {
    return {
      status: 'success',
      messageToPersist: null,
      payloadSanitizedMessages: sanitizedMessagesFromRequest,
    }
  }

  if (normalizedUserMessage) {
    if (isMessageOversized(normalizedUserMessage)) {
      return {
        status: 'error',
        response: createErrorResponse('Message exceeds allowed size', 400),
      }
    }

    return {
      status: 'success',
      messageToPersist: normalizedUserMessage,
      payloadSanitizedMessages: [
        {
          role: 'user',
          content: normalizedUserMessage,
          messageId: null,
        },
      ],
    }
  }

  console.warn('[Chat API] Legacy transcript fallback used', {
    requestId,
    chatId,
    messageCount: sanitizedMessagesFromRequest.length,
  })

  if (sanitizedMessagesFromRequest.length === 0) {
    return {
      status: 'error',
      response: createErrorResponse('Messages array required', 400),
    }
  }

  const lastMessage = sanitizedMessagesFromRequest[sanitizedMessagesFromRequest.length - 1]
  if (lastMessage.role !== 'user' || !lastMessage.content.trim()) {
    return {
      status: 'error',
      response: createErrorResponse('Last message must be a non-empty user message', 400),
    }
  }

  if (isMessageOversized(lastMessage.content)) {
    return {
      status: 'error',
      response: createErrorResponse('Message exceeds allowed size', 400),
    }
  }

  return {
    status: 'success',
    messageToPersist: lastMessage.content,
    payloadSanitizedMessages: sanitizedMessagesFromRequest,
  }
}

function isMessageOversized(content: string): boolean {
  return new TextEncoder().encode(content).length > CHAT_REQUEST_LIMITS.maxMessageBytes
}
