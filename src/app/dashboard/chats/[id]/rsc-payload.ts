import type { ProjectedTurnMessage } from '@/lib/chat/turn-types'

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
