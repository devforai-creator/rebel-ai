import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toRisuFormat, generateExportFilename } from '@/lib/chat/risu-converter'
import type { RebelMessage, RebelSummary, RebelFact } from '@/types/risu-chat'

interface ChatWithCharacter {
  id: string
  title: string | null
  character_id: string
  characters: { name: string }
}

export async function GET(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get chat info and character name
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select(
      `
      id,
      title,
      character_id,
      characters!inner (
        name
      )
    `,
    )
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (chatError || !chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const typedChat = chat as unknown as ChatWithCharacter

  // Fetch all messages with pagination (Supabase default limit is 1000)
  const allMessages: Array<{
    id: string
    role: string
    content: string
    model_used: string | null
    prompt_tokens: number | null
    completion_tokens: number | null
    created_at: string
  }> = []
  const PAGE_SIZE = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content, model_used, prompt_tokens, completion_tokens, created_at')
      .eq('chat_id', chatId)
      .order('sequence', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('[Chat export] Failed to fetch messages:', error)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    if (data && data.length > 0) {
      allMessages.push(...data)
      offset += PAGE_SIZE
      hasMore = data.length === PAGE_SIZE
    } else {
      hasMore = false
    }
  }

  // Get summaries and facts (parallel)
  const [summariesResult, factsResult] = await Promise.all([
    supabase
      .from('chat_summaries')
      .select('level, start_seq, end_seq, summary, token_count, created_at')
      .eq('chat_id', chatId)
      .order('start_seq', { ascending: true }),
    supabase
      .from('chat_facts')
      .select('start_seq, end_seq, facts, created_at')
      .eq('chat_id', chatId)
      .order('start_seq', { ascending: true }),
  ])

  const summaries: RebelSummary[] = (summariesResult.data || []).map((s) => ({
    level: s.level,
    start_seq: s.start_seq,
    end_seq: s.end_seq,
    summary: s.summary,
    token_count: s.token_count,
    created_at: s.created_at,
  }))
  const facts: RebelFact[] = (factsResult.data || []).map((f) => ({
    start_seq: f.start_seq,
    end_seq: f.end_seq,
    facts: f.facts,
    created_at: f.created_at ?? undefined,
  }))

  // Convert RebelAI to RisuAI format
  const rebelMessages: RebelMessage[] = allMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    model_used: msg.model_used,
    prompt_tokens: msg.prompt_tokens,
    completion_tokens: msg.completion_tokens,
    created_at: msg.created_at,
  }))

  const risuChat = toRisuFormat(
    rebelMessages,
    {
      characterName: typedChat.characters.name,
      chatTitle: typedChat.title || undefined,
      exportedAt: new Date().toISOString(),
      source: 'RebelAI',
    },
    {
      summaries,
      facts,
    },
  )

  // Generate filename
  const filename = generateExportFilename(typedChat.characters.name, typedChat.title || undefined)

  // Return as JSON file
  return new NextResponse(JSON.stringify(risuChat, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  })
}
