'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Props {
  chatId: string
  initialPrompt: string | null
  defaultPrompt: string
  asMenuItem?: boolean
}

export default function SystemPromptEditorButton({
  chatId,
  initialPrompt,
  defaultPrompt,
  asMenuItem = false,
}: Props) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [value, setValue] = useState(initialPrompt ?? defaultPrompt)
  const [isSaving, setIsSaving] = useState(false)
  const [hasCustomPrompt, setHasCustomPrompt] = useState(Boolean(initialPrompt))

  useEffect(() => {
    setValue(initialPrompt ?? defaultPrompt)
    setHasCustomPrompt(Boolean(initialPrompt))
  }, [initialPrompt, defaultPrompt])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const trimmed = value.trim()
      const body = {
        systemPrompt: trimmed.length === 0 || trimmed === defaultPrompt.trim() ? null : trimmed,
      }

      const response = await fetch(`/api/chats/${chatId}/system-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error('Failed to update system prompt')
      }

      setHasCustomPrompt(body.systemPrompt !== null)
      setIsOpen(false)
      router.refresh()
    } catch (error) {
      console.error('Failed to save system prompt', error)
      toast.error('Failed to save system prompt.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setValue(defaultPrompt)
  }

  const buttonClassName = asMenuItem
    ? 'w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2'
    : `px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
        hasCustomPrompt
          ? 'text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-200 border border-blue-200 dark:border-blue-700'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={buttonClassName}
        title="Edit system prompt"
        role={asMenuItem ? 'menuitem' : undefined}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.414 2.586a2 2 0 112.828 2.828L12 14l-4 1 1-4 9.414-9.414z"
          />
        </svg>
        <span>System Prompt</span>
        {hasCustomPrompt && (
          <span className="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
            Custom
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Edit System Prompt
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  This text is sent to the model before the character prompt. Saving an empty value
                  will use the default global setting.
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                rows={16}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-4 text-sm font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="text-xs text-gray-500 dark:text-gray-400">
                - Click &quot;Reset to Default&quot; below to restore the default value.
                <br />- Custom prompts only apply to the current chat.
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                type="button"
              >
                Reset to Default
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                  type="button"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
