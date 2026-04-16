import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { toast } from 'sonner'
import type { Message } from '@/types/database.types'
import type { AlternateModelsConfig } from '@/lib/chat/model-config'
import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
  type ChatDeliveryMode,
} from '@/lib/chat/delivery-mode'
import { CHAT_JOB_POLLER_LIMITS } from '@/lib/chat/runtime-limits'
import type { AssistantStreamBroadcastPayload } from '@/lib/chat/assistant-stream'
import {
  DisplayMessage,
  MessageChangePayload,
  DebugInfo,
  StreamingAssistantDraft,
  mapMessageToDisplay,
  buildSanitizedMessages,
} from '../utils'
import { isVisibleMessageStatus } from '@/lib/chat/message-status'
import { resolveAlternateApiKeyId } from '@/lib/chat/alternate-models'
import {
  pollJobStatus as pollJobStatusPure,
  DEFAULT_JOB_POLLER_CONFIG,
  resolveAdaptivePollDelay,
} from './job-poller'
import { fetchChatJobStatus, fetchLatestChatMessage, requestQueuedChatJob } from './queued-chat-api'
import { reconcileAssistantMessage } from './reconcile-assistant-message'

export interface UseQueuedChatParams {
  chatId: string
  initialMessages: Message[]
  historyMessages: Message[]
  selectedApiKeyId: string
  deliveryMode?: ChatDeliveryMode
  alternateModels?: AlternateModelsConfig | null
  fetchLatestUsage: () => Promise<void>
  debugInfoMap: React.MutableRefObject<Map<string, DebugInfo>>
  persistedMessageIds: React.MutableRefObject<Set<string>>
}

export interface UseQueuedChatReturn {
  messages: DisplayMessage[]
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>
  streamingDraft: StreamingAssistantDraft | null
  input: string
  handleInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (event?: FormEvent<HTMLFormElement>) => void
  isLoading: boolean
  error: Error | null
  reload: (options?: {
    body?: { isRegeneration?: boolean; regenerateAssistantMessageId?: string }
  }) => void
  handleRealtimeMessageChange: (payload: MessageChangePayload) => void
  handleAssistantStreamEvent: (payload: AssistantStreamBroadcastPayload) => void
}

