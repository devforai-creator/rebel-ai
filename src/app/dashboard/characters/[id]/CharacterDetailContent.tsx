import { createClient } from '@/lib/supabase/server'
import { loadCharacterChats } from '@/lib/chat/character-chats'
import CharacterDetailView from './CharacterDetailView'
import type { CharacterDetail } from './character-detail-types'

interface Props {
  character: CharacterDetail & { user_id: string | null }
  userId: string
}

export default async function CharacterDetailContent({ character, userId }: Props) {
  const supabase = await createClient()

  const [chatsResult, modulesResult, characterModulesResult] = await Promise.all([
    loadCharacterChats({ supabase, characterId: character.id }).catch((error) => {
      console.error('Error fetching chats:', error)
      return { chats: [], hasMore: false, nextCursor: null }
    }),
    supabase.from('modules').select('id, name').eq('user_id', userId).order('name'),
    supabase
      .from('character_modules')
      .select('module_id')
      .eq('character_id', character.id)
      .eq('enabled', true)
      .order('priority', { ascending: false }),
  ])

  if (modulesResult.error) {
    console.error('Error fetching modules:', modulesResult.error)
  }
  if (characterModulesResult.error) {
    console.error('Error fetching character modules:', characterModulesResult.error)
  }

  const modules = modulesResult.data ?? []
  const characterModules = characterModulesResult.data ?? []

  const selectedModuleIds = characterModules.map((cm) => cm.module_id)

  return (
    <CharacterDetailView
      character={character}
      chats={chatsResult.chats}
      isStarter={character.user_id === null}
      modules={modules}
      initialModuleIds={selectedModuleIds}
      hasMoreChats={chatsResult.hasMore}
      initialChatCursor={chatsResult.nextCursor}
    />
  )
}
