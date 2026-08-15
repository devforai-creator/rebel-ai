'use client'

import Image from 'next/image'
import Link from 'next/link'
import React, { useRef, useState } from 'react'

import Button, { buttonClassName } from '@/app/dashboard/components/Button'
import EmptyState from '@/app/dashboard/components/EmptyState'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import {
  RECENT_CHARACTER_DEFAULT_PAGE_SIZE,
  type RecentConversationCharacter,
  type RecentConversationCharactersPage,
} from '@/lib/chat/recent-character-types'
import { buildRecentCharacterDetailHref } from '@/lib/navigation/character-detail-return'
import {
  formatRecentCharacterPreview,
  formatRecentCharacterRelativeTime,
} from './recent-character-formatters'

type RecentCharactersListProps = {
  initialCharacters: RecentConversationCharacter[]
  initialHasMore: boolean
  initialNextCursor: string | null
  referenceTimeMs: number
}

function isRecentConversationCharacter(value: unknown): value is RecentConversationCharacter {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const character = value as Partial<RecentConversationCharacter>
  const previewIsValid =
    character.preview === null ||
    (typeof character.preview === 'object' &&
      character.preview !== null &&
      (character.preview.role === 'user' || character.preview.role === 'assistant') &&
      typeof character.preview.content === 'string')

  return (
    typeof character.characterId === 'string' &&
    typeof character.characterName === 'string' &&
    (typeof character.avatarUrl === 'string' || character.avatarUrl === null) &&
    typeof character.lastMessageAt === 'string' &&
    typeof character.latestChatId === 'string' &&
    (typeof character.latestChatTitle === 'string' || character.latestChatTitle === null) &&
    previewIsValid
  )
}

function isRecentConversationCharactersPage(
  value: unknown,
): value is RecentConversationCharactersPage {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const page = value as Partial<RecentConversationCharactersPage>
  return (
    Array.isArray(page.characters) &&
    page.characters.every(isRecentConversationCharacter) &&
    typeof page.hasMore === 'boolean' &&
    (typeof page.nextCursor === 'string' || page.nextCursor === null)
  )
}

async function fetchRecentCharactersPage(
  cursor: string,
): Promise<RecentConversationCharactersPage> {
  const searchParams = new URLSearchParams({
    cursor,
    limit: String(RECENT_CHARACTER_DEFAULT_PAGE_SIZE),
  })
  const response = await fetch(`/api/chats/recent-characters?${searchParams.toString()}`, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Recent characters request failed')
  }

  const data: unknown = await response.json()
  if (!isRecentConversationCharactersPage(data)) {
    throw new Error('Recent characters response was invalid')
  }

  return data
}

export default function RecentCharactersList({
  initialCharacters,
  initialHasMore,
  initialNextCursor,
  referenceTimeMs,
}: RecentCharactersListProps) {
  const [characters, setCharacters] = useState(initialCharacters)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestInFlightRef = useRef(false)

  async function loadMore() {
    if (requestInFlightRef.current || !hasMore || !nextCursor) {
      return
    }

    requestInFlightRef.current = true
    setIsLoading(true)
    setLoadError(null)

    try {
      const page = await fetchRecentCharactersPage(nextCursor)
      setCharacters((currentCharacters) => {
        const seenCharacterIds = new Set(
          currentCharacters.map((character) => character.characterId),
        )
        const mergedCharacters = [...currentCharacters]

        for (const character of page.characters) {
          if (seenCharacterIds.has(character.characterId)) {
            continue
          }
          seenCharacterIds.add(character.characterId)
          mergedCharacters.push(character)
        }

        return mergedCharacters
      })
      setHasMore(page.hasMore)
      setNextCursor(page.nextCursor)
    } catch {
      setLoadError('More recent conversations could not be loaded.')
    } finally {
      requestInFlightRef.current = false
      setIsLoading(false)
    }
  }

  if (characters.length === 0) {
    return (
      <EmptyState
        title="No recent conversations yet"
        description="Start a chat and the character will appear here after the first message."
        action={
          <Link href="/dashboard/characters" className={buttonClassName()}>
            Choose a character
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3" aria-label="Recent conversation characters">
        {characters.map((character) => {
          const preview = character.preview
            ? `${character.preview.role === 'user' ? 'You' : character.characterName}: ${formatRecentCharacterPreview(character.preview.content)}`
            : 'No completed message preview'

          return (
            <li key={character.characterId}>
              <SurfaceCard padding="none" className="overflow-hidden">
                <Link
                  href={buildRecentCharacterDetailHref(character.characterId)}
                  prefetch={false}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-700/50 sm:p-5"
                >
                  {character.avatarUrl ? (
                    <Image
                      src={character.avatarUrl}
                      alt=""
                      width={56}
                      height={56}
                      className="h-14 w-14 flex-shrink-0 rounded-full border-2 border-gray-200 object-cover dark:border-gray-600"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-200 bg-gradient-to-br from-blue-400 to-purple-500 text-lg font-bold text-white dark:border-gray-600"
                    >
                      {character.characterName.charAt(0).toUpperCase() || '?'}
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <span className="truncate font-semibold text-gray-900 dark:text-white">
                        {character.characterName}
                      </span>
                      <time
                        dateTime={character.lastMessageAt}
                        title={character.lastMessageAt}
                        aria-label={`Last message: ${character.lastMessageAt}`}
                        className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400"
                      >
                        {formatRecentCharacterRelativeTime(
                          character.lastMessageAt,
                          referenceTimeMs,
                        )}
                      </time>
                    </span>
                    {character.latestChatTitle ? (
                      <span className="mt-1 block truncate text-sm text-gray-700 dark:text-gray-300">
                        {character.latestChatTitle}
                      </span>
                    ) : null}
                    <span className="mt-1 block truncate text-sm text-gray-500 dark:text-gray-400">
                      {preview}
                    </span>
                  </span>

                  <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
                    →
                  </span>
                </Link>
              </SurfaceCard>
            </li>
          )
        })}
      </ul>

      {loadError ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          <p>{loadError}</p>
          <Button variant="secondary" onClick={() => void loadMore()} disabled={isLoading}>
            {isLoading ? 'Trying again...' : 'Try again'}
          </Button>
        </div>
      ) : hasMore ? (
        <div className="flex justify-center">
          <Button onClick={() => void loadMore()} disabled={isLoading} variant="secondary">
            {isLoading ? 'Loading more...' : 'Load more'}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          End of recent conversations
        </p>
      )}
    </div>
  )
}
