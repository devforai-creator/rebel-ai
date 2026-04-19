'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/app/dashboard/components/Button'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import {
  hasCustomSystemPromptOverride,
  normalizeSystemPromptOverride,
} from '@/lib/chat/system-prompt-override'

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
  const [value, setValue] = useState(
    normalizeSystemPromptOverride(initialPrompt, defaultPrompt) ?? defaultPrompt,
  )
  const [isSaving, setIsSaving] = useState(false)
  const [hasCustomPrompt, setHasCustomPrompt] = useState(
    hasCustomSystemPromptOverride(initialPrompt, defaultPrompt),
  )

  useEffect(() => {
    const normalizedInitialPrompt = normalizeSystemPromptOverride(initialPrompt, defaultPrompt)
    setValue(normalizedInitialPrompt ?? defaultPrompt)
    setHasCustomPrompt(hasCustomSystemPromptOverride(initialPrompt, defaultPrompt))
  }, [initialPrompt, defaultPrompt])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const body = {
        systemPrompt: normalizeSystemPromptOverride(value, defaultPrompt),
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
      setValue(body.systemPrompt ?? defaultPrompt)
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

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant={asMenuItem ? 'ghost' : hasCustomPrompt ? 'secondary' : 'ghost'}
        className={
          asMenuItem
            ? 'w-full justify-start px-4 text-left'
            : hasCustomPrompt
              ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
              : ''
        }
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
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <SurfaceCard
            padding="none"
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden shadow-xl"
          >
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
              <Button
                onClick={() => setIsOpen(false)}
                variant="ghost"
                size="icon"
                className="rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Button>
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
              <Button onClick={handleReset} variant="secondary" type="button">
                Reset to Default
              </Button>
              <div className="flex items-center gap-2">
                <Button onClick={() => setIsOpen(false)} variant="secondary" type="button">
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving} type="button">
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </SurfaceCard>
        </div>
      )}
    </>
  )
}
