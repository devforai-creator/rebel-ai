'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Pencil, Star, X } from 'lucide-react'
import Button from '@/app/dashboard/components/Button'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import LocalTimestamp from '@/app/dashboard/components/LocalTimestamp'
import { CHAT_TITLE_MAX_LENGTH, chatTitleSchema } from '@/lib/chat/chat-list-contract'
import type { CharacterChat } from './character-detail-types'

interface Props {
  chat: CharacterChat
  busy: boolean
  exporting: boolean
  deleting: boolean
  onBookmark: () => void
  onRename: (title: string) => Promise<{ error?: string }>
  onExport: () => void
  onDelete: () => void
}

export default function ChatHistoryItem({
  chat,
  busy,
  exporting,
  deleting,
  onBookmark,
  onRename,
  onExport,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chat.title ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const displayTitle = chat.title || 'Untitled'

  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false
      editButtonRef.current?.focus()
    }
  }, [editing])

  function closeEditor() {
    setEditing(false)
    setError(null)
    restoreFocus.current = true
  }

  async function saveTitle() {
    const parsed = chatTitleSchema.safeParse(title)
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    if (saving || busy) return
    setSaving(true)
    setError(null)
    try {
      const result = await onRename(parsed.data)
      if (result.error) setError(result.error)
      else closeEditor()
    } catch {
      setError('제목을 저장하지 못했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SurfaceCard tone="subtle" padding="none" className="overflow-hidden">
      <div className="flex items-start">
        <Link
          href={`/dashboard/chats/${chat.id}`}
          prefetch={false}
          className="block min-w-0 flex-1 p-4 pr-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <h3
            className="text-sm font-medium text-gray-900 dark:text-white truncate"
            title={displayTitle}
          >
            {displayTitle}
          </h3>
          {chat.lastMessage && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
              {chat.lastMessage.role === 'user' ? 'You: ' : ''}
              {chat.lastMessage.content}
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {chat.last_message_at === null ? 'Created: ' : 'Last message: '}
            <LocalTimestamp timestamp={chat.recency_at} />
          </p>
        </Link>
        <button
          type="button"
          onClick={onBookmark}
          disabled={busy || editing || deleting}
          aria-label={`${chat.is_bookmarked ? '북마크 해제' : '북마크'}: ${displayTitle}`}
          aria-pressed={chat.is_bookmarked}
          title={chat.is_bookmarked ? '북마크 해제' : '북마크하여 상단 고정'}
          className={`mr-2 mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${chat.is_bookmarked ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}
        >
          <Star
            className="h-4 w-4"
            fill={chat.is_bookmarked ? 'currentColor' : 'none'}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="px-4 pb-2 border-t border-gray-200 dark:border-gray-600 pt-1">
        <div className={editing ? 'hidden' : 'flex items-center gap-3'}>
          <Button
            onClick={onExport}
            disabled={exporting}
            variant="ghost"
            size="sm"
            className="-ml-2"
          >
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
          <Button
            onClick={onDelete}
            disabled={busy || deleting}
            variant="ghostDestructive"
            size="sm"
            className="-ml-2"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
          <button
            ref={editButtonRef}
            type="button"
            disabled={busy || deleting}
            onClick={() => {
              setTitle(chat.title ?? '')
              setError(null)
              setEditing(true)
            }}
            aria-label={`제목 변경: ${displayTitle}`}
            title="제목 변경"
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {editing && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveTitle()
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.nativeEvent.isComposing || event.keyCode === 229)
              ) {
                event.preventDefault()
                return
              }
              if (event.key === 'Escape' && !saving) {
                event.preventDefault()
                closeEditor()
              }
            }}
          >
            <div className="flex min-w-0 items-center gap-1">
              <input
                autoFocus
                aria-label="채팅방 제목"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `chat-title-error-${chat.id}` : undefined}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setError(null)
                }}
                maxLength={CHAT_TITLE_MAX_LENGTH}
                disabled={saving}
                className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
              <button
                type="submit"
                disabled={saving || busy}
                aria-label="제목 저장"
                title="저장"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={closeEditor}
                disabled={saving}
                aria-label="제목 변경 취소"
                title="취소"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {error && (
              <p
                id={`chat-title-error-${chat.id}`}
                role="alert"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </SurfaceCard>
  )
}
