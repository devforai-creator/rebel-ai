'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/app/dashboard/components/Button'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import type { AgenticTranscriptRecallOverrideMode, ChatModelConfig } from '@/lib/chat/model-config'
import {
  buildAgenticTranscriptRecallOverrideModelConfigPatch,
  resolveAgenticTranscriptRecallOverrideMode,
} from '@/lib/chat/model-config'
import { updateChatModelConfig } from './actions'

interface ChatSettingsButtonProps {
  chatId: string
  initialModelConfig: ChatModelConfig | null
  accountAgenticTranscriptRecallDefaultEnabled: boolean
}

function formatAgenticTranscriptRecallBadge(
  mode: AgenticTranscriptRecallOverrideMode,
  accountDefaultEnabled: boolean,
) {
  if (mode === 'inherit') {
    return accountDefaultEnabled ? 'ATR Default On' : 'ATR Default Off'
  }

  return mode === 'enabled' ? 'ATR On' : 'ATR Off'
}

export default function ChatSettingsButton({
  chatId,
  initialModelConfig,
  accountAgenticTranscriptRecallDefaultEnabled,
}: ChatSettingsButtonProps) {
  const router = useRouter()
  const resolvedInitialMode = useMemo(
    () => resolveAgenticTranscriptRecallOverrideMode(initialModelConfig),
    [initialModelConfig],
  )
  const [isOpen, setIsOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [currentMode, setCurrentMode] =
    useState<AgenticTranscriptRecallOverrideMode>(resolvedInitialMode)
  const [selectedMode, setSelectedMode] =
    useState<AgenticTranscriptRecallOverrideMode>(resolvedInitialMode)

  useEffect(() => {
    setCurrentMode(resolvedInitialMode)
    setSelectedMode(resolvedInitialMode)
  }, [resolvedInitialMode])

  const badgeLabel = formatAgenticTranscriptRecallBadge(
    currentMode,
    accountAgenticTranscriptRecallDefaultEnabled,
  )
  const isDirty = selectedMode !== currentMode

  const handleOpen = () => {
    setSelectedMode(currentMode)
    setIsOpen(true)
  }

  const handleSave = async () => {
    if (!isDirty) {
      setIsOpen(false)
      return
    }

    setIsSaving(true)

    try {
      const result = await updateChatModelConfig(
        chatId,
        buildAgenticTranscriptRecallOverrideModelConfigPatch(initialModelConfig, selectedMode),
      )

      if (result?.error) {
        toast.error(result.error)
        return
      }

      setCurrentMode(selectedMode)
      setIsOpen(false)
      router.refresh()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <Button onClick={handleOpen} variant="secondary" size="sm" className="gap-2">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317a1 1 0 011.35-.936l.794.35a1 1 0 00.822 0l.794-.35a1 1 0 011.35.936l.088.864a1 1 0 00.5.783l.74.427a1 1 0 01.365 1.366l-.426.74a1 1 0 000 .822l.426.74a1 1 0 01-.365 1.366l-.74.427a1 1 0 00-.5.783l-.088.864a1 1 0 01-1.35.936l-.794-.35a1 1 0 00-.822 0l-.794.35a1 1 0 01-1.35-.936l-.088-.864a1 1 0 00-.5-.783l-.74-.427a1 1 0 01-.365-1.366l.426-.74a1 1 0 000-.822l-.426-.74a1 1 0 01.365-1.366l.74-.427a1 1 0 00.5-.783l.088-.864z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15a3 3 0 100-6 3 3 0 000 6z"
          />
        </svg>
        <span>Settings</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {badgeLabel}
        </span>
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <SurfaceCard
            padding="none"
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Chat Settings
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Chat-specific overrides live here so the live controls bar can stay focused on
                  sending and usage.
                </p>
              </div>
              <Button
                onClick={() => setIsOpen(false)}
                variant="ghost"
                size="icon"
                className="rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Button>
            </div>

            <div className="space-y-4 p-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Agentic Transcript Recall
                </h4>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Choose whether this chat inherits the account default or forces its own ATR
                  behavior.
                </p>
              </div>

              <div className="space-y-3">
                {(
                  [
                    {
                      mode: 'inherit',
                      title: 'Use account default',
                      description: `Currently ${
                        accountAgenticTranscriptRecallDefaultEnabled ? 'enabled' : 'disabled'
                      } for inherited chats.`,
                    },
                    {
                      mode: 'enabled',
                      title: 'Always on for this chat',
                      description: 'Store an explicit per-chat ATR override with enabled: true.',
                    },
                    {
                      mode: 'disabled',
                      title: 'Always off for this chat',
                      description: 'Store an explicit per-chat ATR override with enabled: false.',
                    },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.mode}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                      selectedMode === option.mode
                        ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                    }`}
                  >
                    <input
                      type="radio"
                      name="agentic-transcript-recall-mode"
                      value={option.mode}
                      checked={selectedMode === option.mode}
                      onChange={() => setSelectedMode(option.mode)}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {option.title}
                      </div>
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {option.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Existing explicit ATR rows stay explicit until you reset them to the account
                default.
              </p>
              <div className="flex items-center gap-2">
                <Button onClick={() => setIsOpen(false)} variant="secondary" disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={() => void handleSave()} disabled={isSaving || !isDirty}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </SurfaceCard>
        </div>
      ) : null}
    </>
  )
}
