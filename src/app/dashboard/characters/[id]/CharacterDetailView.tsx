'use client'

import dynamic from 'next/dynamic'
import React, { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Button, { buttonClassName } from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import EmptyState from '@/app/dashboard/components/EmptyState'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import LocalTimestamp from '@/app/dashboard/components/LocalTimestamp'
import CharacterForm from '../CharacterForm'
import ChatImportModal from './ChatImportModal'
import ChatHistoryItem from './ChatHistoryItem'
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
              <LocalTimestamp timestamp={character.created_at} dateOnly />
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
                <ChatHistoryItem
                  key={chat.id}
                  chat={chat}
                  busy={Boolean(updatingChatId) || Boolean(deletingChatId) || isChatLoading}
                  exporting={exportingChatId === chat.id}
                  deleting={deletingChatId === chat.id}
                  onBookmark={() => void bookmarkChat(chat)}
                  onRename={(title) => renameCharacterChat(chat.id, title)}
                  onExport={() => void exportChat(chat.id)}
                  onDelete={() => requestDeleteCharacterChat(chat.id, chat.title)}
                />
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

          {chatListError && (
            <div role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
              <p>{chatListError}</p>
              <Button
                onClick={() => void retryChatList()}
                disabled={isChatLoading || Boolean(updatingChatId)}
                variant="ghost"
                size="sm"
              >
                목록 다시 불러오기
              </Button>
            </div>
          )}
          {hasMoreChatPages && (
            <div className="mt-6 flex justify-center">
              <Button
                onClick={loadMoreChats}
                disabled={isChatLoading || Boolean(updatingChatId)}
                variant="secondary"
              >
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
