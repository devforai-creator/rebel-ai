import type { SanitizedMessage } from '@/lib/chat-summaries'
import { CHAT_REQUEST_LIMITS } from '@/lib/chat/runtime-limits'
import { z } from 'zod'
import { createErrorResponse } from './responses'

const chatRequestSchema = z
  .object({
    messages: z.unknown().optional(),
    userMessage: z.unknown().optional(),
    chatId: z.unknown().optional(),
    apiKeyId: z.unknown().optional(),
    deliveryMode: z.unknown().optional(),
    isRegeneration: z.unknown().optional(),
    regenerateAssistantMessageId: z.unknown().optional(),
  })
  .strict()

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

export async function parseChatRequest({ req }: { req: Request }): Promise<ParseChatRequestResult> {
  const rawBodyResult = await readChatRequestBody(req)
  if (rawBodyResult.status === 'error') {
    return rawBodyResult
  }

  const parsed = chatRequestSchema.safeParse(rawBodyResult.value)

  if (!parsed.success) {
    return {
      status: 'error',
      response: createErrorResponse('Invalid request body', 400),
    }
  }

  const {
    messages: rawMessages,
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

  const normalizedUserMessage = typeof rawUserMessage === 'string' ? rawUserMessage.trim() : ''
  const regenerateAssistantMessageId = normalizeRegenerationTarget(rawRegenerateAssistantMessageId)
  const isRegeneration = rawIsRegeneration === true || regenerateAssistantMessageId !== null

  if (typeof rawMessages !== 'undefined') {
    return {
      status: 'error',
      response: createErrorResponse('messages transcript payload is no longer supported', 400),
    }
  }

  if (isRegeneration && !regenerateAssistantMessageId) {
    return {
      status: 'error',
      response: createErrorResponse('regenerateAssistantMessageId is required', 400),
    }
  }

  if (isRegeneration) {
    if (normalizedUserMessage) {
      return {
        status: 'error',
        response: createErrorResponse('userMessage is not allowed for regeneration', 400),
      }
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
        messageToPersist: null,
        payloadSanitizedMessages: [],
      },
    }
  }

  if (!normalizedUserMessage) {
    return {
      status: 'error',
      response: createErrorResponse('userMessage is required', 400),
    }
  }

  if (isMessageOversized(normalizedUserMessage)) {
    return {
      status: 'error',
      response: createErrorResponse('Message exceeds allowed size', 400),
    }
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
      messageToPersist: normalizedUserMessage,
      payloadSanitizedMessages: [
        {
          role: 'user',
          content: normalizedUserMessage,
          messageId: null,
        },
      ],
    },
  }
}

type ReadChatRequestBodyResult =
  | {
      status: 'success'
      value: unknown
    }
  | {
      status: 'error'
      response: Response
    }

async function readChatRequestBody(req: Request): Promise<ReadChatRequestBodyResult> {
  const reader = req.body?.getReader()
  if (!reader) {
    return {
      status: 'error',
      response: createErrorResponse('Invalid request body', 400),
    }
  }

  const decoder = new TextDecoder()
  let bodyText = ''
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (!value) {
        continue
      }

      totalBytes += value.byteLength
      if (totalBytes > CHAT_REQUEST_LIMITS.maxRequestBodyBytes) {
        await reader.cancel().catch(() => undefined)
        return {
          status: 'error',
          response: createErrorResponse('Request body exceeds allowed size', 413),
        }
      }

      bodyText += decoder.decode(value, { stream: true })
    }

    bodyText += decoder.decode()
  } catch {
    return {
      status: 'error',
      response: createErrorResponse('Invalid request body', 400),
    }
  } finally {
    reader.releaseLock()
  }

  try {
    return {
      status: 'success',
      value: JSON.parse(bodyText),
    }
  } catch {
    return {
      status: 'error',
      response: createErrorResponse('Invalid request body', 400),
    }
  }
}

function normalizeRegenerationTarget(rawValue: unknown): string | null {
  return typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue : null
}

function isMessageOversized(content: string): boolean {
  return new TextEncoder().encode(content).length > CHAT_REQUEST_LIMITS.maxMessageBytes
}
