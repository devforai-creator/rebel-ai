import { useState, useCallback } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { toast } from 'sonner'
import type { Message } from '@/types/database.types'
import type { AlternateModelsConfig } from '@/lib/chat/model-config'
import {
  DisplayMessage,
  MessageChangePayload,
  DebugInfo,
  mapMessageToDisplay,
  buildSanitizedMessages,
} from '../utils'
import { isVisibleMessageStatus } from '@/lib/chat/message-status'
import { resolveAlternateApiKeyId } from '@/lib/chat/alternate-models'
import { pollJobStatus as pollJobStatusPure, DEFAULT_JOB_POLLER_CONFIG } from './job-poller'

export interface UseQueuedChatParams {
  chatId: string
  initialMessages: Message[]
  historyMessages: Message[]
  selectedApiKeyId: string
  alternateModels?: AlternateModelsConfig | null
  fetchLatestUsage: () => Promise<void>
  debugInfoMap: React.MutableRefObject<Map<string, DebugInfo>>
  persistedMessageIds: React.MutableRefObject<Set<string>>
}

export interface UseQueuedChatReturn {
  messages: DisplayMessage[]
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>
  input: string
  handleInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (event?: FormEvent<HTMLFormElement>) => void
  isLoading: boolean
  error: Error | null
  reload: (options?: {
    body?: { isRegeneration?: boolean; regenerateAssistantMessageId?: string }
  }) => void
  handleRealtimeMessageChange: (payload: MessageChangePayload) => void
}

