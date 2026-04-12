'use client'

import React from 'react'
import { useEffect, useId, type ReactNode } from 'react'
import Button from './Button'
import SurfaceCard from './SurfaceCard'

type ConfirmDialogTone = 'danger' | 'primary'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmDialogTone
  isConfirming?: boolean
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  isConfirming = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId()

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <SurfaceCard
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        padding="none"
        className="w-full max-w-md overflow-hidden shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-6 py-5 dark:border-gray-700">
          <h3 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
          {description ? (
            <div className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-300">
              {description}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 px-6 py-4 sm:flex-row sm:justify-end">
          <Button onClick={onClose} disabled={isConfirming} variant="secondary">
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isConfirming}
            variant={tone === 'primary' ? 'primary' : 'destructive'}
          >
            {isConfirming ? 'Working...' : confirmLabel}
          </Button>
        </div>
      </SurfaceCard>
    </div>
  )
}
