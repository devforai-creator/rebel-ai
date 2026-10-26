'use client'

import React, { useRef, useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buildSaveManagementHref } from '@/lib/character-saves/navigation'
import { updateChatSave } from '@/app/dashboard/saves/actions'

type SaveOption = { id: string; title: string; character_id: string | null }

export default function ChatSaveWidget({
  chatId,
  characterId,
  currentSaveId,
  availableSaves,
}: {
  chatId: string
  characterId: string
  currentSaveId: string | null
  availableSaves: SaveOption[]
}) {
  const router = useRouter()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [selectedSaveId, setSelectedSaveId] = useState(currentSaveId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const currentSave = availableSaves.find((save) => save.id === currentSaveId)
  const managementHref = buildSaveManagementHref({
    characterId,
    saveId: currentSaveId,
    returnTo: '/dashboard/chats/' + chatId,
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const result = await updateChatSave(chatId, selectedSaveId || null)
        if (result.error) {
          setError(result.error)
          return
        }
        if (detailsRef.current) detailsRef.current.open = false
        router.refresh()
      } catch {
        setError('세이브를 연결하지 못했습니다. 다시 시도해주세요.')
      }
    })
  }

  return (
    <details
      ref={detailsRef}
      className="relative"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setSelectedSaveId(currentSaveId ?? '')
          setError(null)
        }
      }}
    >
      <summary className="max-w-[200px] cursor-pointer truncate rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
        세이브: {currentSave?.title ?? '선택 안 함'}
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-72 max-w-[85vw] rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-600 dark:bg-gray-800">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label
            htmlFor="chat-save"
            className="block text-sm font-medium text-gray-900 dark:text-white"
          >
            이 채팅의 세이브
          </label>
          <select
            id="chat-save"
            value={selectedSaveId}
            onChange={(event) => setSelectedSaveId(event.target.value)}
            disabled={pending}
            className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          >
            <option value="">세이브 없이 진행</option>
            {availableSaves.map((save) => (
              <option key={save.id} value={save.id}>
                {save.title}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            연결한 세이브의 내용은 다음 답변부터 적용됩니다.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || selectedSaveId === (currentSaveId ?? '')}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? '연결 중…' : '연결 적용'}
          </button>
        </form>
        <Link
          href={managementHref}
          className="mt-4 block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          세이브 편집·관리
        </Link>
      </div>
    </details>
  )
}