export function useQueuedChat({
  chatId,
  initialMessages,
  historyMessages,
  selectedApiKeyId,
  alternateModels,
  fetchLatestUsage,
  debugInfoMap,
  persistedMessageIds,
}: UseQueuedChatParams): UseQueuedChatReturn {
  const [messages, setMessages] = useState<DisplayMessage[]>(() =>
    initialMessages.map(mapMessageToDisplay),
  )
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [pendingRegenerationTargetId, setPendingRegenerationTargetId] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<Error | null>(null)

  const handleInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value)
  }, [])

  const upsertAssistantMessage = useCallback(
    (assistantMessage: Message) => {
      if (!isVisibleMessageStatus(assistantMessage.message_status)) {
        if (pendingRegenerationTargetId === assistantMessage.id) {
          return
        }

        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessage.id))
        persistedMessageIds.current.delete(assistantMessage.id)
        debugInfoMap.current.delete(assistantMessage.id)
        return
      }

      const debugInfo = assistantMessage.debug_info as DebugInfo | null | undefined
      if (debugInfo) {
        debugInfoMap.current.set(assistantMessage.id, debugInfo)
      }
      persistedMessageIds.current.add(assistantMessage.id)

      setMessages((prev) => {
        const mapped = mapMessageToDisplay(assistantMessage)
        const existingIndex = prev.findIndex((msg) => msg.id === mapped.id)
        if (existingIndex !== -1) {
          const next = [...prev]
          next[existingIndex] = mapped
          return next
        }

        if (pendingRegenerationTargetId) {
          const targetIndex = prev.findIndex((msg) => msg.id === pendingRegenerationTargetId)
          if (targetIndex !== -1) {
            const next = [...prev]
            next[targetIndex] = mapped
            next.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
            return next
          }
        }

        const next = [...prev, mapped]
        next.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        return next
      })

      if (pendingRegenerationTargetId) {
        persistedMessageIds.current.delete(pendingRegenerationTargetId)
        debugInfoMap.current.delete(pendingRegenerationTargetId)
        setPendingRegenerationTargetId(null)
      }
    },
    [debugInfoMap, pendingRegenerationTargetId, persistedMessageIds],
  )

  const fetchLatestMessage = useCallback(async () => {
    try {
      const response = await fetch(`/api/chats/${chatId}/messages/latest`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        return null
      }
      return (await response.json()) as Message & { debug_info?: DebugInfo }
    } catch (err) {
      console.error('Failed to fetch latest message:', err)
      return null
    }
  }, [chatId])

  const syncLatestUserMessage = useCallback(async () => {
    const latest = await fetchLatestMessage()
    if (!latest || latest.role !== 'user') {
      return
    }

    if (latest.debug_info) {
      debugInfoMap.current.set(latest.id, latest.debug_info as DebugInfo)
    }
    persistedMessageIds.current.add(latest.id)

    setMessages((prev) => {
      const next = [...prev]
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index].temp && next[index].role === 'user') {
          next[index] = mapMessageToDisplay(latest)
          return next
        }
      }
      if (next.some((msg) => msg.id === latest.id)) {
        return next
      }
      return [...next, mapMessageToDisplay(latest)]
    })
  }, [fetchLatestMessage, debugInfoMap, persistedMessageIds])

  const appendAssistantMessage = useCallback(async () => {
    const latest = await fetchLatestMessage()
    if (!latest || latest.role !== 'assistant') {
      return
    }
    upsertAssistantMessage(latest)
  }, [fetchLatestMessage, upsertAssistantMessage])

  const pollJobStatus = useCallback(
    async (jobId: string) => {
      const result = await pollJobStatusPure(
        jobId,
        {
          fetchJobStatus: async (id) => {
            try {
              const response = await fetch(`/api/chat/jobs/${id}`, {
                cache: 'no-store',
              })
              if (!response.ok) {
                console.warn(`Job status check failed (${response.status}), retrying...`)
                return null
              }
              return await response.json()
            } catch (err) {
              console.warn('Job poll network error, retrying...', err)
              return null
            }
          },
          onSuccess: async () => {
            setPendingJobId(null)
            await appendAssistantMessage()
            await fetchLatestUsage()
          },
          onError: (error) => {
            setPendingJobId(null)
            setPendingRegenerationTargetId(null)
            const isTimeout = error.message.includes('timed out')
            toast.error(error.message, {
              duration: isTimeout ? 10000 : 5000,
              description: isTimeout
                ? 'Try sending your message again, or check your connection.'
                : undefined,
            })
          },
          onSlowProgress: (elapsedMs) => {
            const seconds = Math.round(elapsedMs / 1000)
            toast.info(`Response is taking longer than usual (${seconds}s). Still waiting...`, {
              duration: 8000,
            })
          },
          now: () => Date.now(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        DEFAULT_JOB_POLLER_CONFIG,
      )

      if (result.outcome !== 'success') {
        throw result.error
      }
    },
    [appendAssistantMessage, fetchLatestUsage],
  )

  const handleRealtimeMessageChange = useCallback(
    (payload: MessageChangePayload) => {
      const newMessage = (payload.new as Message | null) ?? null
      const oldMessage = (payload.old as Message | null) ?? null

      if (payload.eventType === 'INSERT' && newMessage && newMessage.role === 'assistant') {
        upsertAssistantMessage(newMessage)
        return
      }

      if (payload.eventType === 'UPDATE' && newMessage && newMessage.role === 'assistant') {
        upsertAssistantMessage(newMessage)
        return
      }

      if (payload.eventType === 'DELETE' && oldMessage && oldMessage.role === 'assistant') {
        setMessages((prev) => prev.filter((msg) => msg.id !== oldMessage.id))
        persistedMessageIds.current.delete(oldMessage.id)
        debugInfoMap.current.delete(oldMessage.id)
      }
    },
    [debugInfoMap, persistedMessageIds, upsertAssistantMessage],
  )

  const resolveNextApiKeyId = useCallback(
    () =>
      resolveAlternateApiKeyId({
        alternateModels,
        selectedApiKeyId,
        messages,
      }),
    [alternateModels, messages, selectedApiKeyId],
  )

  const sendChatRequest = useCallback(
    async ({
      messagesPayload,
      isRegeneration = false,
      regenerateAssistantMessageId = null,
      removeTempMessage,
      syncUser = false,
    }: {
      messagesPayload: Array<{ role: 'user' | 'assistant'; content: string }>
      isRegeneration?: boolean
      regenerateAssistantMessageId?: string | null
      removeTempMessage?: () => void
      syncUser?: boolean
    }) => {
      const resolvedApiKeyId = resolveNextApiKeyId()
      if (!resolvedApiKeyId) {
        const err = new Error('Please select an API key.')
        setError(err)
        toast.error(err.message)
        removeTempMessage?.()
        throw err
      }

      setSending(true)
      setError(null)
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId,
            apiKeyId: resolvedApiKeyId,
            messages: messagesPayload,
            isRegeneration,
            regenerateAssistantMessageId,
          }),
        })

        if (!response.ok) {
          const text = await response.text()
          throw new Error(text || 'Chat request failed.')
        }

        if (!isRegeneration && syncUser) {
          await syncLatestUserMessage()
        }

        const data = (await response.json()) as { jobId: string }
        setPendingJobId(data.jobId)
        await pollJobStatus(data.jobId)
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error('Chat request failed.')
        setError(normalized)
        if (isRegeneration) {
          setPendingRegenerationTargetId(null)
        }
        // Only show toast if not already shown by pollJobStatus
        if (
          !normalized.message.includes('timed out') &&
          !normalized.message.includes('Failed to generate')
        ) {
          toast.error(normalized.message)
        }
        removeTempMessage?.()
        throw normalized
      } finally {
        setSending(false)
      }
    },
    [chatId, resolveNextApiKeyId, pollJobStatus, syncLatestUserMessage],
  )

  const handleSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      const trimmed = input.trim()
      if (!trimmed || sending || pendingJobId) {
        return
      }

      const tempMessage: DisplayMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
        temp: true,
      }

      const nextMessages = [...messages, tempMessage]
      setMessages(nextMessages)
      setInput('')

      const payload = buildSanitizedMessages(historyMessages, nextMessages)
      void sendChatRequest({
        messagesPayload: payload,
        syncUser: true,
        removeTempMessage: () => {
          setMessages((prev) => prev.filter((msg) => msg.id !== tempMessage.id))
        },
      }).catch(() => {
        // No-op: error state already set in sendChatRequest
      })
    },
    [historyMessages, input, messages, pendingJobId, sending, sendChatRequest],
  )

  const reload = useCallback(
    (options?: { body?: { isRegeneration?: boolean; regenerateAssistantMessageId?: string } }) => {
      const targetId = options?.body?.regenerateAssistantMessageId
      if (!options?.body?.isRegeneration || !targetId) {
        return
      }

      if (!persistedMessageIds.current.has(targetId)) {
        setError(new Error('Message not yet saved. Please try again in a moment.'))
        return
      }

      setPendingRegenerationTargetId(targetId)

      const payload = buildSanitizedMessages(historyMessages, messages)
      void sendChatRequest({
        messagesPayload: payload,
        isRegeneration: true,
        regenerateAssistantMessageId: targetId,
      }).catch(() => {
        // Error state handled inside sendChatRequest
      })
    },
    [messages, historyMessages, persistedMessageIds, sendChatRequest],
  )

  return {
    messages,
    setMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading: sending || pendingJobId !== null,
    error,
    reload,
    handleRealtimeMessageChange,
  }
}
