'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { deleteChat } from '@/app/dashboard/chats/actions'
import { renameChat, setChatBookmarked } from '@/app/dashboard/chats/chat-list-actions'
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
  const [updatingChatId, setUpdatingChatId] = useState<string | null>(null)
  const [chatListError, setChatListError] = useState<string | null>(null)
  const requestPending = useRef(false)

  async function reloadChats() {
    const page = await fetchCharacterChatsPage(characterId, null)
    setChatList(page.chats)
    setChatCursor(page.nextCursor)
    setHasMoreChatPages(page.hasMore)
    setChatListError(null)
  }

  async function retryChatList() {
    if (requestPending.current) return
    requestPending.current = true
    setIsChatLoading(true)
    try {
      await reloadChats()
    } catch {
      setChatListError('목록을 불러오지 못했습니다. 다시 시도해주세요.')
    } finally {
      requestPending.current = false
      setIsChatLoading(false)
    }
  }

  async function bookmarkChat(chat: CharacterChat) {
    if (requestPending.current) return
    requestPending.current = true
    setUpdatingChatId(chat.id)
    try {
      const result = await setChatBookmarked(chat.id, !chat.is_bookmarked)
      if (!('chat' in result)) {
        toast.error(result.error)
        return
      }
      setChatList((previous) =>
        previous
          .map((item) => (item.id === chat.id ? { ...item, ...result.chat } : item))
          .sort(
            (a, b) =>
              Number(b.is_bookmarked) - Number(a.is_bookmarked) ||
              Date.parse(b.recency_at) - Date.parse(a.recency_at) ||
              b.id.localeCompare(a.id),
          ),
      )
      // Restart pagination after a sort-key change so an unpinned room cannot
      // invalidate the old cursor and hide rooms on subsequent pages.
      try {
        await reloadChats()
        toast.success(
          chat.is_bookmarked
            ? '북마크를 해제했습니다.'
            : '북마크했습니다. 목록 맨 위에 고정됩니다.',
        )
      } catch {
        setChatCursor(null)
        setHasMoreChatPages(false)
        setChatListError('북마크는 저장됐지만 목록을 새로 불러오지 못했습니다.')
      }
    } catch {
      toast.error('북마크를 저장하지 못했습니다. 다시 시도해주세요.')
    } finally {
      requestPending.current = false
      setUpdatingChatId(null)
    }
  }

  async function renameCharacterChat(chatId: string, title: string): Promise<{ error?: string }> {
    if (requestPending.current) return { error: '진행 중인 작업이 끝난 뒤 다시 시도해주세요.' }
    requestPending.current = true
    setUpdatingChatId(chatId)
    try {
      const result = await renameChat(chatId, title)
      if (!('chat' in result)) return { error: result.error }
      setChatList((previous) =>
        previous.map((chat) => (chat.id === chatId ? { ...chat, ...result.chat } : chat)),
      )
      return {}
    } catch {
      return { error: '제목을 저장하지 못했습니다. 다시 시도해주세요.' }
    } finally {
      requestPending.current = false
      setUpdatingChatId(null)
    }
  }

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
    if (requestPending.current) return
    setPendingDeleteChat({ id: chatId, title: chatTitle })
  }

  function cancelDeleteCharacterChat() {
    setPendingDeleteChat(null)
  }

  async function confirmDeleteCharacterChat() {
    if (!pendingDeleteChat || requestPending.current) {
      return
    }

    const { id: chatId } = pendingDeleteChat
    requestPending.current = true
    setPendingDeleteChat(null)
    setDeletingChatId(chatId)
    try {
      const result = await deleteChat(chatId, false)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setChatList((previous) => previous.filter((chat) => chat.id !== chatId))
      router.refresh()
    } catch {
      toast.error('채팅방을 삭제하지 못했습니다. 다시 시도해주세요.')
    } finally {
      requestPending.current = false
      setDeletingChatId(null)
    }
  }

  async function loadMoreChats() {
    if (!hasMoreChatPages || requestPending.current || !chatCursor) {
      return
    }

    requestPending.current = true
    setIsChatLoading(true)

    try {
      const data = await fetchCharacterChatsPage(characterId, chatCursor)

      if (Array.isArray(data.chats) && data.chats.length > 0) {
        setChatList((prev) => {
          const ids = new Set(prev.map((chat) => chat.id))
          return [...prev, ...data.chats.filter((chat) => !ids.has(chat.id))]
        })
        setHasMoreChatPages(data.hasMore)
        setChatCursor(data.nextCursor)
        return
      }

      setHasMoreChatPages(false)
      setChatCursor(null)
    } catch (error) {
      console.error('Failed to load more chats:', error)
    } finally {
      requestPending.current = false
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
    updatingChatId,
    chatListError,
    bookmarkChat,
    renameCharacterChat,
    retryChatList,
    exportChat,
    requestDeleteCharacterChat,
    cancelDeleteCharacterChat,
    confirmDeleteCharacterChat,
    loadMoreChats,
  }
}
