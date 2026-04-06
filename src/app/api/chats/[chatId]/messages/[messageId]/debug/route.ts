import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string; messageId: string }> },
) {
  try {
    const { chatId, messageId } = await params
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

    // 메시지의 debug_info 가져오기
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, debug_info')
      .eq('id', messageId)
      .eq('chat_id', chatId)
      .single()

    if (messageError || !message) {
      return new Response('Message not found', { status: 404 })
    }

    return Response.json({ debugInfo: message.debug_info })
  } catch (error) {
    console.error('Debug info API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
