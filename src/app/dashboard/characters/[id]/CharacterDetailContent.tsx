import { createClient } from '@/lib/supabase/server'
import CharacterDetailView, { type CharacterDetail } from './CharacterDetailView'
import { CHARACTER_CHAT_PAGE_SIZE } from '@/lib/chat/constants'

const CHARACTER_CHAT_FIELDS = `
  id,
  title,
  updated_at,
  created_at,
  messages (
    content,
    role
  )
`

interface Props {
  character: CharacterDetail & { user_id: string | null }
  userId: string
}

export default async function CharacterDetailContent({ character, userId }: Props) {
  const supabase = await createClient()

  const [chatsResult, modulesResult, characterModulesResult] = await Promise.all([
    supabase
      .from('chats')
      .select(CHARACTER_CHAT_FIELDS)
      .eq('user_id', userId)
      .eq('character_id', character.id)
      .order('updated_at', { ascending: false })
      .order('sequence', { referencedTable: 'messages', ascending: false })
      .limit(CHARACTER_CHAT_PAGE_SIZE + 1),
    supabase.from('modules').select('id, name').eq('user_id', userId).order('name'),
    supabase
      .from('character_modules')
      .select('module_id')
      .eq('character_id', character.id)
      .eq('enabled', true)
      .order('priority', { ascending: false }),
  ])

  if (chatsResult.error) {
    console.error('Error fetching chats:', chatsResult.error)
  }
  if (modulesResult.error) {
    console.error('Error fetching modules:', modulesResult.error)
  }
  if (characterModulesResult.error) {
    console.error('Error fetching character modules:', characterModulesResult.error)
  }

  const chats = chatsResult.data ?? []
  const modules = modulesResult.data ?? []
  const characterModules = characterModulesResult.data ?? []

  const selectedModuleIds = characterModules.map((cm) => cm.module_id)

  // 마지막 메시지만 추출해서 클라이언트에 전달
  const chatsWithLastMessage = chats.slice(0, CHARACTER_CHAT_PAGE_SIZE).map((chat) => {
    const messages = (chat as { messages?: Array<{ content: string; role: string }> }).messages
    const lastMessage = messages?.[0] ?? null
    return {
      id: chat.id,
      title: chat.title,
      updated_at: chat.updated_at,
      created_at: chat.created_at,
      lastMessage,
    }
  })
  const hasMoreChats = chats.length > CHARACTER_CHAT_PAGE_SIZE
  const nextChatCursor = hasMoreChats
    ? (chatsWithLastMessage[chatsWithLastMessage.length - 1]?.updated_at ?? null)
    : null

  return (
    <CharacterDetailView
      character={character}
      chats={chatsWithLastMessage}
      isStarter={character.user_id === null}
      modules={modules}
      initialModuleIds={selectedModuleIds}
      hasMoreChats={hasMoreChats}
      initialChatCursor={nextChatCursor}
    />
  )
}
