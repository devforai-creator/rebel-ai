import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { toast } from 'sonner'
import type { Message } from '@/types/database.types'
import type { AlternateModelsConfig } from '@/lib/chat/model-config'
import { CHAT_DELIVERY_MODE_STREAMING, type ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import type { AssistantStreamBroadcastPayload } from '@/lib/chat/assistant-stream'
import {
  DisplayMessage,
  MessageChangePayload,
  DebugInfo,
  StreamingAssistantDraft,
  ActiveChatJob,
  mapMessageToDisplay,
} from '../utils'
import { MESSAGE_STATUS_COMPLETED, isVisibleMessageStatus } from '@/lib/chat/message-status'
import { resolveAlternateApiKeyId } from '@/lib/chat/alternate-models'
import { pollJobStatus as pollJobStatusPure } from './job-poller'
import { fetchChatJobStatus, fetchLatestChatMessage, requestQueuedChatJob } from './queued-chat-api'
import {
  createStreamingAssistantDraft,
  getQueuedChatPollerConfig,
  getQueuedChatSlowProgressMessage,
  resolveQueuedChatPollSleepDelay,
  updateStreamingDraftFromEvent,
} from './queued-chat-runtime'
import {
  reconcileAssistantMessage,
  type AssistantMessageSnapshot,
} from './reconcile-assistant-message'

export interface UseQueuedChatParams {
  chatId: string
  initialMessages: Message[]
  initialActiveJob: ActiveChatJob | null
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
  insertInputText: (
    text: string,
    selectionStart?: number | null,
    selectionEnd?: number | null,
  ) => void
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
  initialActiveJob,
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
  const [pendingJobId, setPendingJobId] = useState<string | null>(initialActiveJob?.id ?? null)
  const pendingJobIdRef = useRef<string | null>(initialActiveJob?.id ?? null)
  const pendingAssistantVisibleRef = useRef(false)
  const pendingRegenerationTargetIdRef = useRef<string | null>(
    initialActiveJob?.regenerateAssistantMessageId ?? null,
  )
  const resumedInitialJobIdRef = useRef<string | null>(null)
  const lastStreamProgressAtRef = useRef<number | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  )
  const [streamingDraft, setStreamingDraft] = useState<StreamingAssistantDraft | null>(() =>
    initialActiveJob
      ? createStreamingAssistantDraft(
          initialActiveJob.id,
          initialActiveJob.regenerateAssistantMessageId,
          initialActiveJob.deliveryMode,
        )
      : null,
  )
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

  const insertInputText = useCallback(
    (text: string, selectionStart?: number | null, selectionEnd?: number | null) => {
      setInput((previous) => {
        const resolvedSelectionStart =
          typeof selectionStart === 'number'
            ? Math.max(0, Math.min(selectionStart, previous.length))
            : previous.length
        const resolvedSelectionEnd =
          typeof selectionEnd === 'number'
            ? Math.max(resolvedSelectionStart, Math.min(selectionEnd, previous.length))
            : resolvedSelectionStart

        return (
          previous.slice(0, resolvedSelectionStart) + text + previous.slice(resolvedSelectionEnd)
        )
      })
    },
    [],
  )

  const upsertAssistantMessage = useCallback(
    (assistantMessage: AssistantMessageSnapshot) => {
      const debugInfo = assistantMessage.debug_info as DebugInfo | null | undefined
      if (debugInfo) {
        debugInfoMap.current.set(assistantMessage.id, debugInfo)
      }

      const messageStatus = assistantMessage.message_status ?? MESSAGE_STATUS_COMPLETED

      setMessages((prev) => {
        const pendingRegenerationTargetId = pendingRegenerationTargetIdRef.current
        const { nextMessages, idsToForget } = reconcileAssistantMessage({
          prevMessages: prev,
          assistantMessage,
          pendingRegenerationTargetId,
        })

        if (isVisibleMessageStatus(messageStatus)) {
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
        isVisibleMessageStatus(messageStatus) &&
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
      setStreamingDraft(
        createStreamingAssistantDraft(jobId, regenerateAssistantMessageId, deliveryMode),
      )
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
    async (jobId: string, jobDeliveryMode: ChatDeliveryMode) => {
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
            toast.info(getQueuedChatSlowProgressMessage(jobDeliveryMode, elapsedMs), {
              duration: 8000,
            })
          },
          now: () => Date.now(),
          sleep: (ms) => {
            return new Promise((resolve) =>
              setTimeout(
                resolve,
                resolveQueuedChatPollSleepDelay({
                  baseDelayMs: ms,
                  deliveryMode: jobDeliveryMode,
                  isPageVisible,
                  lastProgressAt: lastStreamProgressAtRef.current,
                  now: Date.now(),
                }),
              ),
            )
          },
        },
        getQueuedChatPollerConfig(jobDeliveryMode),
      )

      if (result.outcome !== 'success') {
        throw result.error
      }
    },
    [appendAssistantMessage, clearPendingJob, fetchLatestUsage, isPageVisible],
  )

  useEffect(() => {
    if (!initialActiveJob || resumedInitialJobIdRef.current === initialActiveJob.id) {
      return
    }

    resumedInitialJobIdRef.current = initialActiveJob.id
    void pollJobStatus(initialActiveJob.id, initialActiveJob.deliveryMode).catch(() => {
      // Error state and user feedback are handled inside pollJobStatus.
    })
  }, [initialActiveJob, pollJobStatus])

  const handleRealtimeMessageChange = useCallback(
    (payload: MessageChangePayload) => {
      const newMessage = (payload.new as AssistantMessageSnapshot | null) ?? null
      const oldMessage = (payload.old as AssistantMessageSnapshot | null) ?? null

      if (
        payload.eventType === 'INSERT' &&
        newMessage &&
        newMessage.role === 'assistant' &&
        typeof newMessage.id === 'string'
      ) {
        upsertAssistantMessage(newMessage)
        return
      }

      if (
        payload.eventType === 'UPDATE' &&
        newMessage &&
        newMessage.role === 'assistant' &&
        typeof newMessage.id === 'string'
      ) {
        upsertAssistantMessage(newMessage)
        return
      }

      if (
        payload.eventType === 'DELETE' &&
        oldMessage &&
        oldMessage.role === 'assistant' &&
        typeof oldMessage.id === 'string'
      ) {
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

    setStreamingDraft((current) => updateStreamingDraftFromEvent(current, payload))
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
      userMessage,
      isRegeneration = false,
      regenerateAssistantMessageId = null,
      removeTempMessage,
      syncUser = false,
    }: {
      userMessage?: string
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
          userMessage,
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
        await pollJobStatus(data.jobId, deliveryMode)
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

      void sendChatRequest({
        userMessage: trimmed,
        syncUser: true,
        removeTempMessage: () => {
          setMessages((prev) => prev.filter((msg) => msg.id !== tempMessage.id))
        },
      }).catch(() => {
        // No-op: error state already set in sendChatRequest
      })
    },
    [input, messages, pendingJobId, sending, sendChatRequest],
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

      void sendChatRequest({
        isRegeneration: true,
        regenerateAssistantMessageId: targetId,
      }).catch(() => {
        // Error state handled inside sendChatRequest
      })
    },
    [persistedMessageIds, sendChatRequest],
  )

  return {
    messages,
    setMessages,
    streamingDraft,
    input,
    insertInputText,
    handleInputChange,
    handleSubmit,
    isLoading: sending || pendingJobId !== null,
    error,
    reload,
    handleRealtimeMessageChange,
    handleAssistantStreamEvent,
  }
}
