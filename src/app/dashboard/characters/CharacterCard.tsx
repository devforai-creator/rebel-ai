'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Character } from '@/types/database.types'
import { deleteCharacter } from './actions'

export type CharacterListItem = Pick<
  Character,
  'id' | 'name' | 'created_at' | 'visibility' | 'avatar_url'
>

interface Props {
  character: CharacterListItem
  isStarter?: boolean
}

export default function CharacterCard({ character, isStarter = false }: Props) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Are you sure you want to delete '${character.name}'?`)) {
      return
    }

    setDeleting(true)
    await deleteCharacter(character.id)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-shadow">
      {/* 캐릭터 헤더 (클릭 가능) */}
      <Link
        href={`/dashboard/characters/${character.id}`}
        className="block p-6 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-start gap-4 mb-4">
          {/* 아바타 */}
          {character.avatar_url ? (
            <Image
              src={character.avatar_url}
              alt={character.name}
              width={64}
              height={64}
              className="w-16 h-16 rounded-full object-cover flex-shrink-0 border-2 border-gray-200 dark:border-gray-600"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center flex-shrink-0 border-2 border-gray-200 dark:border-gray-600">
              <span className="text-white text-xl font-bold">
                {character.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}

          {/* 캐릭터 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {character.name}
              </h3>
              {isStarter && (
                <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded-full flex-shrink-0">
                  Starter
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Meta Info */}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Created: {new Date(character.created_at).toLocaleDateString()}</span>
          <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
            {character.visibility}
          </span>
        </div>
      </Link>

      {/* Delete Button */}
      {!isStarter && (
        <div className="px-6 pb-6">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-full py-2 px-4 border border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {deleting ? '...' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}
