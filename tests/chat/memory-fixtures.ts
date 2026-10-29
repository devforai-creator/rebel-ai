import type { ChatMemoryMode } from '@/lib/chat/model-config'
import type { ServerSupabaseClient } from '@/lib/chat-summaries/types'
import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'

export function createMemoryConversation({
  count,
  chunkCount = Math.floor(Math.max(0, count - 4) / 10),
  missingChunkStart,
  mode = 'prefix_live_blocks',
  clearLastAssistant = false,
}: {
  count: number
  chunkCount?: number
  missingChunkStart?: number
  mode?: ChatMemoryMode
  clearLastAssistant?: boolean
}) {
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `msg-${index + 1}`,
    chat_id: 'chat-1',
    user_id: 'user-1',
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `conversation message ${index + 1}`,
    sequence: index * 3 + 7,
    message_status: 'completed',
    created_at: '2026-10-29T00:00:00.000Z',
  }))
  const turns = Array.from({ length: Math.ceil(count / 2) }, (_, index) => ({
    id: `turn-${index + 1}`,
    chat_id: 'chat-1',
    turn_index: index + 1,
    user_message_id: messages[index * 2]?.id ?? null,
    active_assistant_message_id:
      clearLastAssistant && index === Math.ceil(count / 2) - 1
        ? null
        : (messages[index * 2 + 1]?.id ?? null),
  }))
  const summaries = [
    ...Array.from({ length: chunkCount }, (_, index) => ({
      id: `chunk-${index + 1}`,
      chat_id: 'chat-1',
      level: 0,
      start_seq: index * 10 + 1,
      end_seq: index * 10 + 10,
      summary: `chunk ${index * 10 + 1}-${index * 10 + 10}`,
      summary_status: 'ok',
      created_at: '2026-10-29T00:00:00.000Z',
    })).filter((row) => row.start_seq !== missingChunkStart),
    ...Array.from({ length: Math.floor(chunkCount / 10) }, (_, index) => ({
      id: `meta-${index + 1}`,
      chat_id: 'chat-1',
      level: 1,
      start_seq: index * 100 + 1,
      end_seq: index * 100 + 100,
      summary: `meta ${index * 100 + 1}-${index * 100 + 100}`,
      summary_status: 'ok',
      created_at: '2026-10-29T00:00:00.000Z',
    })),
  ]
  const db = createChatJobRunnerSupabaseMock({
    chat: {
      id: 'chat-1',
      user_id: 'user-1',
      character_id: 'char-1',
      model_config: { memory: { mode, retainTailMessages: 4 } },
    },
    profile: { id: 'user-1', enable_episodic_rag: false },
    initialTurns: turns,
    initialMessages: [
      ...messages,
      ...['system', 'superseded', 'generating', 'orphan'].map((kind, index) => ({
        id: `noise-${kind}`,
        chat_id: 'chat-1',
        role: kind === 'system' ? 'system' : 'assistant',
        content: `not in the active conversation: ${kind}`,
        sequence: count * 3 + 20 + index,
        message_status: kind === 'system' || kind === 'orphan' ? 'completed' : kind,
      })),
    ],
    initialChatSummaries: summaries,
  })
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  }
  const client = Object.assign(db, {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    channel: () => channel,
    removeChannel: async () => undefined,
  })

  return {
    client: client as unknown as ServerSupabaseClient,
    db,
    messages,
    lastTurnId: turns.at(-1)!.id,
  }
}
