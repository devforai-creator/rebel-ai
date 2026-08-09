import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, SetStateAction } from 'react'
import { toast } from 'sonner'
import type { Message } from '@/types/database.types'
import type { AlternateModelsConfig } from '@/lib/chat/model-config'
import { CHAT_DELIVERY_MODE_STREAMING, type ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import type { AssistantStreamBroadcastPayload } from '@/lib/chat/assistant-stream'
import type {
  ActiveChatJob,
  DebugInfo,
  DisplayMessage,
  MessageChangePayload,
  StreamingAssistantDraft,
} from '../utils'
import { MESSAGE_STATUS_COMPLETED, isVisibleMessageStatus } from '@/lib/chat/message-status'
import { resolveAlternateModelSelection } from '@/lib/chat/alternate-models'
import { pollJobStatus as pollJobStatusPure } from './job-poller'
import { fetchChatJobStatus, fetchLatestChatMessage, requestQueuedChatJob } from './queued-chat-api'
import {
  getQueuedChatPollerConfig,
  getQueuedChatSlowProgressMessage,
  resolveQueuedChatPollSleepDelay,
} from './queued-chat-runtime'
import type { AssistantMessageSnapshot } from './reconcile-assistant-message'
import {
  createInitialQueuedChatLifecycleState,
  getQueuedChatRegenerationTarget,
  isQueuedChatLifecycleLoading,
  queuedChatLifecycleReducer,
  type QueuedChatLifecycleAction,
} from './queued-chat-lifecycle'

export interface UseQueuedChatParams {
  chatId: string
  initialMessages: Message[]
  initialActiveJob: ActiveChatJob | null
  historyMessages: Message[]
  selectedApiKeyId: string
  selectedModelName: string
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
  selectedModelName,
  deliveryMode = CHAT_DELIVERY_MODE_STREAMING,
  alternateModels,
  fetchLatestUsage,
  debugInfoMap,
  persistedMessageIds,
}: UseQueuedChatParams): UseQueuedChatReturn {
  const [lifecycle, reactDispatch] = useReducer(
    queuedChatLifecycleReducer,
    {
      initialMessages,
      initialActiveJob,
      createdAt: new Date().toISOString(),
    },
    createInitialQueuedChatLifecycleState,
  )
  const lifecycleStateRef = useRef(lifecycle)
  const [input, setInput] = useState('')
  const resumedInitialJobIdRef = useRef<string | null>(null)
  const lastStreamProgressAtRef = useRef<number | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  )

  const dispatchLifecycle = useCallback((action: QueuedChatLifecycleAction) => {
    lifecycleStateRef.current = queuedChatLifecycleReducer(lifecycleStateRef.current, action)
    reactDispatch(action)
  }, [])

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

  const setMessages = useCallback(
    (update: SetStateAction<DisplayMessage[]>) => {
      const currentMessages = lifecycleStateRef.current.messages
      const messages = typeof update === 'function' ? update(currentMessages) : update
      dispatchLifecycle({ type: 'MESSAGES_REPLACED', messages })
    },
    [dispatchLifecycle],
  )

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
      const lifecycleState = lifecycleStateRef.current
      const regenerationTargetId = getQueuedChatRegenerationTarget(lifecycleState)
      const messageWasAlreadyVisible = lifecycleState.messages.some(
        (message) => message.id === assistantMessage.id,
      )

      if (isVisibleMessageStatus(messageStatus)) {
        persistedMessageIds.current.add(assistantMessage.id)

        if (
          regenerationTargetId &&
          regenerationTargetId !== assistantMessage.id &&
          !messageWasAlreadyVisible
        ) {
          persistedMessageIds.current.delete(regenerationTargetId)
          debugInfoMap.current.delete(regenerationTargetId)
        }
      } else if (regenerationTargetId !== assistantMessage.id) {
        persistedMessageIds.current.delete(assistantMessage.id)
        debugInfoMap.current.delete(assistantMessage.id)
      }

      dispatchLifecycle({
        type: 'PERSISTED_ASSISTANT_UPSERTED',
        message: assistantMessage,
      })
    },
    [debugInfoMap, dispatchLifecycle, persistedMessageIds],
  )

  const fetchLatestMessage = useCallback(async () => {
    return fetchLatestChatMessage(chatId) as Promise<(Message & { debug_info?: DebugInfo }) | null>
  }, [chatId])

  const upsertUserMessage = useCallback(
    (userMessage: Message & { debug_info?: DebugInfo }) => {
      if (userMessage.debug_info) {
        debugInfoMap.current.set(userMessage.id, userMessage.debug_info)
      }
      persistedMessageIds.current.add(userMessage.id)
      dispatchLifecycle({ type: 'PERSISTED_USER_UPSERTED', message: userMessage })
    },
    [debugInfoMap, dispatchLifecycle, persistedMessageIds],
  )

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
            // Realtime can miss the completed reply. Reconcile the authoritative latest
            // message before marking this exact job terminal.
            await appendAssistantMessage()
            await fetchLatestUsage()
            lastStreamProgressAtRef.current = null
            dispatchLifecycle({ type: 'JOB_SUCCEEDED', jobId })
          },
          onError: (error) => {
            lastStreamProgressAtRef.current = null
            dispatchLifecycle({ type: 'JOB_FAILED', jobId, error })
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
    [appendAssistantMessage, dispatchLifecycle, fetchLatestUsage, isPageVisible],
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
      const newMessage = payload.new
      const oldMessage = payload.old

      if (
        payload.eventType === 'INSERT' &&
        newMessage?.role === 'user' &&
        typeof newMessage.id === 'string' &&
        typeof newMessage.content === 'string'
      ) {
        upsertUserMessage(newMessage as Message & { debug_info?: DebugInfo })
        return
      }

      if (
        payload.eventType === 'INSERT' &&
        newMessage?.role === 'assistant' &&
        typeof newMessage.id === 'string'
      ) {
        upsertAssistantMessage(newMessage as AssistantMessageSnapshot)
        return
      }

      if (
        payload.eventType === 'UPDATE' &&
        newMessage?.role === 'assistant' &&
        typeof newMessage.id === 'string'
      ) {
        upsertAssistantMessage(newMessage as AssistantMessageSnapshot)
        return
      }

      if (
        payload.eventType === 'DELETE' &&
        (oldMessage?.role === 'assistant' || oldMessage?.role === 'user') &&
        typeof oldMessage.id === 'string'
      ) {
        persistedMessageIds.current.delete(oldMessage.id)
        debugInfoMap.current.delete(oldMessage.id)
        dispatchLifecycle({ type: 'MESSAGE_DELETED', messageId: oldMessage.id })
      }
    },
    [
      debugInfoMap,
      dispatchLifecycle,
      persistedMessageIds,
      upsertAssistantMessage,
      upsertUserMessage,
    ],
  )

  const handleAssistantStreamEvent = useCallback(
    (payload: AssistantStreamBroadcastPayload) => {
      const activeJob = lifecycleStateRef.current.activeJob
      if (payload.kind === 'snapshot' && activeJob?.id === payload.jobId) {
        lastStreamProgressAtRef.current = Date.now()
      }

      dispatchLifecycle({
        type: 'STREAM_EVENT_RECEIVED',
        payload,
        receivedAt: new Date().toISOString(),
      })
    },
    [dispatchLifecycle],
  )

  const resolveNextModel = useCallback(
    () =>
      resolveAlternateModelSelection({
        alternateModels,
        selectedModel: {
          apiKeyId: selectedApiKeyId,
          modelName: selectedModelName,
        },
        messages: lifecycle.messages,
      }),
    [alternateModels, lifecycle.messages, selectedApiKeyId, selectedModelName],
  )

  const failSubmission = useCallback(
    (error: Error) => {
      dispatchLifecycle({ type: 'SUBMIT_FAILED', error })
      if (!error.message.includes('timed out') && !error.message.includes('Failed to generate')) {
        toast.error(error.message)
      }
    },
    [dispatchLifecycle],
  )

  const sendChatRequest = useCallback(
    async ({
      userMessage,
      clientMessageId,
      isRegeneration = false,
      regenerateAssistantMessageId = null,
    }: {
      userMessage?: string
      clientMessageId?: string
      isRegeneration?: boolean
      regenerateAssistantMessageId?: string | null
    }) => {
      const resolvedModel = resolveNextModel()
      if (!resolvedModel.apiKeyId || !resolvedModel.modelName) {
        const error = new Error('Please select a model.')
        failSubmission(error)
        throw error
      }

      let data: Awaited<ReturnType<typeof requestQueuedChatJob>>
      try {
        data = await requestQueuedChatJob({
          chatId,
          apiKeyId: resolvedModel.apiKeyId,
          modelName: resolvedModel.modelName,
          userMessage,
          clientMessageId,
          deliveryMode,
          isRegeneration,
          regenerateAssistantMessageId,
        })
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error('Chat request failed.')
        failSubmission(normalized)
        throw normalized
      }

      if (data.userMessageId) {
        persistedMessageIds.current.add(data.userMessageId)
      }

      lastStreamProgressAtRef.current = null
      dispatchLifecycle({
        type: 'SUBMIT_ACCEPTED',
        jobId: data.jobId,
        deliveryMode,
        userMessageId: data.userMessageId,
        createdAt: new Date().toISOString(),
      })

      await pollJobStatus(data.jobId, deliveryMode)
    },
    [
      chatId,
      deliveryMode,
      dispatchLifecycle,
      failSubmission,
      persistedMessageIds,
      pollJobStatus,
      resolveNextModel,
    ],
  )

  const handleSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      const trimmed = input.trim()
      if (!trimmed || isQueuedChatLifecycleLoading(lifecycleStateRef.current)) {
        return
      }

      const clientMessageId = crypto.randomUUID()
      const optimisticMessage: DisplayMessage = {
        id: clientMessageId,
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
        temp: true,
      }

      dispatchLifecycle({ type: 'MESSAGE_SUBMIT_STARTED', optimisticMessage })
      setInput('')

      void sendChatRequest({
        userMessage: trimmed,
        clientMessageId,
      }).catch(() => {
        // Error state and user feedback are handled by the submit or poll adapters.
      })
    },
    [dispatchLifecycle, input, sendChatRequest],
  )

  const reload = useCallback(
    (options?: { body?: { isRegeneration?: boolean; regenerateAssistantMessageId?: string } }) => {
      const targetId = options?.body?.regenerateAssistantMessageId
      if (!options?.body?.isRegeneration || !targetId) {
        return
      }

      if (!persistedMessageIds.current.has(targetId)) {
        dispatchLifecycle({
          type: 'ERROR_SET',
          error: new Error('Message not yet saved. Please try again in a moment.'),
        })
        return
      }

      if (isQueuedChatLifecycleLoading(lifecycleStateRef.current)) {
        return
      }

      dispatchLifecycle({
        type: 'REGENERATION_SUBMIT_STARTED',
        regenerateAssistantMessageId: targetId,
      })

      void sendChatRequest({
        isRegeneration: true,
        regenerateAssistantMessageId: targetId,
      }).catch(() => {
        // Error state and user feedback are handled by the submit or poll adapters.
      })
    },
    [dispatchLifecycle, persistedMessageIds, sendChatRequest],
  )

  return {
    messages: lifecycle.messages,
    setMessages,
    streamingDraft: lifecycle.streamingDraft,
    input,
    insertInputText,
    handleInputChange,
    handleSubmit,
    isLoading: isQueuedChatLifecycleLoading(lifecycle),
    error: lifecycle.error,
    reload,
    handleRealtimeMessageChange,
    handleAssistantStreamEvent,
  }
}
