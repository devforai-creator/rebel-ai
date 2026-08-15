import type { Character } from '@/types/database.types'
import type { CharacterChat } from '@/lib/chat/character-chat-types'
import type { EditableCharacterFields } from '../CharacterForm'

export type { CharacterChat } from '@/lib/chat/character-chat-types'

export interface CharacterModuleOption {
  id: string
  name: string
}

export type CharacterDetail = EditableCharacterFields &
  Pick<Character, 'avatar_url' | 'visibility' | 'created_at'>

export interface CharacterDetailViewProps {
  character: CharacterDetail
  chats: CharacterChat[]
  isStarter: boolean
  modules: CharacterModuleOption[]
  initialModuleIds: string[]
  hasMoreChats: boolean
  initialChatCursor: string | null
}
