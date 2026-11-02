import type { Character } from '@/types/database.types'

type CharacterAccess = Pick<Character, 'user_id' | 'visibility' | 'archived_at'>

/** Archived owned cards remain usable by their owner in existing chats. */
export function canAccessChatCharacter(character: CharacterAccess, userId: string): boolean {
  return (
    character.user_id === userId ||
    (character.visibility === 'public' && character.archived_at === null)
  )
}
