'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { chatTitleSchema } from '@/lib/chat/chat-list-contract'

type ChatListUpdate = { title: string } | { is_bookmarked: boolean }

async function updateOwnedChat(chatId: string, update: ChatListUpdate) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { error: '로그인이 필요합니다.' }
  const { data, error } = await supabase
    .from('chats')
    .update(update)
    .eq('id', chatId)
    .eq('user_id', user.id)
    .select('id, character_id, title, is_bookmarked')
    .maybeSingle()
  if (error) return { error: '채팅방 변경을 저장하지 못했습니다. 다시 시도해주세요.' }
  if (!data) return { error: '채팅방을 찾을 수 없거나 접근 권한이 없습니다.' }
  revalidatePath(`/dashboard/characters/${data.character_id}`)
  revalidatePath(`/dashboard/chats/${data.id}`)
  revalidatePath('/dashboard/chats')
  revalidatePath('/dashboard')
  return { chat: data }
}

export async function renameChat(chatId: string, title: string) {
  const parsed = z.object({ chatId: z.uuid(), title: chatTitleSchema }).safeParse({ chatId, title })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  return updateOwnedChat(parsed.data.chatId, { title: parsed.data.title })
}

export async function setChatBookmarked(chatId: string, isBookmarked: boolean) {
  const parsed = z
    .object({ chatId: z.uuid(), isBookmarked: z.boolean() })
    .safeParse({ chatId, isBookmarked })
  if (!parsed.success) return { error: '올바른 채팅방과 북마크 상태를 지정해주세요.' }
  return updateOwnedChat(parsed.data.chatId, { is_bookmarked: parsed.data.isBookmarked })
}
