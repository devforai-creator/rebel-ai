'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import { deleteAccount } from './actions'

export default function DeleteAccountButton() {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  async function handleClick() {
    setIsConfirmOpen(true)
  }

  async function confirmDelete() {
    const shouldDelete = isConfirmOpen
    setIsConfirmOpen(false)

    await runConfirmedAction(shouldDelete ? true : null, async () => {
      setIsDeleting(true)

      try {
        const result = await deleteAccount()

        if (result?.error) {
          toast.error(result.error)
          setIsDeleting(false)
          return
        }

        if ('warning' in result && result.warning) {
          toast(result.warning)
        }

        router.replace('/auth/login?accountDeleted=1')
      } catch (err) {
        console.error('[Account] deleteAccount unexpected error', err)
        toast.error('An unexpected error occurred. Please try again later.')
        setIsDeleting(false)
      }
    })
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleClick} disabled={isDeleting} variant="destructive">
        {isDeleting ? 'Deleting account...' : 'Delete Account'}
      </Button>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Delete account?"
        description="This permanently deletes your account, saved keys, characters, chats, and memory data. This action cannot be undone."
        confirmLabel="Delete account"
        isConfirming={isDeleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setIsConfirmOpen(false)}
      />
    </div>
  )
}
