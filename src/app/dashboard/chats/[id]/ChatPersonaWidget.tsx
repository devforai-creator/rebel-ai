'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateChatPersona } from './actions'

interface PersonaOption {
  id: string
  name: string
}

interface Props {
  chatId: string
  personaId: string | null
  initialName: string | null
  initialDescription: string | null
  availablePersonas: PersonaOption[]
  asMenuItem?: boolean
}

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 5000

export default function ChatPersonaWidget({
  chatId,
  personaId,
  initialName,
  initialDescription,
  availablePersonas,
  asMenuItem = false,
}: Props) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  // Editor State
  const [name, setName] = useState(initialName || '')
  const [description, setDescription] = useState(initialDescription || '')

  // Selector State
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(initialName || '')
    setDescription(initialDescription || '')
  }, [initialName, initialDescription])

  const handleOpen = () => {
    setError(null)
    setName(initialName || '')
    setDescription(initialDescription || '')
    setSelectedPersonaId('')
    setIsOpen(true)
  }

  const handleClose = () => {
    setIsOpen(false)
    setError(null)
  }

  // Scenario A: Update existing persona details
  const handleSaveDetails = async () => {
    if (!personaId) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Please enter a persona name.')
      return
    }

    if (trimmedName.length > MAX_NAME_LENGTH) {
      setError(`Name must be ${MAX_NAME_LENGTH} characters or less.`)
      return
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      setError(`Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/personas/${personaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.length > 0 ? description : null,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const message = data?.error || 'Failed to save persona.'
        throw new Error(message)
      }

      handleClose()
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save persona.'
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  // Scenario B: Select a persona for the chat
  const handleSelectPersona = async () => {
    if (!selectedPersonaId) {
      setError('Please select a persona.')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const result = await updateChatPersona(chatId, selectedPersonaId)
      if (result.error) {
        throw new Error(result.error)
      }

      handleClose()
      // No need to router.refresh() here if the server action calls revalidatePath
      // But let's do it just in case or rely on the action
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect persona.'
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  const buttonClassName = asMenuItem
    ? 'w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2'
    : 'px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2'

  // Render Button
  const renderTriggerButton = () => {
    if (personaId) {
      // Edit Mode Button
      return (
        <button
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
            <span className="truncate">{name || 'Persona'}</span>
          </span>
        </button>
      )
    } else {
      // Select Mode Button
      return (
        <button
          onClick={handleOpen}
          className={buttonClassName}
          title="Select persona"
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
          <span>Select Persona</span>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            Not set
          </span>
        </button>
      )
    }
  }

  return (
    <>
      {renderTriggerButton()}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {personaId ? 'Edit Persona' : 'Select Persona'}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {personaId
                    ? 'Write freely including markdown. Changes will be reflected in all chats using this persona.'
                    : 'Select a persona to use in this chat room.'}
                </p>
              </div>
              <button
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
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                  {error}
                </div>
              )}

              {personaId ? (
                // Edit Mode UI
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Persona Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={MAX_NAME_LENGTH}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {name.length}/{MAX_NAME_LENGTH}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Persona Content (Markdown supported)
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {description.length}/{MAX_DESCRIPTION_LENGTH}
                      </p>
                    </div>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={MAX_DESCRIPTION_LENGTH}
                      rows={10}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      placeholder="Freely write name, age, appearance, speech style, background, rules, etc."
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Limit: {MAX_DESCRIPTION_LENGTH} chars. If empty, only the name will be used.
                    </p>
                  </div>
                </>
              ) : (
                // Select Mode UI
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    My Personas
                  </label>
                  {availablePersonas.length > 0 ? (
                    <div className="grid gap-2">
                      {availablePersonas.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPersonaId(p.id)}
                          className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                            selectedPersonaId === p.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                          }`}
                        >
                          <span className="font-medium text-gray-900 dark:text-white">
                            {p.name}
                          </span>
                          {selectedPersonaId === p.id && (
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
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      <p>No personas created.</p>
                      <a
                        href="/dashboard/personas"
                        className="mt-2 inline-block text-blue-500 hover:underline"
                      >
                        Create new in Persona Management
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-6 text-sm dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">
                {personaId
                  ? 'Saving will apply the new values to all chats referencing this persona.'
                  : 'The selected persona will be connected to this chat room.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClose}
                  className="rounded-lg px-4 py-2 font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  type="button"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={personaId ? handleSaveDetails : handleSelectPersona}
                  disabled={isSaving || (!personaId && !selectedPersonaId)}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  type="button"
                >
                  {isSaving ? 'Processing...' : personaId ? 'Save' : 'Confirm Selection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
