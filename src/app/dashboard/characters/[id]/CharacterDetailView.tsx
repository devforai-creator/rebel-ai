'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Button, { buttonClassName } from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import EmptyState from '@/app/dashboard/components/EmptyState'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import CharacterForm from '../CharacterForm'
import ChatImportModal from './ChatImportModal'
import type { CharacterDetailViewProps } from './character-detail-types'
import { useCharacterChats } from './hooks/useCharacterChats'

const NewChatButton = dynamic(() => import('./NewChatButton'), {
  ssr: false,
})

export default function CharacterDetailView({
  character,
  chats,
  isStarter,
  modules,
  initialModuleIds,
  hasMoreChats,
  initialChatCursor,
}: CharacterDetailViewProps) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const {
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
  } = useCharacterChats({
    characterId: character.id,
    initialChats: chats,
    initialChatCursor,
    initialHasMoreChats: hasMoreChats,
  })

  if (isEditMode) {
    return (
      <div className="max-w-4xl mx-auto">
        {/* Edit mode header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Character</h2>
          <Button onClick={() => setIsEditMode(false)} variant="secondary">
            ← View Mode
          </Button>
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Character info */}
      <div className="lg:col-span-1">
        <SurfaceCard padding="lg" className="sticky top-8">
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
              <Button
                onClick={() => setIsEditMode(true)}
                variant="secondary"
                fullWidth
                className="mb-2"
              >
                Edit Mode
              </Button>
              <Link
                href={`/dashboard/characters/${character.id}/lorebook`}
                className={buttonClassName({
                  variant: 'secondary',
                  fullWidth: true,
                })}
              >
                Lorebook Management
              </Link>
            </>
          )}
        </SurfaceCard>
      </div>

      {/* Right: Chat list */}
      <div className="lg:col-span-2">
        <SurfaceCard padding="lg">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Chat History</h2>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setIsImportModalOpen(true)}
                variant="secondary"
                title="Import chat"
              >
                Import Chat
              </Button>
              <NewChatButton characterId={character.id} />
            </div>
          </div>

          {/* Chat list */}
          {chatList.length > 0 ? (
            <div className="space-y-3">
              {chatList.map((chat) => (
                <SurfaceCard key={chat.id} tone="subtle" padding="none" className="overflow-hidden">
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
                    <Button
                      onClick={() => exportChat(chat.id)}
                      disabled={exportingChatId === chat.id}
                      variant="ghost"
                      size="sm"
                      className="-ml-2"
                    >
                      {exportingChatId === chat.id ? 'Exporting...' : 'Export'}
                    </Button>
                    <Button
                      onClick={() => requestDeleteCharacterChat(chat.id, chat.title)}
                      disabled={deletingChatId === chat.id}
                      variant="ghostDestructive"
                      size="sm"
                      className="-ml-2"
                    >
                      {deletingChatId === chat.id ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </SurfaceCard>
              ))}
            </div>
          ) : (
            <EmptyState
              className="py-12"
              title="No chats with this character yet"
              description="Start a new chat or import an existing JSON export from the actions above."
              icon={
                <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              }
            />
          )}

          {hasMoreChatPages && (
            <div className="mt-6 flex justify-center">
              <Button onClick={loadMoreChats} disabled={isChatLoading} variant="secondary">
                {isChatLoading ? 'Loading more chats...' : 'Load more chat history'}
              </Button>
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Import Modal */}
      <ChatImportModal
        characterId={character.id}
        characterName={character.name}
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />

      <ConfirmDialog
        isOpen={pendingDeleteChat !== null}
        title={`Delete "${pendingDeleteChat?.title || 'this chat'}"?`}
        description="All messages and summaries will be deleted and cannot be recovered."
        confirmLabel="Delete chat"
        isConfirming={pendingDeleteChat !== null && deletingChatId === pendingDeleteChat.id}
        onConfirm={() => void confirmDeleteCharacterChat()}
        onClose={cancelDeleteCharacterChat}
      />
    </div>
  )
}
