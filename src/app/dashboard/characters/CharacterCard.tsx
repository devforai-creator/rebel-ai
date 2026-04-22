'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import type { Character } from '@/types/database.types'
import { deleteCharacter } from './actions'
import { runCharacterDelete } from './character-ui-logic'

export type CharacterListItem = Pick<
  Character,
  'id' | 'name' | 'created_at' | 'visibility' | 'avatar_url'
>

interface Props {
  character: CharacterListItem
  isStarter?: boolean
}

export default function CharacterCard({ character, isStarter = false }: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  async function handleDelete() {
    setIsConfirmOpen(true)
  }

  async function confirmDelete() {
    const shouldDelete = isConfirmOpen
    setIsConfirmOpen(false)

    await runConfirmedAction(shouldDelete ? character.id : null, async (characterId) => {
      setDeleting(true)
      const result = await runCharacterDelete({
        characterId,
        deleteCharacterImpl: deleteCharacter,
      })

      if (result?.error) {
        toast.error(result.error)
        setDeleting(false)
        return
      }

      if (result && 'warning' in result && result.warning) {
        toast(result.warning)
      }

      router.refresh()
    })
  }

  return (
    <>
      <SurfaceCard padding="none" className="overflow-hidden transition-shadow hover:shadow-lg">
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
            <Button
              onClick={handleDelete}
              disabled={deleting}
              variant="ghostDestructive"
              fullWidth
              className="border border-red-300 dark:border-red-800"
            >
              {deleting ? '...' : 'Delete'}
            </Button>
          </div>
        )}
      </SurfaceCard>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete "${character.name}"?`}
        description="This permanently deletes the character and any linked assets."
        confirmLabel="Delete character"
        isConfirming={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setIsConfirmOpen(false)}
      />
    </>
  )
}
