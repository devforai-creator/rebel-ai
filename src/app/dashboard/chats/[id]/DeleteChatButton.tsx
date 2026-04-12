'use client'

import React, { useState } from 'react'
import { toast } from 'sonner'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import { deleteChat } from '../actions'

interface Props {
  chatId: string
  chatTitle: string | null
  asMenuItem?: boolean
}

export default function DeleteChatButton({ chatId, chatTitle, asMenuItem = false }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  async function handleDelete() {
    setIsConfirmOpen(true)
  }

  async function confirmDelete() {
    const shouldDelete = isConfirmOpen
    setIsConfirmOpen(false)

    await runConfirmedAction(shouldDelete ? chatId : null, async (targetChatId) => {
      setDeleting(true)
      const result = await deleteChat(targetChatId)

      if (result?.error) {
        toast.error(result.error)
        setDeleting(false)
      }
      // Redirect is handled automatically on success
    })
  }

  return (
    <>
      <Button
        onClick={handleDelete}
        disabled={deleting}
        variant="ghostDestructive"
        size={asMenuItem ? 'md' : 'sm'}
        className={
          asMenuItem
            ? 'w-full justify-start px-4 text-left'
            : 'border border-red-300 dark:border-red-800'
        }
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
      </Button>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete "${chatTitle || 'this chat'}"?`}
        description="All messages and summaries will be deleted and cannot be recovered."
        confirmLabel="Delete chat"
        isConfirming={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setIsConfirmOpen(false)}
      />
    </>
  )
}
