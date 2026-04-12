'use client'

import { useState, useRef } from 'react'
import { importChat } from '@/app/dashboard/chats/actions'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'

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
      // Try to extract title from filename
      const nameWithoutExt = file.name.replace(/_chat\.json$/i, '').replace(/\.json$/i, '')
      setChatTitle(nameWithoutExt)
    }
  }

  async function handleImport() {
    if (!selectedFile) {
      setError('Please select a file')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const content = await selectedFile.text()
      const result = await importChat(characterId, content, chatTitle || undefined)

      if (result.success) {
        onClose()
        router.refresh()
        if (result.chatId) {
          setPendingImportedChat({
            chatId: result.chatId,
            messageCount: result.messageCount ?? 0,
          })
        }
      } else {
        setError(result.error || 'Import failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      setIsLoading(false)
    }
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
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-center"
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
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={isLoading || !selectedFile}
                className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
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
