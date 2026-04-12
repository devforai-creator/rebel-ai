'use client'

import { memo } from 'react'
import type { ChatCharacter } from '../utils'
import { AssistantAvatar } from './AssistantAvatar'

interface TypingIndicatorProps {
  character: ChatCharacter
}

export const TypingIndicator = memo(function TypingIndicator({ character }: TypingIndicatorProps) {
  return (
    <div className="flex justify-start gap-2">
      <AssistantAvatar character={character} />
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
        <div className="flex items-center gap-2">
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
      </div>
    </div>
  )
})
