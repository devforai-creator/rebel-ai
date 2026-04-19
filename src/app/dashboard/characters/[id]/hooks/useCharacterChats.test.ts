// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCharacterChats } from './useCharacterChats'

const {
  refreshMock,
  toastErrorMock,
  deleteChatMock,
  fetchCharacterChatsPageMock,
  fetchCharacterChatExportMock,
  downloadBlobMock,
} = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  deleteChatMock: vi.fn(),
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
  },
}))

vi.mock('@/app/dashboard/chats/actions', () => ({
  deleteChat: (...args: unknown[]) => deleteChatMock(...args),
}))

vi.mock('../character-chats-client', () => ({
  fetchCharacterChatsPage: (...args: unknown[]) => fetchCharacterChatsPageMock(...args),
  fetchCharacterChatExport: (...args: unknown[]) => fetchCharacterChatExportMock(...args),
}))

vi.mock('../download-blob', () => ({
  downloadBlob: (...args: unknown[]) => downloadBlobMock(...args),
}))

describe('useCharacterChats', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    toastErrorMock.mockReset()
    deleteChatMock.mockReset()
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

  it('appends the next chat page through the extracted page loader', async () => {
    fetchCharacterChatsPageMock.mockResolvedValue({
      chats: [
        {
          id: 'chat-2',
          title: 'Imported',
          created_at: '2026-01-02',
          updated_at: '2026-01-02',
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
            updated_at: '2026-01-01',
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
            updated_at: '2026-01-01',
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
