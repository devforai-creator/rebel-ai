'use client'

import React from 'react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { buildPersonaManagementHref } from '@/lib/navigation/dashboard-return'
import { updateChatPersona } from './actions'
import type { PersonaOption } from './chat-persona-types'

interface ChatPersonaSelectDialogProps {
  chatId: string
  currentPersonaId: string | null
  currentPersonaName: string | null
  availablePersonas: PersonaOption[]
  asMenuItem?: boolean
}

export default function ChatPersonaSelectDialog({
  chatId,
  currentPersonaId,
  currentPersonaName,
  availablePersonas,
  asMenuItem = false,
}: ChatPersonaSelectDialogProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedPersonaId, setSelectedPersonaId] = useState(currentPersonaId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const currentSelectionId = currentPersonaId ?? ''
  const personaManagementHref = buildPersonaManagementHref(
    `/dashboard/chats/${encodeURIComponent(chatId)}`,
  )

  const buttonClassName = asMenuItem
    ? 'w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2'
    : 'px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2'

  function handleOpen() {
    setError(null)
    setSelectedPersonaId(currentSelectionId)
    setIsOpen(true)
  }

  function handleClose() {
    setIsOpen(false)
    setError(null)
  }

  function handleSelectPersona() {
    setError(null)

    startTransition(async () => {
      const result = await updateChatPersona(chatId, selectedPersonaId || null)

      if (result.error) {
        setError(result.error)
        return
      }

      handleClose()
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={buttonClassName}
        title={currentPersonaId ? 'Change persona' : 'Select persona'}
        role={asMenuItem ? 'menuitem' : undefined}
      >
        <svg
          className="w-5 h-5 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
        <span>{currentPersonaId ? 'Change Persona' : 'Select Persona'}</span>
        <span className="inline-flex max-w-[120px] items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          <span className="truncate">{currentPersonaName || 'Not set'}</span>
        </span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-persona-select-title"
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
              <div>
                <h3
                  id="chat-persona-select-title"
                  className="text-lg font-semibold text-gray-900 dark:text-white"
                >
                  {currentPersonaId ? 'Change Persona' : 'Select Persona'}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select the persona to use for future responses in this chat.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close persona selection"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                  {error}
                </div>
              ) : null}

              <div>
                <p className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  My Personas
                </p>
                <div className="grid gap-2">
                  <button
                    type="button"
                    aria-pressed={selectedPersonaId === ''}
                    onClick={() => setSelectedPersonaId('')}
                    className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      selectedPersonaId === ''
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="font-medium text-gray-900 dark:text-white">No persona</span>
                    {selectedPersonaId === '' ? (
                      <svg
                        className="h-5 w-5 text-blue-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : null}
                  </button>
                  {availablePersonas.map((persona) => (
                    <button
                      key={persona.id}
                      type="button"
                      aria-pressed={selectedPersonaId === persona.id}
                      onClick={() => setSelectedPersonaId(persona.id)}
                      className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                        selectedPersonaId === persona.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {persona.name}
                      </span>
                      {selectedPersonaId === persona.id ? (
                        <svg
                          className="h-5 w-5 text-blue-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : null}
                    </button>
                  ))}
                </div>
                {availablePersonas.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    No personas created yet.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-6 text-sm dark:border-gray-700">
              <div>
                <p className="text-gray-500 dark:text-gray-400">
                  The saved choice applies to future responses in this chat.
                </p>
                <Link href={personaManagementHref} className="text-blue-500 hover:underline">
                  Manage personas
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg px-4 py-2 font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSelectPersona}
                  disabled={isPending || selectedPersonaId === currentSelectionId}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isPending ? 'Processing...' : 'Confirm Selection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
