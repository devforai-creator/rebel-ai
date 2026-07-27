'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { AlternateModelsConfig } from '@/lib/chat/model-config'
import type { ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import type { Message } from '@/types/database.types'
import type { ActiveChatJob, DebugInfo, DisplayMessage, MessageChangePayload } from '../utils'
import { useChatDebugModal } from './useChatDebugModal'
import { combineHistoryWithLiveMessages, useChatHistory } from './useChatHistory'
import { useChatMessageActions } from './useChatMessageActions'
import { useChatRealtimeSubscription } from './useChatRealtimeSubscription'
import { useQueuedChat, type UseQueuedChatReturn } from './useQueuedChat'

export type ChatMessageTrackingState = {
  debugInfoMap: Map<string, DebugInfo>
  persistedMessageIds: Set<string>
}

export function buildInitialChatMessageTrackingState(
  initialMessages: Message[],
): ChatMessageTrackingState {
  const debugInfoMap = new Map<string, DebugInfo>()
  const persistedMessageIds = new Set<string>()

  for (const message of initialMessages) {
    persistedMessageIds.add(message.id)
    if (message.debug_info) {
      debugInfoMap.set(message.id, message.debug_info as DebugInfo)
    }
  }

  return {
    debugInfoMap,
    persistedMessageIds,
  }
}

export type UseChatMessageLifecycleArgs = {
  chatId: string
  initialMessages: Message[]
  initialActiveJob: ActiveChatJob | null
  initialHistoryCursor: number | null
  hasMoreHistory: boolean
  selectedApiKeyId: string
  selectedModelName: string
  deliveryMode: ChatDeliveryMode
  alternateModels?: AlternateModelsConfig | null
  fetchLatestUsage: () => Promise<void>
  onMessageChangeSideEffect?: (payload: MessageChangePayload) => void
}

export type UseChatMessageLifecycleReturn = {
  composer: Pick<
    UseQueuedChatReturn,
    'input' | 'insertInputText' | 'handleInputChange' | 'handleSubmit'
  >
  history: {
    hasMore: boolean
    isLoading: boolean
    loadOlderMessages: () => Promise<void>
  }
  messageState: {
    combinedMessages: DisplayMessage[]
    streamingDraft: UseQueuedChatReturn['streamingDraft']
    isLoading: boolean
    persistedMessageIds: Set<string>
  }
  actions: ReturnType<typeof useChatMessageActions>
  debug: ReturnType<typeof useChatDebugModal>
}

export function useChatMessageLifecycle({
  chatId,
  initialMessages,
  initialActiveJob,
  initialHistoryCursor,
  hasMoreHistory,
  selectedApiKeyId,
  selectedModelName,
  deliveryMode,
  alternateModels,
  fetchLatestUsage,
  onMessageChangeSideEffect,
}: UseChatMessageLifecycleArgs): UseChatMessageLifecycleReturn {
  const initialTrackingState = useMemo(
    () => buildInitialChatMessageTrackingState(initialMessages),
    [initialMessages],
  )
  const debugInfoMap = useRef<Map<string, DebugInfo>>(initialTrackingState.debugInfoMap)
  const persistedMessageIds = useRef<Set<string>>(initialTrackingState.persistedMessageIds)

  useEffect(() => {
    const nextTrackingState = buildInitialChatMessageTrackingState(initialMessages)
    debugInfoMap.current = nextTrackingState.debugInfoMap
    persistedMessageIds.current = nextTrackingState.persistedMessageIds
  }, [initialMessages])

  const { historyMessages, historyHasMore, isHistoryLoading, loadOlderMessages } = useChatHistory({
    chatId,
    initialHistoryCursor,
    hasMoreHistory,
    persistedMessageIds,
    debugInfoMap,
  })

  const queuedChat = useQueuedChat({
    chatId,
    initialMessages,
    initialActiveJob,
    historyMessages,
    selectedApiKeyId,
    selectedModelName,
    deliveryMode,
    alternateModels,
    fetchLatestUsage,
    debugInfoMap,
    persistedMessageIds,
  })
  const { handleRealtimeMessageChange, handleAssistantStreamEvent } = queuedChat

  const handleMessageRealtime = useCallback(
    (payload: MessageChangePayload) => {
      onMessageChangeSideEffect?.(payload)
      handleRealtimeMessageChange(payload)
    },
    [handleRealtimeMessageChange, onMessageChangeSideEffect],
  )

  useChatRealtimeSubscription({
    chatId,
    onMessageChange: handleMessageRealtime,
    onAssistantStreamEvent: handleAssistantStreamEvent,
  })

  const combinedMessages = useMemo(
    () => combineHistoryWithLiveMessages(historyMessages, queuedChat.messages),
    [historyMessages, queuedChat.messages],
  )

  const actions = useChatMessageActions({
    combinedMessages,
    persistedMessageIds,
    debugInfoMap,
    setMessages: queuedChat.setMessages,
    reload: queuedChat.reload,
  })

  const debug = useChatDebugModal({
    chatId,
    combinedMessages,
    debugInfoMap,
  })

  return {
    composer: {
      input: queuedChat.input,
      insertInputText: queuedChat.insertInputText,
      handleInputChange: queuedChat.handleInputChange,
      handleSubmit: queuedChat.handleSubmit,
    },
    history: {
      hasMore: historyHasMore,
      isLoading: isHistoryLoading,
      loadOlderMessages,
    },
    messageState: {
      combinedMessages,
      streamingDraft: queuedChat.streamingDraft,
      isLoading: queuedChat.isLoading,
      persistedMessageIds: persistedMessageIds.current,
    },
    actions,
    debug,
  }
}
