'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteChat } from '@/app/dashboard/chats/actions'
import type { CharacterChat } from '../character-detail-types'

type CharacterChatsResponse = {
  chats: CharacterChat[]
  hasMore: boolean
  nextCursor: string | null
}

type UseCharacterChatsParams = {
  characterId: string
  initialChats: CharacterChat[]
  initialChatCursor: string | null
  initialHasMoreChats: boolean
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

  async function exportChat(chatId: string) {
    setExportingChatId(chatId)

    try {
      const response = await fetch(`/api/chats/${chatId}/export`)
      if (!response.ok) {
        throw new Error('Export failed')
      }

      const filename = getExportFilename(response.headers.get('Content-Disposition'))
      const blob = await response.blob()
      downloadBlob(blob, filename)
    } catch (error) {
      console.error('Export failed:', error)
      window.alert('Failed to export chat')
    } finally {
      setExportingChatId(null)
    }
  }

  async function deleteCharacterChat(chatId: string, chatTitle: string | null) {
    if (
      !window.confirm(
        `Are you sure you want to delete "${chatTitle || 'this chat'}"?\n\nAll messages and summaries will be deleted and cannot be recovered.`,
      )
    ) {
      return
    }

    setDeletingChatId(chatId)
    const result = await deleteChat(chatId, false)

    if (result?.error) {
      window.alert(result.error)
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
      const response = await fetch(
        `/api/characters/${characterId}/chats?before=${encodeURIComponent(chatCursor)}`,
      )

      if (!response.ok) {
        console.error('Failed to load more chats:', response.statusText)
        return
      }

      const data = (await response.json()) as CharacterChatsResponse

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
    exportChat,
    deleteCharacterChat,
    loadMoreChats,
  }
}

function getExportFilename(contentDisposition: string | null) {
  if (!contentDisposition) {
    return 'chat_export.json'
  }

  const match = contentDisposition.match(/filename="(.+)"/)
  if (!match) {
    return 'chat_export.json'
  }

  return decodeURIComponent(match[1])
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
