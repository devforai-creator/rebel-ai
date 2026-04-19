import 'server-only'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type SummaryActionContext =
  | {
      supabase: Awaited<ReturnType<typeof createClient>>
      userId: string
    }
  | {
      error: string
    }

export async function requireOwnedChatActionContext(chatId: string): Promise<SummaryActionContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { data: chat } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!chat) {
    return { error: 'Chat not found' }
  }

  return {
    supabase,
    userId: user.id,
  }
}

export function revalidateSummaryChatPath(chatId: string) {
  revalidatePath(`/dashboard/chats/${chatId}`)
}
