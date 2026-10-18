// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCharacterChats } from './useCharacterChats'

const {
  refreshMock,
  toastErrorMock,
  toastSuccessMock,
  deleteChatMock,
  renameChatMock,
  setChatBookmarkedMock,
  fetchCharacterChatsPageMock,
  fetchCharacterChatExportMock,
  downloadBlobMock,
} = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  deleteChatMock: vi.fn(),
  renameChatMock: vi.fn(),
  setChatBookmarkedMock: vi.fn(),
  fetchCharacterChatsPageMock: vi.fn(),
  fetchCharacterChatExportMock: vi.fn(),
  downloadBlobMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}))

vi.mock('@/app/dashboard/chats/actions', () => ({
  deleteChat: (...args: unknown[]) => deleteChatMock(...args),
}))

vi.mock('../character-chats-client', () => ({
  fetchCharacterChatsPage: (...args: unknown[]) => fetchCharacterChatsPageMock(...args),
  fetchCharacterChatExport: (...args: unknown[]) => fetchCharacterChatExportMock(...args),
}))

vi.mock('@/app/dashboard/chats/chat-list-actions', () => ({
  renameChat: (...args: unknown[]) => renameChatMock(...args),
  setChatBookmarked: (...args: unknown[]) => setChatBookmarkedMock(...args),
}))

vi.mock('../download-blob', () => ({
  downloadBlob: (...args: unknown[]) => downloadBlobMock(...args),
}))

describe('useCharacterChats', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    toastErrorMock.mockReset()
    deleteChatMock.mockReset()
    renameChatMock.mockReset()
    setChatBookmarkedMock.mockReset()
    fetchCharacterChatsPageMock.mockReset()
    fetchCharacterChatExportMock.mockReset()
    downloadBlobMock.mockReset()
  })

  it('exports a chat through the extracted transport and download boundaries', async () => {
    const blob = new Blob(['{}'])
    fetchCharacterChatExportMock.mockResolvedValue({
      blob,
      filename: 'guide.json',
    })

    const { result } = renderHook(() =>
      useCharacterChats({
        characterId: 'char-1',
        initialChats: [],
        initialChatCursor: null,
        initialHasMoreChats: false,
      }),
    )

    await act(async () => {
      await result.current.exportChat('chat-1')
    })

    expect(fetchCharacterChatExportMock).toHaveBeenCalledWith('chat-1')
    expect(downloadBlobMock).toHaveBeenCalledWith(blob, 'guide.json')
    expect(result.current.exportingChatId).toBeNull()
  })

  it('surfaces the extracted export error message to the toast layer', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchCharacterChatExportMock.mockRejectedValue(new Error('Export denied'))

    const { result } = renderHook(() =>
      useCharacterChats({
        characterId: 'char-1',
        initialChats: [],
        initialChatCursor: null,
        initialHasMoreChats: false,
      }),
    )

    await act(async () => {
      await result.current.exportChat('chat-1')
    })

    expect(toastErrorMock).toHaveBeenCalledWith('Export denied')
    expect(result.current.exportingChatId).toBeNull()
    consoleErrorSpy.mockRestore()
  })

  it('appends the next chat page through the extracted page loader', async () => {
    fetchCharacterChatsPageMock.mockResolvedValue({
      chats: [
        {
          id: 'chat-2',
          title: 'Imported',
          created_at: '2026-01-02',
          last_message_at: null,
          recency_at: '2026-01-02',
          is_bookmarked: false,
          lastMessage: null,
        },
      ],
      hasMore: false,
      nextCursor: null,
    })

    const { result } = renderHook(() =>
      useCharacterChats({
        characterId: 'char-1',
        initialChats: [
          {
            id: 'chat-1',
            title: 'Existing',
            created_at: '2026-01-01',
            last_message_at: null,
            recency_at: '2026-01-01',
            is_bookmarked: false,
            lastMessage: null,
          },
        ],
        initialChatCursor: 'cursor-1',
        initialHasMoreChats: true,
      }),
    )

    await act(async () => {
      await result.current.loadMoreChats()
    })

    expect(fetchCharacterChatsPageMock).toHaveBeenCalledWith('char-1', 'cursor-1')
    expect(result.current.chatList.map((chat) => chat.id)).toEqual(['chat-1', 'chat-2'])
    expect(result.current.hasMoreChatPages).toBe(false)
    expect(result.current.isChatLoading).toBe(false)
  })

  it('refreshes the route after a successful delete confirmation', async () => {
    deleteChatMock.mockResolvedValue({ success: true })

    const { result } = renderHook(() =>
      useCharacterChats({
        characterId: 'char-1',
        initialChats: [],
        initialChatCursor: null,
        initialHasMoreChats: false,
      }),
    )

    act(() => {
      result.current.requestDeleteCharacterChat('chat-1', 'Imported')
    })

    await act(async () => {
      await result.current.confirmDeleteCharacterChat()
    })

    expect(deleteChatMock).toHaveBeenCalledWith('chat-1', false)
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces delete failures without clearing the chat list', async () => {
    deleteChatMock.mockResolvedValue({ error: 'Delete failed' })

    const { result } = renderHook(() =>
      useCharacterChats({
        characterId: 'char-1',
        initialChats: [
          {
            id: 'chat-1',
            title: 'Existing',
            created_at: '2026-01-01',
            last_message_at: null,
            recency_at: '2026-01-01',
            is_bookmarked: false,
            lastMessage: null,
          },
        ],
        initialChatCursor: null,
        initialHasMoreChats: false,
      }),
    )

    act(() => {
      result.current.requestDeleteCharacterChat('chat-1', 'Existing')
    })

    await act(async () => {
      await result.current.confirmDeleteCharacterChat()
    })

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Delete failed')
    })
    expect(result.current.chatList.map((chat) => chat.id)).toEqual(['chat-1'])
  })
})

