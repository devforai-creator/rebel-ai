import type { CharacterChat } from './[id]/character-detail-types'

const LAST_MESSAGE_PREVIEW_LIMIT = 240

type ChatWithMessages = {
  id: string
  title: string | null
  updated_at: string
  created_at: string
  messages?: Array<{ content: string | null; role: string | null }>
}

function buildPreview(content: string) {
  const normalized = content.trim().replace(/\s+/g, ' ')

  if (normalized.length <= LAST_MESSAGE_PREVIEW_LIMIT) {
    return normalized
  }

  return `${normalized.slice(0, LAST_MESSAGE_PREVIEW_LIMIT)}...`
}

export function toCharacterChatPreview(chat: ChatWithMessages): CharacterChat {
  const message = chat.messages?.[0] ?? null
  const role = typeof message?.role === 'string' ? message.role : null
  const content = typeof message?.content === 'string' ? buildPreview(message.content) : null

  return {
    id: chat.id,
    title: chat.title,
    updated_at: chat.updated_at,
    created_at: chat.created_at,
    lastMessage: role && content ? { role, content } : null,
  }
}
