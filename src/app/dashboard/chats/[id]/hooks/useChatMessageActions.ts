import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { toast } from 'sonner'
import { deleteMessage, editMessage } from '../message-actions'
import type { DebugInfo, DisplayMessage } from '../utils'
import type { UseQueuedChatReturn } from './useQueuedChat'
import { createApiError, readApiErrorMessage } from '@/lib/http/api-contract'
import { SUPPORT_TIER_HEADER, SUPPORT_TIERS } from '@/lib/support-tier'

type UseChatMessageActionsArgs = {
  combinedMessages: DisplayMessage[]
  persistedMessageIds: MutableRefObject<Set<string>>
  debugInfoMap: MutableRefObject<Map<string, DebugInfo>>
  setMessages: Dispatch<SetStateAction<DisplayMessage[]>>
  reload: UseQueuedChatReturn['reload']
}

type UseChatMessageActionsReturn = {
  editingMessageId: string | null
  editContent: string
  setEditContent: Dispatch<SetStateAction<string>>
  reprocessingMessageId: string | null
  retranslatingMessageId: string | null
  pendingDeleteMessage: DisplayMessage | null
  deleteDialogDescription: string
  startEdit: (messageId: string, currentContent: string) => void
  cancelEdit: () => void
  saveEdit: (messageId: string) => Promise<void>
  requestDelete: (messageId: string) => void
  closeDeleteDialog: () => void
  confirmDelete: () => Promise<void>
  handleRegenerate: (messageId: string) => void
  handleReprocess: (messageId: string) => Promise<void>
  handleRetranslate: (messageId: string) => Promise<void>
}

export function buildDeleteMessageDescription(message: DisplayMessage | null): string {
  if (!message) {
    return 'This message will be removed from the chat history.'
  }

  const preview = message.content.trim().replace(/\s+/g, ' ').slice(0, 120)

  if (preview.length === 0) {
    return 'This permanently deletes the selected message.'
  }

  return `This permanently deletes the selected message.\n\n"${preview}${preview.length === 120 ? '…' : ''}"`
}

export function useChatMessageActions({
  combinedMessages,
  persistedMessageIds,
  debugInfoMap,
  setMessages,
  reload,
}: UseChatMessageActionsArgs): UseChatMessageActionsReturn {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [reprocessingMessageId, setReprocessingMessageId] = useState<string | null>(null)
  const [retranslatingMessageId, setRetranslatingMessageId] = useState<string | null>(null)
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null)

  const startEdit = useCallback((messageId: string, currentContent: string) => {
    setEditingMessageId(messageId)
    setEditContent(currentContent)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null)
    setEditContent('')
  }, [])

  const saveEdit = useCallback(
    async (messageId: string) => {
      if (!editContent.trim()) return

      const result = await editMessage(messageId, editContent)
      if (result.error) {
        toast.error('Failed to edit message: ' + result.error)
        return
      }

      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, content: editContent } : message,
        ),
      )
      setEditingMessageId(null)
      setEditContent('')
    },
    [editContent, setMessages],
  )

  const requestDelete = useCallback((messageId: string) => {
    setPendingDeleteMessageId(messageId)
  }, [])

  const closeDeleteDialog = useCallback(() => {
    setPendingDeleteMessageId(null)
  }, [])

  const confirmDelete = useCallback(async () => {
    const targetId = pendingDeleteMessageId
    setPendingDeleteMessageId(null)

    if (!targetId) {
      return
    }

    const result = await deleteMessage(targetId)
    if (result.error) {
      toast.error('Failed to delete message: ' + result.error)
      return
    }

    persistedMessageIds.current.delete(targetId)
    debugInfoMap.current.delete(targetId)
    setMessages((prev) => prev.filter((message) => message.id !== targetId))
  }, [debugInfoMap, pendingDeleteMessageId, persistedMessageIds, setMessages])

  const pendingDeleteMessage = useMemo(
    () => combinedMessages.find((message) => message.id === pendingDeleteMessageId) ?? null,
    [combinedMessages, pendingDeleteMessageId],
  )

  const deleteDialogDescription = useMemo(
    () => buildDeleteMessageDescription(pendingDeleteMessage),
    [pendingDeleteMessage],
  )

  const handleRegenerate = useCallback(
    (messageId: string) => {
      if (!persistedMessageIds.current.has(messageId)) {
        toast.error('Message not yet saved. Please try again in a moment.')
        return
      }

      void reload({
        body: {
          isRegeneration: true,
          regenerateAssistantMessageId: messageId,
        },
      })
    },
    [persistedMessageIds, reload],
  )

  const handleReprocess = useCallback(
    async (messageId: string) => {
      if (!persistedMessageIds.current.has(messageId)) {
        toast.error('Message not yet saved. Please try again in a moment.')
        return
      }

      setReprocessingMessageId(messageId)
      let fallbackMessage = 'Experimental reprocess failed'

      try {
        const response = await fetch('/api/messages/reprocess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
        })

        const isExperimental =
          response.headers.get(SUPPORT_TIER_HEADER) === SUPPORT_TIERS.EXPERIMENTAL
        fallbackMessage = isExperimental
          ? 'Experimental reprocess failed'
          : 'Failed to reprocess message'

        if (!response.ok) {
          throw await createApiError(response, fallbackMessage)
        }

        toast.success(
          isExperimental ? 'Experimental reprocess completed' : 'Message reprocessed successfully',
        )
      } catch (error) {
        console.error('[Reprocess] Error:', error)
        toast.error(error instanceof Error ? error.message : fallbackMessage)
      } finally {
        setReprocessingMessageId(null)
      }
    },
    [persistedMessageIds],
  )

  const handleRetranslate = useCallback(
    async (messageId: string) => {
      if (!persistedMessageIds.current.has(messageId)) {
        toast.error('Message not yet saved. Please try again in a moment.')
        return
      }

      setRetranslatingMessageId(messageId)
      try {
        const response = await fetch('/api/messages/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
        })

        if (!response.ok) {
          const errorText = await readApiErrorMessage(response, 'Failed to translate message')
          toast.error(errorText || 'Failed to translate message')
          return
        }

        toast.success('Message translated successfully')
      } catch (error) {
        console.error('[Retranslate] Error:', error)
        toast.error('Failed to translate message')
      } finally {
        setRetranslatingMessageId(null)
      }
    },
    [persistedMessageIds],
  )

  return {
    editingMessageId,
    editContent,
    setEditContent,
    reprocessingMessageId,
    retranslatingMessageId,
    pendingDeleteMessage,
    deleteDialogDescription,
    startEdit,
    cancelEdit,
    saveEdit,
    requestDelete,
    closeDeleteDialog,
    confirmDelete,
    handleRegenerate,
    handleReprocess,
    handleRetranslate,
  }
}
