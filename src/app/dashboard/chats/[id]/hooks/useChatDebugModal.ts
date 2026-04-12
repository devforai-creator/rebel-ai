import { useCallback, useMemo, useState, type MutableRefObject } from 'react'
import type { DebugInfo, DisplayMessage } from '../utils'

type ChatDebugModalState = {
  isOpen: boolean
  messageId: string | null
  debugInfo: DebugInfo | null | undefined
  mode: 'message' | 'assets'
}

type UseChatDebugModalArgs = {
  chatId: string
  combinedMessages: DisplayMessage[]
  debugInfoMap: MutableRefObject<Map<string, DebugInfo>>
}

type UseChatDebugModalReturn = {
  debugModal: ChatDebugModalState
  debugMessage: DisplayMessage | null
  openMessageDebug: (messageId: string) => Promise<void>
  openAssetDiagnostics: () => void
  closeDebugModal: () => void
}

const INITIAL_DEBUG_MODAL_STATE: ChatDebugModalState = {
  isOpen: false,
  messageId: null,
  debugInfo: undefined,
  mode: 'message',
}

export function resolveAssetDiagnosticsTargetMessage(
  messages: DisplayMessage[],
): DisplayMessage | null {
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')

  return latestAssistant ?? messages[messages.length - 1] ?? null
}

export function useChatDebugModal({
  chatId,
  combinedMessages,
  debugInfoMap,
}: UseChatDebugModalArgs): UseChatDebugModalReturn {
  const [debugModal, setDebugModal] = useState<ChatDebugModalState>(INITIAL_DEBUG_MODAL_STATE)

  const debugMessage = useMemo<DisplayMessage | null>(() => {
    if (!debugModal.messageId) return null
    return combinedMessages.find((message) => message.id === debugModal.messageId) ?? null
  }, [combinedMessages, debugModal.messageId])

  const openMessageDebug = useCallback(
    async (messageId: string) => {
      const cached = debugInfoMap.current.get(messageId)
      if (cached) {
        setDebugModal({ isOpen: true, messageId, debugInfo: cached, mode: 'message' })
        return
      }

      setDebugModal({ isOpen: true, messageId, debugInfo: undefined, mode: 'message' })

      try {
        const response = await fetch(`/api/chats/${chatId}/messages/${messageId}/debug`)
        if (response.ok) {
          const data = await response.json()
          const serverDebugInfo = data.debugInfo as DebugInfo | null
          if (serverDebugInfo) {
            debugInfoMap.current.set(messageId, serverDebugInfo)
          }

          setDebugModal((previous) =>
            previous.isOpen && previous.messageId === messageId
              ? { ...previous, debugInfo: serverDebugInfo, mode: 'message' }
              : previous,
          )
        }
      } catch (error) {
        console.error('Failed to fetch debug info:', error)
        setDebugModal((previous) =>
          previous.isOpen && previous.messageId === messageId
            ? { ...previous, debugInfo: null, mode: 'message' }
            : previous,
        )
      }
    },
    [chatId, debugInfoMap],
  )

  const openAssetDiagnostics = useCallback(() => {
    const target = resolveAssetDiagnosticsTargetMessage(combinedMessages)
    setDebugModal({
      isOpen: true,
      messageId: target?.id ?? null,
      debugInfo: null,
      mode: 'assets',
    })
  }, [combinedMessages])

  const closeDebugModal = useCallback(() => {
    setDebugModal(INITIAL_DEBUG_MODAL_STATE)
  }, [])

  return {
    debugModal,
    debugMessage,
    openMessageDebug,
    openAssetDiagnostics,
    closeDebugModal,
  }
}
