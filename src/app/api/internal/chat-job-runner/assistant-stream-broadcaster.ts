import type { createAdminClient } from '@/lib/supabase/admin'
import {
  CHAT_ASSISTANT_STREAM_EVENT,
  getChatAssistantStreamChannelName,
  type AssistantStreamBroadcastPayload,
} from '@/lib/chat/assistant-stream'
import {
  recordAssistantStreamBroadcastFailure,
  recordAssistantStreamBroadcastSuccess,
} from '@/lib/chat/assistant-stream-monitor'

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
  const metadata = {
    chatId,
    jobId: payload.jobId,
    kind: payload.kind,
  }

  if (typeof (supabase as { channel?: unknown }).channel !== 'function') {
    const error = new Error('Supabase admin client does not expose channel()')
    recordAssistantStreamBroadcastFailure(error, {
      ...metadata,
      stage: 'missing-channel-api',
    })
    console.warn('[Chat Job Runner] Assistant stream broadcast unavailable', {
      ...metadata,
      stage: 'missing-channel-api',
    })
    return
  }

  try {
    const status = await supabase.channel(getChatAssistantStreamChannelName(chatId)).send({
      type: 'broadcast',
      event: CHAT_ASSISTANT_STREAM_EVENT,
      payload,
    })

    if (status !== 'ok') {
      const error = new Error(`Assistant stream broadcast returned status ${status}`)
      recordAssistantStreamBroadcastFailure(error, {
        ...metadata,
        stage: 'send',
        status,
      })
      console.warn('[Chat Job Runner] Assistant stream broadcast failed', {
        ...metadata,
        status,
      })
      return
    }

    recordAssistantStreamBroadcastSuccess({
      ...metadata,
      stage: 'send',
      status,
    })
  } catch (error) {
    recordAssistantStreamBroadcastFailure(error, {
      ...metadata,
      stage: 'send',
    })
    console.warn('[Chat Job Runner] Assistant stream broadcast errored', {
      ...metadata,
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
