'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { Character } from '@/types/database.types'
import CharacterForm, { type EditableCharacterFields } from '../CharacterForm'
import { deleteChat } from '@/app/dashboard/chats/actions'
import { useRouter } from 'next/navigation'
import ChatImportModal from './ChatImportModal'

const NewChatButton = dynamic(() => import('./NewChatButton'), {
  ssr: false,
})

interface Chat {
  id: string
  title: string | null
  updated_at: string
  created_at: string
  lastMessage: { content: string; role: string } | null
}

interface Module {
  id: string
  name: string
}

export type CharacterDetail = EditableCharacterFields &
  Pick<Character, 'avatar_url' | 'visibility' | 'created_at'>

interface Props {
  character: CharacterDetail
  chats: Chat[]
  isStarter: boolean
  modules: Module[]
  initialModuleIds: string[]
  hasMoreChats: boolean
  initialChatCursor: string | null
}

export default function CharacterDetailView({
  character,
  chats,
  isStarter,
  modules,
  initialModuleIds,
  hasMoreChats,
  initialChatCursor,
}: Props) {
  const router = useRouter()
  const [isEditMode, setIsEditMode] = useState(false)
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null)
  const [chatList, setChatList] = useState(chats)
  const [chatCursor, setChatCursor] = useState(initialChatCursor)
  const [hasMoreChatPages, setHasMoreChatPages] = useState(hasMoreChats)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [exportingChatId, setExportingChatId] = useState<string | null>(null)

  async function handleExportChat(chatId: string) {
    setExportingChatId(chatId)
    try {
      const response = await fetch(`/api/chats/${chatId}/export`)
      if (!response.ok) {
        throw new Error('Export failed')
      }

      // Extract filename from Content-Disposition header
      const disposition = response.headers.get('Content-Disposition')
      let filename = 'chat_export.json'
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/)
        if (match) {
          filename = decodeURIComponent(match[1])
        }
      }

      // Download as Blob
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export failed:', error)
      alert('Failed to export chat')
    } finally {
      setExportingChatId(null)
    }
  }

  async function handleDeleteChat(chatId: string, chatTitle: string | null) {
    if (
      !confirm(
        `Are you sure you want to delete "${chatTitle || 'this chat'}"?\n\nAll messages and summaries will be deleted and cannot be recovered.`,
      )
    ) {
      return
    }

    setDeletingChatId(chatId)
    const result = await deleteChat(chatId, false) // shouldRedirect = false

    if (result?.error) {
      alert(result.error)
      setDeletingChatId(null)
    } else {
      // Refresh page on success
      setDeletingChatId(null)
      router.refresh()
    }
  }

  if (isEditMode) {
    return (
      <div className="max-w-4xl mx-auto">
        {/* Edit mode header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Character</h2>
          <button
            onClick={() => setIsEditMode(false)}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            ← View Mode
          </button>
        </div>

        {/* CharacterForm */}
        <CharacterForm
          character={character}
          modules={modules}
          initialModuleIds={initialModuleIds}
        />
      </div>
    )
  }

  async function handleLoadMoreChats() {
    if (!hasMoreChatPages || isChatLoading || !chatCursor) {
      return
    }

    setIsChatLoading(true)

    try {
      const response = await fetch(
        `/api/characters/${character.id}/chats?before=${encodeURIComponent(chatCursor)}`,
      )

      if (!response.ok) {
        console.error('Failed to load more chats:', response.statusText)
        return
      }

      const data = (await response.json()) as {
        chats: Chat[]
        hasMore: boolean
        nextCursor: string | null
      }

      if (Array.isArray(data.chats) && data.chats.length > 0) {
        setChatList((prev) => [...prev, ...data.chats])
        setHasMoreChatPages(data.hasMore)
        setChatCursor(data.nextCursor)
      } else {
        setHasMoreChatPages(false)
        setChatCursor(null)
      }
    } catch (error) {
      console.error('Failed to load more chats:', error)
    } finally {
      setIsChatLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Character info */}
      <div className="lg:col-span-1">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 sticky top-8">
          {/* Avatar */}
          <div className="flex justify-center mb-4">
            {character.avatar_url ? (
              <Image
                src={character.avatar_url}
                alt={character.name}
                width={128}
                height={128}
                unoptimized
                className="w-32 h-32 rounded-full object-cover border-4 border-gray-200 dark:border-gray-600"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center border-4 border-gray-200 dark:border-gray-600">
                <span className="text-white text-4xl font-bold">
                  {character.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Name & Badge */}
          <div className="text-center mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {character.name}
            </h2>
            {isStarter && (
              <span className="inline-block px-3 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded-full">
                Starter Character
              </span>
            )}
          </div>

          {/* Meta info */}
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 mb-4">
            <div className="flex justify-between">
              <span>Created:</span>
              <span>{new Date(character.created_at).toLocaleDateString('en-US')}</span>
            </div>
            <div className="flex justify-between">
              <span>Visibility:</span>
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                {character.visibility}
              </span>
            </div>
          </div>

          {/* Edit button */}
          {!isStarter && (
            <>
              <button
                onClick={() => setIsEditMode(true)}
                className="w-full py-2 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-lg transition-colors mb-2"
              >
                Edit Mode
              </button>
              <Link
                href={`/dashboard/characters/${character.id}/lorebook`}
                className="block w-full py-2 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-lg transition-colors text-center"
              >
                Lorebook Management
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Right: Chat list */}
      <div className="lg:col-span-2">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Chat History</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                title="Import chat"
              >
                Import Chat
              </button>
              <NewChatButton characterId={character.id} />
            </div>
          </div>

          {/* Chat list */}
          {chatList.length > 0 ? (
            <div className="space-y-3">
              {chatList.map((chat) => (
                <div
                  key={chat.id}
                  className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden"
                >
                  <Link
                    href={`/dashboard/chats/${chat.id}`}
                    className="block p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {chat.title || 'Untitled'}
                        </h3>
                        {chat.lastMessage && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                            {chat.lastMessage.role === 'user' ? 'You: ' : ''}
                            {chat.lastMessage.content}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {new Date(chat.updated_at).toLocaleString('en-US')}
                        </p>
                      </div>
                      <svg
                        className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </Link>
                  <div className="px-4 pb-3 border-t border-gray-200 dark:border-gray-600 pt-2 flex items-center gap-3">
                    <button
                      onClick={() => handleExportChat(chat.id)}
                      disabled={exportingChatId === chat.id}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                    >
                      {exportingChatId === chat.id ? 'Exporting...' : 'Export'}
                    </button>
                    <button
                      onClick={() => handleDeleteChat(chat.id, chat.title)}
                      disabled={deletingChatId === chat.id}
                      className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
                    >
                      {deletingChatId === chat.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <svg
                className="mx-auto h-12 w-12 text-gray-400 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                No chats yet with this character
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Click the &quot;Start New Chat&quot; button above to begin a conversation
              </p>
            </div>
          )}

          {hasMoreChatPages && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMoreChats}
                disabled={isChatLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {isChatLoading ? 'Loading...' : 'Load More Chats'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Import Modal */}
      <ChatImportModal
        characterId={character.id}
        characterName={character.name}
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  )
}