export function useQueuedChat({
  chatId,
  initialMessages,
  historyMessages,
  selectedApiKeyId,
  deliveryMode = CHAT_DELIVERY_MODE_STREAMING,
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
  const pendingJobIdRef = useRef<string | null>(null)
  const pendingAssistantVisibleRef = useRef(false)
  const pendingRegenerationTargetIdRef = useRef<string | null>(null)
  const lastStreamProgressAtRef = useRef<number | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  )
  const [streamingDraft, setStreamingDraft] = useState<StreamingAssistantDraft | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const syncPageVisibility = () => {
      setIsPageVisible(!document.hidden)
    }

    document.addEventListener('visibilitychange', syncPageVisibility)
    return () => {
      document.removeEventListener('visibilitychange', syncPageVisibility)
    }
  }, [])

  const handleInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value)
  }, [])

  const upsertAssistantMessage = useCallback(
    (assistantMessage: Message) => {
      const debugInfo = assistantMessage.debug_info as DebugInfo | null | undefined
      if (debugInfo) {
        debugInfoMap.current.set(assistantMessage.id, debugInfo)
      }

      setMessages((prev) => {
        const pendingRegenerationTargetId = pendingRegenerationTargetIdRef.current
        const { nextMessages, idsToForget } = reconcileAssistantMessage({
          prevMessages: prev,
          assistantMessage,
          pendingRegenerationTargetId,
        })

        if (isVisibleMessageStatus(assistantMessage.message_status)) {
          persistedMessageIds.current.add(assistantMessage.id)
        }

        for (const id of idsToForget) {
          persistedMessageIds.current.delete(id)
          debugInfoMap.current.delete(id)

          if (pendingRegenerationTargetId === id) {
            pendingRegenerationTargetIdRef.current = null
          }
        }

        return nextMessages
      })

      if (
        pendingJobIdRef.current &&
        isVisibleMessageStatus(assistantMessage.message_status) &&
        assistantMessage.id !== pendingRegenerationTargetIdRef.current
      ) {
        pendingAssistantVisibleRef.current = true
        setStreamingDraft(null)
      }
    },
    [debugInfoMap, persistedMessageIds],
  )

  const startStreamingDraft = useCallback(
    (jobId: string, regenerateAssistantMessageId: string | null) => {
      pendingAssistantVisibleRef.current = false
      lastStreamProgressAtRef.current = null
      const isBatchMode = deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
      setStreamingDraft({
        id: `stream-${jobId}`,
        jobId,
        role: 'assistant',
        content: isBatchMode
          ? 'Claude Batch 처리 중입니다. 이 모드는 스트리밍 없이 완료 후 한 번에 표시됩니다.'
          : '',
        created_at: new Date().toISOString(),
        streaming: true,
        replaceMessageId: regenerateAssistantMessageId,
        deliveryMode,
      })
    },
    [deliveryMode],
  )

  const clearPendingJob = useCallback(() => {
    pendingJobIdRef.current = null
    pendingAssistantVisibleRef.current = false
    lastStreamProgressAtRef.current = null
    setPendingJobId(null)
  }, [])

  const fetchLatestMessage = useCallback(async () => {
    return fetchLatestChatMessage(chatId) as Promise<(Message & { debug_info?: DebugInfo }) | null>
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
            return fetchChatJobStatus(id)
          },
          getLastProgressAt: () => lastStreamProgressAtRef.current,
          onSuccess: async () => {
            if (!pendingAssistantVisibleRef.current) {
              await appendAssistantMessage()
            }
            await fetchLatestUsage()
            clearPendingJob()
            setStreamingDraft(null)
          },
          onError: (error) => {
            clearPendingJob()
            pendingRegenerationTargetIdRef.current = null
            setStreamingDraft(null)
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
            const message =
              deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
                ? `Claude Batch is still processing (${seconds}s). It will appear here when finished.`
                : `Response is taking longer than usual (${seconds}s). Still waiting...`
            toast.info(message, { duration: 8000 })
          },
          now: () => Date.now(),
          sleep: (ms) => {
            const delayMs =
              deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
                ? ms
                : resolveAdaptivePollDelay({
                    baseDelayMs: ms,
                    isPageVisible,
                    lastProgressAt: lastStreamProgressAtRef.current,
                    now: Date.now(),
                    hiddenTabMinDelayMs: CHAT_JOB_POLLER_LIMITS.hiddenTabMinDelayMs,
                    recentStreamWindowMs: CHAT_JOB_POLLER_LIMITS.recentStreamWindowMs,
                    recentStreamMinDelayMs: CHAT_JOB_POLLER_LIMITS.recentStreamMinDelayMs,
                  })

            return new Promise((resolve) => setTimeout(resolve, delayMs))
          },
        },
        deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
          ? {
              timeoutMs: 25 * 60 * 60 * 1000,
              initialDelayMs: 3000,
              maxDelayMs: 60_000,
              backoffMultiplier: 1.4,
              slowProgressThresholdMs: 30_000,
            }
          : DEFAULT_JOB_POLLER_CONFIG,
      )

      if (result.outcome !== 'success') {
        throw result.error
      }
    },
    [appendAssistantMessage, clearPendingJob, deliveryMode, fetchLatestUsage, isPageVisible],
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

  const handleAssistantStreamEvent = useCallback((payload: AssistantStreamBroadcastPayload) => {
    if (!pendingJobIdRef.current || payload.jobId !== pendingJobIdRef.current) {
      return
    }

    if (payload.kind === 'error') {
      setStreamingDraft(null)
      return
    }

    lastStreamProgressAtRef.current = Date.now()

    setStreamingDraft((current) => {
      if (!current || current.jobId !== payload.jobId) {
        return {
          id: `stream-${payload.jobId}`,
          jobId: payload.jobId,
          role: 'assistant',
          content: payload.content,
          created_at: new Date().toISOString(),
          streaming: true,
          replaceMessageId: payload.regenerateAssistantMessageId,
        }
      }

      return {
        ...current,
        content: payload.content,
        replaceMessageId: payload.regenerateAssistantMessageId,
      }
    })
  }, [])

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
        const data = await requestQueuedChatJob({
          chatId,
          apiKeyId: resolvedApiKeyId,
          messages: messagesPayload,
          deliveryMode,
          isRegeneration,
          regenerateAssistantMessageId,
        })

        if (!isRegeneration && syncUser) {
          await syncLatestUserMessage()
        }

        pendingJobIdRef.current = data.jobId
        setPendingJobId(data.jobId)
        startStreamingDraft(data.jobId, regenerateAssistantMessageId)
        await pollJobStatus(data.jobId)
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error('Chat request failed.')
        setError(normalized)
        if (isRegeneration) {
          pendingRegenerationTargetIdRef.current = null
        }
        clearPendingJob()
        setStreamingDraft(null)
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
    [
      chatId,
      clearPendingJob,
      deliveryMode,
      pollJobStatus,
      resolveNextApiKeyId,
      startStreamingDraft,
      syncLatestUserMessage,
    ],
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

      pendingRegenerationTargetIdRef.current = targetId

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
    streamingDraft,
    input,
    handleInputChange,
    handleSubmit,
    isLoading: sending || pendingJobId !== null,
    error,
    reload,
    handleRealtimeMessageChange,
    handleAssistantStreamEvent,
  }
}
