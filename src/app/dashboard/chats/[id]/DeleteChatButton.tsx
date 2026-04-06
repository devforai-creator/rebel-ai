'use client'

import { useState } from 'react'
import { deleteChat } from '../actions'

interface Props {
  chatId: string
  chatTitle: string | null
  asMenuItem?: boolean
}

export default function DeleteChatButton({ chatId, chatTitle, asMenuItem = false }: Props) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (
      !confirm(
        `Are you sure you want to delete "${chatTitle || 'this chat'}"?\n\nAll messages and summaries will be deleted and cannot be recovered.`,
      )
    ) {
      return
    }

    setDeleting(true)
    const result = await deleteChat(chatId)

    if (result?.error) {
      alert(result.error)
      setDeleting(false)
    }
    // Redirect is handled automatically on success
  }

  const buttonClassName = asMenuItem
    ? 'w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50'
    : 'px-3 py-1.5 text-sm border border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg transition-colors disabled:opacity-50'

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className={buttonClassName}
      title="Delete chat"
      role={asMenuItem ? 'menuitem' : undefined}
    >
      {asMenuItem ? (
        <>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          <span>{deleting ? 'Deleting...' : 'Delete Chat'}</span>
        </>
      ) : deleting ? (
        'Deleting...'
      ) : (
        'Delete'
      )}
    </button>
  )
}
