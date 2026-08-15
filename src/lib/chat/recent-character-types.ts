export const RECENT_CHARACTER_DEFAULT_PAGE_SIZE = 15
export const RECENT_CHARACTER_MIN_PAGE_SIZE = 1
export const RECENT_CHARACTER_MAX_PAGE_SIZE = 50
export const RECENT_CHARACTER_PREVIEW_MAX_LENGTH = 160

export type RecentConversationCharacter = {
  characterId: string
  characterName: string
  avatarUrl: string | null
  lastMessageAt: string
  latestChatId: string
  latestChatTitle: string | null
  preview: {
    role: 'user' | 'assistant'
    content: string
  } | null
}

export type RecentConversationCharactersPage = {
  characters: RecentConversationCharacter[]
  hasMore: boolean
  nextCursor: string | null
}
