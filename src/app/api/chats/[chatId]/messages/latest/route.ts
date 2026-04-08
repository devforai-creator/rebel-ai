import { createClient } from '@/lib/supabase/server'
import { MESSAGE_STATUS_GENERATING, MESSAGE_STATUS_SUPERSEDED } from '@/lib/chat/message-status'
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

    // 최근 메시지 1개 가져오기
    // Note: debug_info included for dev tools; cleared for old messages by job runner
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select(
        'id, chat_id, role, content, sequence, created_at, model_used, prompt_tokens, completion_tokens, debug_info, turn_id, variant_index, supersedes_message_id, message_status',
      )
      .eq('chat_id', chatId)
      .neq('message_status', MESSAGE_STATUS_SUPERSEDED)
      .neq('message_status', MESSAGE_STATUS_GENERATING)
      .order('created_at', { ascending: false })
      .limit(1)

    if (messagesError) {
      return new Response('Failed to fetch messages', { status: 500 })
    }

    return Response.json(messages?.[0] || null)
  } catch (error) {
    console.error('Latest message API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
