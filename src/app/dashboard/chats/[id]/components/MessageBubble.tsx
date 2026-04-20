'use client'

import React, { useMemo, type ReactNode } from 'react'
import type {
  ChatCharacter,
  DisplayMessage,
  InlineUiCardRegistry,
  ModuleRegexEntry,
} from '../utils'
import { renderMessageContent } from '../utils'
import type { CharacterAsset } from '@/lib/asset-resolver'

interface MessageBubbleProps {
  message: DisplayMessage
  character: ChatCharacter
  characterAssets: CharacterAsset[]
  assetUrlMap?: Record<string, string>
  imageCommandUrlMap?: Record<string, string>
  moduleRegex?: ModuleRegexEntry[]
  defaultVariables?: Record<string, unknown>
  uiCard?: Record<string, unknown> | null
  uiCardRegistry?: InlineUiCardRegistry | null
  onUiCardAction?: (type: string, actionId: string, payload?: unknown) => void
  imageDisplay?: Record<string, unknown> | null
  isLatestAssistant: boolean
  isReprocessing: boolean
  isRetranslating: boolean
}

function renderBusyOverlay(label: string, accentClassName: string): ReactNode {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70 dark:bg-gray-800/70">
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <div
          className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${accentClassName}`}
        />
        {label}
      </div>
    </div>
  )
}

function resolveBubbleClassName(role: DisplayMessage['role']): string {
  if (role === 'user') {
    return 'bg-blue-600 text-white'
  }

  if (role === 'system') {
    return 'border border-red-200 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200'
  }

  return 'border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
}

export function MessageBubble({
  message,
  character,
  characterAssets,
  assetUrlMap,
  imageCommandUrlMap,
  moduleRegex,
  defaultVariables,
  uiCard,
  uiCardRegistry,
  onUiCardAction,
  imageDisplay,
  isLatestAssistant,
  isReprocessing,
  isRetranslating,
}: MessageBubbleProps) {
  const isAssistant = message.role === 'assistant'
  const isStreaming = message.streaming === true
  const bubbleClassName = resolveBubbleClassName(message.role)

  const renderedContent = useMemo(() => {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1024

    return renderMessageContent(
      message.content,
      characterAssets,
      assetUrlMap,
      imageCommandUrlMap,
      moduleRegex,
      screenWidth,
      defaultVariables,
      character.name,
      message.id,
      undefined,
      undefined,
      isAssistant ? uiCard : null,
      isAssistant ? uiCardRegistry : null,
      isAssistant ? onUiCardAction : undefined,
      isLatestAssistant,
      imageDisplay,
    )
  }, [
    assetUrlMap,
    character.name,
    characterAssets,
    defaultVariables,
    imageCommandUrlMap,
    imageDisplay,
    isAssistant,
    isLatestAssistant,
    message.content,
    message.id,
    moduleRegex,
    onUiCardAction,
    uiCard,
    uiCardRegistry,
  ])

  return (
    <div
      className={`msg-${message.id} relative min-w-0 max-w-full rounded-lg px-4 py-2 ${bubbleClassName}`}
    >
      {isReprocessing ? renderBusyOverlay('Reprocessing...', 'border-orange-500') : null}
      {isRetranslating ? renderBusyOverlay('Translating...', 'border-cyan-500') : null}
      <div className="max-w-full overflow-x-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] [&_img]:block [&_img]:h-auto [&_img]:max-w-full">
        {isStreaming && !message.content ? (
          <div className="flex items-center gap-2 py-1">
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
              style={{ animationDelay: '0.2s' }}
            />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
              style={{ animationDelay: '0.4s' }}
            />
          </div>
        ) : (
          <>
            {renderedContent}
            {isStreaming ? (
              <span className="ml-1 inline-block h-4 w-2 animate-pulse align-middle bg-current/60" />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
