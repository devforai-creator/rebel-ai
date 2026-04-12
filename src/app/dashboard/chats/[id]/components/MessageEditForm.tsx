'use client'

import { useRef } from 'react'
import { useAutosizeTextArea } from '@/hooks/useAutosizeTextArea'

interface MessageEditFormProps {
  messageId: string
  editContent: string
  onChangeEditContent: (value: string) => void
  onSaveEdit: (id: string) => void
  onCancelEdit: () => void
}

export function MessageEditForm({
  messageId,
  editContent,
  onChangeEditContent,
  onSaveEdit,
  onCancelEdit,
}: MessageEditFormProps) {
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useAutosizeTextArea(editTextareaRef, editContent, {
    minHeight: 120,
    maxHeight: 800,
  })

  return (
    <div className="w-full">
      <textarea
        ref={editTextareaRef}
        value={editContent}
        onChange={(event) => onChangeEditContent(event.target.value)}
        className="max-h-[70vh] w-full resize-none overflow-y-auto rounded-lg border border-gray-300 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        rows={1}
        autoFocus
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void onSaveEdit(messageId)}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-700"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancelEdit}
          className="rounded bg-gray-500 px-3 py-1 text-sm text-white transition-colors hover:bg-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
