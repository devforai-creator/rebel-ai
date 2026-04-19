'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { deleteChat } from '@/app/dashboard/chats/actions'
import { fetchCharacterChatExport, fetchCharacterChatsPage } from '../character-chats-client'
import { downloadBlob } from '../download-blob'
import type { CharacterChat } from '../character-detail-types'

type UseCharacterChatsParams = {
  characterId: string
  initialChats: CharacterChat[]
  initialChatCursor: string | null
  initialHasMoreChats: boolean
}

type PendingDeleteChat = {
  id: string
  title: string | null
}

export function useCharacterChats({
  characterId,
  initialChats,
  initialChatCursor,
  initialHasMoreChats,
}: UseCharacterChatsParams) {
  const router = useRouter()
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null)
  const [chatList, setChatList] = useState(initialChats)
  const [chatCursor, setChatCursor] = useState(initialChatCursor)
  const [hasMoreChatPages, setHasMoreChatPages] = useState(initialHasMoreChats)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [exportingChatId, setExportingChatId] = useState<string | null>(null)
  const [pendingDeleteChat, setPendingDeleteChat] = useState<PendingDeleteChat | null>(null)

  async function exportChat(chatId: string) {
    setExportingChatId(chatId)

    try {
      const { blob, filename } = await fetchCharacterChatExport(chatId)
      downloadBlob(blob, filename)
    } catch (error) {
      console.error('Export failed:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to export chat')
    } finally {
      setExportingChatId(null)
    }
  }

  function requestDeleteCharacterChat(chatId: string, chatTitle: string | null) {
    setPendingDeleteChat({ id: chatId, title: chatTitle })
  }

  function cancelDeleteCharacterChat() {
    setPendingDeleteChat(null)
  }

  async function confirmDeleteCharacterChat() {
    if (!pendingDeleteChat) {
      return
    }

    const { id: chatId } = pendingDeleteChat
    setPendingDeleteChat(null)
    setDeletingChatId(chatId)
    const result = await deleteChat(chatId, false)

    if (result?.error) {
      toast.error(result.error)
      setDeletingChatId(null)
      return
    }

    setDeletingChatId(null)
    router.refresh()
  }

  async function loadMoreChats() {
    if (!hasMoreChatPages || isChatLoading || !chatCursor) {
      return
    }

    setIsChatLoading(true)

    try {
      const data = await fetchCharacterChatsPage(characterId, chatCursor)

      if (Array.isArray(data.chats) && data.chats.length > 0) {
        setChatList((prev) => [...prev, ...data.chats])
        setHasMoreChatPages(data.hasMore)
        setChatCursor(data.nextCursor)
        return
      }

      setHasMoreChatPages(false)
      setChatCursor(null)
    } catch (error) {
      console.error('Failed to load more chats:', error)
    } finally {
      setIsChatLoading(false)
    }
  }

  return {
    deletingChatId,
    exportingChatId,
    chatList,
    hasMoreChatPages,
    isChatLoading,
    pendingDeleteChat,
    exportChat,
    requestDeleteCharacterChat,
    cancelDeleteCharacterChat,
    confirmDeleteCharacterChat,
    loadMoreChats,
  }
}
