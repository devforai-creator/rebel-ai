import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { ACTIVE_QUEUE_JOB_STATUSES } from '@/lib/queue/admission'
import type { StorySave } from './prompt'

type Supabase = SupabaseClient<Database>

export async function loadSaveForGeneration({
  supabase,
  userId,
  saveId,
}: {
  supabase: Supabase
  userId: string
  saveId: string | null | undefined
}): Promise<StorySave | null> {
  if (!saveId) return null
  const { data, error } = await supabase
    .from('character_saves')
    .select('content')
    .eq('id', saveId)
    .eq('user_id', userId)
    .single()

  // A failed read must not silently turn an ongoing playthrough into a fresh start.
  if (error || !data) throw new Error('Failed to load the attached save')
  return data
}

export async function verifySaveLinks({
  supabase,
  userId,
  characterId,
  defaultPersonaId,
}: {
  supabase: Supabase
  userId: string
  characterId?: string | null
  defaultPersonaId?: string | null
}): Promise<string | null> {
  const [character, persona] = await Promise.all([
    characterId
      ? supabase.from('characters').select('id').eq('id', characterId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    defaultPersonaId
      ? supabase
          .from('personas')
          .select('id')
          .eq('id', defaultPersonaId)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  // The authenticated client's character SELECT policy includes public/starter cards.
  if (characterId && (character.error || !character.data)) return '연결할 캐릭터를 찾을 수 없습니다'
  if (defaultPersonaId && (persona.error || !persona.data))
    return '기본 페르소나를 찾을 수 없습니다'
  return null
}

export async function verifySaveIsIdle({
  supabase,
  userId,
  saveId,
}: {
  supabase: Supabase
  userId: string
  saveId: string
}): Promise<string | null> {
  const { data: chats, error: chatsError } = await supabase
    .from('chats')
    .select('id')
    .eq('user_id', userId)
    .eq('save_id', saveId)
  if (chatsError) return '세이브 사용 상태를 확인하지 못했습니다'
  if (!chats?.length) return null

  const { data: jobs, error } = await supabase
    .from('chat_generation_jobs')
    .select('id')
    .eq('user_id', userId)
    .in(
      'chat_id',
      chats.map((chat) => chat.id),
    )
    .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
    .limit(1)
  if (error) return '세이브 사용 상태를 확인하지 못했습니다'
  return jobs?.length ? '연결된 채팅의 답변이 끝난 후 세이브를 변경해주세요' : null
}
