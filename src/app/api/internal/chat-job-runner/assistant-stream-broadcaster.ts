import type { createAdminClient } from '@/lib/supabase/admin'
import {
  CHAT_ASSISTANT_STREAM_EVENT,
  getChatAssistantStreamChannelName,
  type AssistantStreamBroadcastPayload,
} from '@/lib/chat/assistant-stream'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>

async function broadcastAssistantStreamEvent({
  supabase,
  chatId,
  payload,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  payload: AssistantStreamBroadcastPayload
}): Promise<void> {
  if (typeof (supabase as { channel?: unknown }).channel !== 'function') {
    return
  }

  try {
    const status = await supabase.channel(getChatAssistantStreamChannelName(chatId)).send({
      type: 'broadcast',
      event: CHAT_ASSISTANT_STREAM_EVENT,
      payload,
    })

    if (status !== 'ok') {
      console.warn('[Chat Job Runner] Assistant stream broadcast failed', {
        chatId,
        kind: payload.kind,
        status,
      })
    }
  } catch (error) {
    console.warn('[Chat Job Runner] Assistant stream broadcast errored', {
      chatId,
      kind: payload.kind,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function broadcastAssistantStreamSnapshot({
  supabase,
  chatId,
  jobId,
  content,
  regenerateAssistantMessageId,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  jobId: string
  content: string
  regenerateAssistantMessageId: string | null
}): Promise<void> {
  await broadcastAssistantStreamEvent({
    supabase,
    chatId,
    payload: {
      kind: 'snapshot',
      jobId,
      content,
      regenerateAssistantMessageId,
    },
  })
}

export async function broadcastAssistantStreamError({
  supabase,
  chatId,
  jobId,
  error,
  regenerateAssistantMessageId,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  jobId: string
  error: string
  regenerateAssistantMessageId: string | null
}): Promise<void> {
  await broadcastAssistantStreamEvent({
    supabase,
    chatId,
    payload: {
      kind: 'error',
      jobId,
      error,
      regenerateAssistantMessageId,
    },
  })
}
