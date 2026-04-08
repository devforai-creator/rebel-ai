import type { Character } from '@/types/database.types'
import type { EditableCharacterFields } from '../CharacterForm'

export interface CharacterChat {
  id: string
  title: string | null
  updated_at: string
  created_at: string
  lastMessage: { content: string; role: string } | null
}

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
