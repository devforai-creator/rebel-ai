'use client'

import { useEffect, useMemo } from 'react'
import type { Message } from '@/types/database.types'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import {
  CHAT_ASSISTANT_STREAM_EVENT,
  getChatAssistantStreamChannelName,
  type AssistantStreamBroadcastPayload,
} from '@/lib/chat/assistant-stream'
import type { MessageChangePayload } from '../utils'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toMessageSnapshot(value: unknown): Partial<Message> | null {
  return isRecord(value) ? (value as Partial<Message>) : null
}

export function parseMessageChangePayload(payload: unknown): MessageChangePayload | null {
  if (
    !isRecord(payload) ||
    (payload.eventType !== 'INSERT' &&
      payload.eventType !== 'UPDATE' &&
      payload.eventType !== 'DELETE')
  ) {
    return null
  }

  return {
    eventType: payload.eventType,
    new: toMessageSnapshot(payload.new),
    old: toMessageSnapshot(payload.old),
  }
}

export function parseAssistantStreamBroadcastPayload(
  payload: unknown,
): AssistantStreamBroadcastPayload | null {
  if (
    !isRecord(payload) ||
    typeof payload.jobId !== 'string' ||
    !(
      typeof payload.regenerateAssistantMessageId === 'string' ||
      payload.regenerateAssistantMessageId === null
    )
  ) {
    return null
  }

  if (payload.kind === 'snapshot' && typeof payload.content === 'string') {
    return {
      kind: 'snapshot',
      jobId: payload.jobId,
      content: payload.content,
      regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
    }
  }

  if (payload.kind === 'error' && typeof payload.error === 'string') {
    return {
      kind: 'error',
      jobId: payload.jobId,
      error: payload.error,
      regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
    }
  }

  return null
}

export function useChatRealtimeSubscription({
  chatId,
  onMessageChange,
  onAssistantStreamEvent,
}: {
  chatId: string
  onMessageChange: (payload: MessageChangePayload) => void
  onAssistantStreamEvent: (payload: AssistantStreamBroadcastPayload) => void
}) {
  const supabase = useMemo(() => createSupabaseClient(), [])

  useEffect(() => {
    let isActive = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    const setupChannel = async () => {
      try {
        await supabase.auth.getSession()
        if (!isActive) {
          return
        }

        channel = supabase
          .channel(getChatAssistantStreamChannelName(chatId), {
            config: {
              broadcast: { self: true },
              presence: { key: `token-stats-${chatId}` },
            },
          })
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'messages',
              filter: `chat_id=eq.${chatId}`,
            },
            (payload) => {
              const messagePayload = parseMessageChangePayload(payload)
              if (messagePayload) {
                onMessageChange(messagePayload)
              }
            },
          )
          .on('broadcast', { event: CHAT_ASSISTANT_STREAM_EVENT }, (payload) => {
            const streamPayload = parseAssistantStreamBroadcastPayload(payload.payload)
            if (streamPayload) {
              onAssistantStreamEvent(streamPayload)
            }
          })
          .subscribe()
      } catch (error) {
        console.error('[Chat realtime] Failed to initialize subscription', error)
      }
    }

    void setupChannel()

    return () => {
      isActive = false
      if (channel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [chatId, onAssistantStreamEvent, onMessageChange, supabase])
}
