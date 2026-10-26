'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { characterSaveInputSchema } from '@/lib/character-saves/validation'
import { verifySaveIsIdle, verifySaveLinks } from '@/lib/character-saves/service'
import { ACTIVE_QUEUE_JOB_STATUSES } from '@/lib/queue/admission'

function revalidateSaves(characterId?: string | null) {
  revalidatePath('/dashboard/saves')
  if (characterId) revalidatePath('/dashboard/characters/' + characterId)
}

export async function createCharacterSave(input: unknown) {
  const parsed = characterSaveInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다' }

  const data = parsed.data
  const linkError = await verifySaveLinks({ supabase, userId: user.id, ...data })
  if (linkError) return { error: linkError }
  const { data: save, error } = await supabase
    .from('character_saves')
    .insert({
      user_id: user.id,
      title: data.title,
      content: data.content,
      character_id: data.characterId,
      default_persona_id: data.defaultPersonaId,
    })
    .select('id')
    .single()
  if (error || !save) return { error: '세이브를 만들지 못했습니다' }
  revalidateSaves(data.characterId)
  return { saveId: save.id }
}

export async function updateCharacterSave(saveId: string, input: unknown) {
  const parsed = characterSaveInputSchema.safeParse(input)
  if (!z.uuid().safeParse(saveId).success || !parsed.success)
    return { error: '입력값을 확인해주세요' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다' }
  const { data: save, error } = await supabase
    .from('character_saves')
    .select('id, character_id, default_persona_id')
    .eq('id', saveId)
    .eq('user_id', user.id)
    .single()
  if (error || !save) return { error: '세이브를 찾을 수 없습니다' }

  const data = parsed.data
  const [linkError, activeError] = await Promise.all([
    verifySaveLinks({
      supabase,
      userId: user.id,
      characterId: data.characterId === save.character_id ? undefined : data.characterId,
      defaultPersonaId:
        data.defaultPersonaId === save.default_persona_id ? undefined : data.defaultPersonaId,
    }),
    verifySaveIsIdle({ supabase, userId: user.id, saveId }),
  ])
  if (linkError || activeError) return { error: linkError || activeError }
  const { error: updateError } = await supabase
    .from('character_saves')
    .update({
      title: data.title,
      content: data.content,
      character_id: data.characterId,
      default_persona_id: data.defaultPersonaId,
    })
    .eq('id', saveId)
    .eq('user_id', user.id)
  if (updateError) return { error: '세이브를 수정하지 못했습니다' }
  revalidateSaves(save.character_id)
  if (data.characterId !== save.character_id) revalidateSaves(data.characterId)
  return { success: true }
}

export async function deleteCharacterSave(saveId: string) {
  if (!z.uuid().safeParse(saveId).success) return { error: '세이브를 찾을 수 없습니다' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다' }
  const { data: save, error } = await supabase
    .from('character_saves')
    .select('id, character_id')
    .eq('id', saveId)
    .eq('user_id', user.id)
    .single()
  if (error || !save) return { error: '세이브를 찾을 수 없습니다' }
  const activeError = await verifySaveIsIdle({ supabase, userId: user.id, saveId })
  if (activeError) return { error: activeError }
  const { error: deleteError } = await supabase
    .from('character_saves')
    .delete()
    .eq('id', saveId)
    .eq('user_id', user.id)
  if (deleteError) return { error: '세이브를 삭제하지 못했습니다' }
  revalidateSaves(save.character_id)
  return { success: true }
}

export async function updateChatSave(chatId: string, saveId: string | null) {
  if (
    !z.uuid().safeParse(chatId).success ||
    (saveId !== null && !z.uuid().safeParse(saveId).success)
  )
    return { error: '연결 정보를 확인해주세요' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다' }
  const { data: chat, error } = await supabase
    .from('chats')
    .select('id, character_id, save_id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()
  if (error || !chat) return { error: '채팅을 찾을 수 없습니다' }
  if (chat.save_id === saveId) return { success: true }
  if (saveId) {
    const { data: save, error: saveError } = await supabase
      .from('character_saves')
      .select('character_id')
      .eq('id', saveId)
      .eq('user_id', user.id)
      .single()
    if (saveError || !save || save.character_id !== chat.character_id)
      return { error: '이 캐릭터에 연결된 본인 세이브를 선택해주세요' }
  }
  const { data: jobs, error: jobsError } = await supabase
    .from('chat_generation_jobs')
    .select('id')
    .eq('chat_id', chatId)
    .eq('user_id', user.id)
    .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
    .limit(1)
  if (jobsError) return { error: '답변 상태를 확인하지 못했습니다' }
  if (jobs?.length) return { error: '답변이 끝난 후 세이브를 변경해주세요' }

  const { error: updateError } = await supabase
    .from('chats')
    .update({ save_id: saveId })
    .eq('id', chatId)
    .eq('user_id', user.id)
  if (updateError) return { error: '세이브를 연결하지 못했습니다' }
  revalidatePath('/dashboard/chats/' + chatId)
  return { success: true }
}
