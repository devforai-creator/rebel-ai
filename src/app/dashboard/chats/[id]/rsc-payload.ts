import { CHAT_DELIVERY_MODE_STREAMING, isChatDeliveryMode } from '@/lib/chat/delivery-mode'
import { parseChatJobPayload } from '@/lib/chat/job-payload'
import type { ProjectedTurnMessage } from '@/lib/chat/turn-types'
import type { ActiveChatJob } from './utils'

const CHAT_CHARACTER_METADATA_KEYS = [
  'default_variables',
  'ui_card',
  'ui_cards',
  'image_display',
] as const

type ChatCharacterMetadata = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildInitialActiveChatJob(
  job:
    | {
        id: string
        delivery_mode: string | null
        payload: unknown
      }
    | null
    | undefined,
): ActiveChatJob | null {
  if (!job || !job.id) {
    return null
  }

  const parsedPayload = parseChatJobPayload(job.payload)
  const deliveryMode = isChatDeliveryMode(job.delivery_mode)
    ? job.delivery_mode
    : (parsedPayload?.deliveryMode ?? CHAT_DELIVERY_MODE_STREAMING)

  return {
    id: job.id,
    deliveryMode,
    regenerateAssistantMessageId: parsedPayload?.regenerateAssistantMessageId ?? null,
  }
}

export function stripInitialMessageDebugInfo(
  messages: ProjectedTurnMessage[],
): ProjectedTurnMessage[] {
  return messages.map((message) =>
    message.debug_info == null
      ? message
      : {
          ...message,
          debug_info: null,
        },
  )
}

export function pickChatCharacterMetadata(metadata: unknown): ChatCharacterMetadata | null {
  if (!isRecord(metadata)) {
    return null
  }

  const picked: ChatCharacterMetadata = {}

  for (const key of CHAT_CHARACTER_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(metadata, key) && metadata[key] !== undefined) {
      picked[key] = metadata[key]
    }
  }

  return Object.keys(picked).length > 0 ? picked : null
}
