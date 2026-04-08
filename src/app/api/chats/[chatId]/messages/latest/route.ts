import { createClient } from '@/lib/supabase/server'
import { loadLatestProjectedMessage } from '@/lib/chat/turns'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await params
    const supabase = await createClient()

    // 사용자 인증 확인
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // 채팅 소유권 확인
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return new Response('Chat not found', { status: 404 })
    }

    const message = await loadLatestProjectedMessage({
      supabase,
      chatId,
    })

    return Response.json(message)
  } catch (error) {
    console.error('Latest message API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
