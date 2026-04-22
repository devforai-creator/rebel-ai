'use client'

import { memo } from 'react'
import Image from 'next/image'
import type { ChatCharacter } from '../utils'

interface AssistantAvatarProps {
  character: ChatCharacter
}

export const AssistantAvatar = memo(function AssistantAvatar({ character }: AssistantAvatarProps) {
  return (
    <div className="flex-shrink-0">
      {character.avatar_url ? (
        <Image
          src={character.avatar_url}
          alt={character.name}
          width={32}
          height={32}
          className="h-8 w-8 rounded-full border border-gray-200 object-cover dark:border-gray-600"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-gradient-to-br from-blue-400 to-purple-500 dark:border-gray-600">
          <span className="text-sm font-bold text-white">
            {character.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  )
})
