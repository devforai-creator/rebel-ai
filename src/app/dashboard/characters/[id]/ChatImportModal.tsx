'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { deriveChatImportTitle, submitChatImport } from './chat-import-logic'
import { importCharacterChat } from './character-chats-client'

interface Props {
  characterId: string
  characterName: string
  isOpen: boolean
  onClose: () => void
}

export default function ChatImportModal({ characterId, characterName, isOpen, onClose }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [chatTitle, setChatTitle] = useState('')
  const [pendingImportedChat, setPendingImportedChat] = useState<{
    chatId: string
    messageCount: number
  } | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setError(null)
      setChatTitle(deriveChatImportTitle(file.name))
    }
  }

  async function handleImport() {
    setIsLoading(true)
    setError(null)

    const result = await submitChatImport({
      characterId,
      selectedFile,
      chatTitle,
      importChatImpl: importCharacterChat,
    })

    setIsLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onClose()
    setPendingImportedChat(result.pendingImportedChat)
  }

  function handleClose() {
    setSelectedFile(null)
    setChatTitle('')
    setError(null)
    onClose()
  }

  async function confirmNavigation() {
    const importedChat = pendingImportedChat
    setPendingImportedChat(null)

    await runConfirmedAction(importedChat, async ({ chatId }) => {
      router.push(`/dashboard/chats/${chatId}`)
    })
  }

  return (
    <>
      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

          {/* Modal */}
          <SurfaceCard padding="none" className="relative max-w-md w-full mx-4 p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Import Chat
            </h3>

            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Import a compatible chat export file (.json) into the <strong>{characterName}</strong>{' '}
              character.
            </p>

            {/* File selection */}
            <div className="mb-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
              />
              <SurfaceCard tone="dashed" padding="none" className="shadow-none">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-3 text-center transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
                >
                  {selectedFile ? (
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {selectedFile.name}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Click to select JSON file
                    </span>
                  )}
                </button>
              </SurfaceCard>
            </div>

            {/* Chat title */}
            {selectedFile && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Chat Title (optional)
                </label>
                <input
                  type="text"
                  value={chatTitle}
                  onChange={(e) => setChatTitle(e.target.value)}
                  placeholder="Title for the imported chat"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                />
              </div>
            )}

            {/* Error message */}
            {error && (
              <InlineFeedback tone="error" className="mb-4">
                {error}
              </InlineFeedback>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                variant="secondary"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleImport}
                disabled={isLoading || !selectedFile}
                className="flex-1"
              >
                {isLoading ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </SurfaceCard>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={pendingImportedChat !== null}
        title="Open imported chat?"
        description={
          pendingImportedChat
            ? `Imported ${pendingImportedChat.messageCount} messages successfully.`
            : undefined
        }
        confirmLabel="Go to chat"
        cancelLabel="Stay here"
        tone="primary"
        onConfirm={() => void confirmNavigation()}
        onClose={() => setPendingImportedChat(null)}
      />
    </>
  )
}
