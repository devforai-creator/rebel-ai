import { useCallback, useState, type MutableRefObject } from 'react'
import { readApiErrorMessage } from '@/lib/http/api-contract'
import type { Message } from '@/types/database.types'
import { mapMessageToDisplay, type DebugInfo, type DisplayMessage } from '../utils'

type UseChatHistoryArgs = {
  chatId: string
  initialHistoryCursor: number | null
  hasMoreHistory: boolean
  persistedMessageIds: MutableRefObject<Set<string>>
  debugInfoMap: MutableRefObject<Map<string, DebugInfo>>
}

type UseChatHistoryReturn = {
  historyMessages: Message[]
  historyHasMore: boolean
  isHistoryLoading: boolean
  loadOlderMessages: () => Promise<void>
}

type ChatHistoryResponse = {
  messages: Message[]
  hasMore: boolean
  nextCursor: number | null
}

export function combineHistoryWithLiveMessages(
  historyMessages: Message[],
  liveMessages: DisplayMessage[],
): DisplayMessage[] {
  if (historyMessages.length === 0) {
    return liveMessages
  }

  return [...historyMessages.map(mapMessageToDisplay), ...liveMessages]
}

export function useChatHistory({
  chatId,
  initialHistoryCursor,
  hasMoreHistory,
  persistedMessageIds,
  debugInfoMap,
}: UseChatHistoryArgs): UseChatHistoryReturn {
  const [historyMessages, setHistoryMessages] = useState<Message[]>([])
  const [historyCursor, setHistoryCursor] = useState<number | null>(initialHistoryCursor)
  const [historyHasMore, setHistoryHasMore] = useState(hasMoreHistory)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)

  const loadOlderMessages = useCallback(async () => {
    if (!historyHasMore || isHistoryLoading || historyCursor === null) return

    setIsHistoryLoading(true)
    try {
      const response = await fetch(
        `/api/chats/${chatId}/messages/history?before=${historyCursor}`,
        {
          cache: 'no-store',
        },
      )

      if (!response.ok) {
        console.error(
          'Failed to load older messages:',
          await readApiErrorMessage(response, 'Failed to load older messages'),
        )
        setHistoryHasMore(false)
        return
      }

      const data = (await response.json()) as ChatHistoryResponse

      if (Array.isArray(data.messages) && data.messages.length > 0) {
        setHistoryMessages((prev) => [...data.messages, ...prev])
        setHistoryCursor(data.nextCursor)
        setHistoryHasMore(data.hasMore)

        for (const msg of data.messages) {
          persistedMessageIds.current.add(msg.id)
          if (msg.debug_info) {
            debugInfoMap.current.set(msg.id, msg.debug_info as DebugInfo)
          }
        }
      } else {
        setHistoryHasMore(false)
      }
    } catch (error) {
      console.error('Failed to load older messages:', error)
    } finally {
      setIsHistoryLoading(false)
    }
  }, [chatId, debugInfoMap, historyCursor, historyHasMore, isHistoryLoading, persistedMessageIds])

  return {
    historyMessages,
    historyHasMore,
    isHistoryLoading,
    loadOlderMessages,
  }
}
