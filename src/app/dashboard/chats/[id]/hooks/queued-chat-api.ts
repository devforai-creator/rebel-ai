import type { ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import type { Message } from '@/types/database.types'
import { createApiError } from '@/lib/http/api-contract'

export interface ChatJobStatusResponse {
  status: 'pending' | 'processing' | 'success' | 'error'
  error?: string | null
  failureStage?: string | null
}

export interface QueueChatRequestPayload {
  chatId: string
  apiKeyId: string
  userMessage?: string
  deliveryMode: ChatDeliveryMode
  isRegeneration?: boolean
  regenerateAssistantMessageId?: string | null
}

export async function fetchLatestChatMessage(chatId: string): Promise<Message | null> {
  try {
    const response = await fetch(`/api/chats/${chatId}/messages/latest`, {
      cache: 'no-store',
    })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as Message
  } catch (err) {
    console.error('Failed to fetch latest message:', err)
    return null
  }
}

export async function fetchChatJobStatus(jobId: string): Promise<ChatJobStatusResponse | null> {
  try {
    const response = await fetch(`/api/chat/jobs/${jobId}`, {
      cache: 'no-store',
    })
    if (!response.ok) {
      console.warn(`Job status check failed (${response.status}), retrying...`)
      return null
    }
    return (await response.json()) as ChatJobStatusResponse
  } catch (err) {
    console.warn('Job poll network error, retrying...', err)
    return null
  }
}

export async function requestQueuedChatJob(
  payload: QueueChatRequestPayload,
): Promise<{ jobId: string }> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw await createApiError(response, 'Chat request failed.')
  }

  return (await response.json()) as { jobId: string }
}
