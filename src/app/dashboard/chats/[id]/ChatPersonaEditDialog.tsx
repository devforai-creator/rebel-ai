'use client'

import React from 'react'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updatePersona } from '@/app/dashboard/personas/actions'
import { MAX_PERSONA_DESCRIPTION_LENGTH, MAX_PERSONA_NAME_LENGTH } from '@/lib/personas/constants'

interface ChatPersonaEditDialogProps {
  personaId: string
  initialName: string | null
  initialDescription: string | null
  asMenuItem?: boolean
}

const NAME_INPUT_ID = 'chat-persona-name'
const DESCRIPTION_INPUT_ID = 'chat-persona-description'

export default function ChatPersonaEditDialog({
  personaId,
  initialName,
  initialDescription,
  asMenuItem = false,
}: ChatPersonaEditDialogProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState(initialName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setName(initialName ?? '')
    setDescription(initialDescription ?? '')
  }, [initialDescription, initialName])

  const buttonClassName = asMenuItem
    ? 'w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2'
    : 'px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2'

  function handleOpen() {
    setError(null)
    setName(initialName ?? '')
    setDescription(initialDescription ?? '')
    setIsOpen(true)
  }

  function handleClose() {
    setIsOpen(false)
    setError(null)
  }

  function handleSave() {
    setError(null)

    startTransition(async () => {
      const result = await updatePersona(personaId, {
        name,
        description: description || null,
      })

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
        title="Edit persona"
        role={asMenuItem ? 'menuitem' : undefined}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.232 5.232a2.5 2.5 0 113.536 3.536L9.5 18.036 6 19l.964-3.5 8.268-10.268z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 7.5l3 3" />
        </svg>
        <span>Edit Persona</span>
        <span className="inline-flex max-w-[120px] items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800 dark:bg-purple-900/30 dark:text-purple-200">
          <span className="truncate">{initialName || 'Persona'}</span>
        </span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-persona-edit-title"
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
              <div>
                <h3
                  id="chat-persona-edit-title"
                  className="text-lg font-semibold text-gray-900 dark:text-white"
                >
                  Edit Persona
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Write freely including markdown. Changes will be reflected in all chats using this
                  persona.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
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
                <label
                  htmlFor={NAME_INPUT_ID}
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Persona Name
                </label>
                <input
                  id={NAME_INPUT_ID}
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={MAX_PERSONA_NAME_LENGTH}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {name.length}/{MAX_PERSONA_NAME_LENGTH}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={DESCRIPTION_INPUT_ID}
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Persona Content (Markdown supported)
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {description.length}/{MAX_PERSONA_DESCRIPTION_LENGTH}
                  </p>
                </div>
                <textarea
                  id={DESCRIPTION_INPUT_ID}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={MAX_PERSONA_DESCRIPTION_LENGTH}
                  rows={10}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  placeholder="Freely write name, age, appearance, speech style, background, rules, etc."
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Limit: {MAX_PERSONA_DESCRIPTION_LENGTH} chars. If empty, only the name will be
                  used.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-6 text-sm dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">
                Saving will apply the new values to all chats referencing this persona.
              </p>
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
                  onClick={handleSave}
                  disabled={isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