const oldRoom = {
  id: 'old-room',
  title: 'Old',
  created_at: '2026-01-01',
  last_message_at: null,
  recency_at: '2026-01-01',
  is_bookmarked: false,
  lastMessage: null,
}
function renderRooms() {
  return renderHook(() =>
    useCharacterChats({
      characterId: 'char-1',
      initialChats: [oldRoom],
      initialChatCursor: 'old-cursor',
      initialHasMoreChats: true,
    }),
  )
}
describe('chat list mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setChatBookmarkedMock.mockReset()
    renameChatMock.mockReset()
    fetchCharacterChatsPageMock.mockReset()
  })
  it('reloads the first page and replaces the cursor after changing bookmark order', async () => {
    setChatBookmarkedMock.mockResolvedValue({ chat: { ...oldRoom, is_bookmarked: true } })
    fetchCharacterChatsPageMock.mockResolvedValue({
      chats: [{ ...oldRoom, is_bookmarked: true }],
      hasMore: true,
      nextCursor: 'new-cursor',
    })
    const { result } = renderRooms()
    await act(async () => {
      await result.current.bookmarkChat(oldRoom)
    })
    expect(setChatBookmarkedMock).toHaveBeenCalledWith('old-room', true)
    expect(fetchCharacterChatsPageMock).toHaveBeenCalledWith('char-1', null)
    expect(result.current.chatList[0].is_bookmarked).toBe(true)
    fetchCharacterChatsPageMock.mockResolvedValue({ chats: [], hasMore: false, nextCursor: null })
    await act(async () => {
      await result.current.loadMoreChats()
    })
    expect(fetchCharacterChatsPageMock).toHaveBeenLastCalledWith('char-1', 'new-cursor')
  })
  it('does not change local bookmarks or pagination when saving fails', async () => {
    setChatBookmarkedMock.mockResolvedValue({ error: 'Denied' })
    const { result } = renderRooms()
    await act(async () => {
      await result.current.bookmarkChat(oldRoom)
    })
    expect(result.current.chatList[0].is_bookmarked).toBe(false)
    expect(result.current.hasMoreChatPages).toBe(true)
    expect(result.current.updatingChatId).toBeNull()
    expect(toastErrorMock).toHaveBeenCalledWith('Denied')
  })
  it('keeps a saved bookmark and offers a fresh list retry when reloading fails', async () => {
    setChatBookmarkedMock.mockResolvedValue({ chat: { ...oldRoom, is_bookmarked: true } })
    fetchCharacterChatsPageMock.mockRejectedValueOnce(new Error('Offline'))
    const { result } = renderRooms()
    await act(async () => {
      await result.current.bookmarkChat(oldRoom)
    })
    expect(result.current.chatList[0].is_bookmarked).toBe(true)
    expect(result.current.chatListError).toContain('저장됐지만')
    expect(result.current.hasMoreChatPages).toBe(false)
    fetchCharacterChatsPageMock.mockResolvedValue({
      chats: [{ ...oldRoom, is_bookmarked: true }],
      hasMore: false,
      nextCursor: null,
    })
    await act(async () => {
      await result.current.retryChatList()
    })
    expect(result.current.chatListError).toBeNull()
  })
  it('renames the local room without discarding loaded pages', async () => {
    renameChatMock.mockResolvedValue({ chat: { ...oldRoom, title: '본편' } })
    const { result } = renderRooms()
    await act(async () => {
      expect(await result.current.renameCharacterChat('old-room', '본편')).toEqual({})
    })
    expect(result.current.chatList[0].title).toBe('본편')
    expect(result.current.hasMoreChatPages).toBe(true)
    renameChatMock.mockResolvedValue({ error: 'Denied' })
    await act(async () => {
      expect(await result.current.renameCharacterChat('old-room', 'Lost')).toEqual({
        error: 'Denied',
      })
    })
    expect(result.current.chatList[0].title).toBe('본편')
  })
  it('does not allow two pagination or bookmark requests to race', async () => {
    let finish!: (value: unknown) => void
    fetchCharacterChatsPageMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { result } = renderRooms()
    let loading!: Promise<void>
    act(() => {
      loading = result.current.loadMoreChats()
    })
    await act(async () => {
      await result.current.bookmarkChat(oldRoom)
      await result.current.loadMoreChats()
    })
    expect(setChatBookmarkedMock).not.toHaveBeenCalled()
    expect(fetchCharacterChatsPageMock).toHaveBeenCalledOnce()
    await act(async () => {
      finish({ chats: [oldRoom], hasMore: false, nextCursor: null })
      await loading
    })
    expect(result.current.chatList).toHaveLength(1)
  })
})
