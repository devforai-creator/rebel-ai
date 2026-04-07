import { createClient } from '@/lib/supabase/server'
import { loadChatLorebookState } from '@/lib/lorebook/runtime'
import LorebookPanel from './LorebookPanel'

interface Props {
  chatId: string
  characterId: string
}

export default async function LorebookPanelLoader({ chatId, characterId }: Props) {
  const supabase = await createClient()

  const { entries: lorebookEntries, overrideMap } = await loadChatLorebookState({
    supabase,
    chatId,
    characterId,
  })

  if (lorebookEntries.length === 0) {
    return null
  }

  return (
    <LorebookPanel lorebookEntries={lorebookEntries} chatId={chatId} overrideMap={overrideMap} />
  )
}
