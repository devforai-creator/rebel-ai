export type CharacterChat = {
  id: string
  title: string | null
  created_at: string
  last_message_at: string | null
  recency_at: string
  lastMessage: { content: string; role: 'user' | 'assistant' } | null
}

export type CharacterChatsPage = {
  chats: CharacterChat[]
  hasMore: boolean
  nextCursor: string | null
}
