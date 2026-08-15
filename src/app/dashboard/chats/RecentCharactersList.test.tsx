// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecentConversationCharacter } from '@/lib/chat/recent-character-types'
import RecentCharactersList from './RecentCharactersList'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={alt} {...props} />
  ),
}))

const referenceTimeMs = Date.parse('2026-08-15T12:00:00.000Z')

function createCharacter(
  id: string,
  overrides: Partial<RecentConversationCharacter> = {},
): RecentConversationCharacter {
  return {
    characterId: id,
    characterName: `Character ${id}`,
    avatarUrl: null,
    lastMessageAt: '2026-08-15T10:00:00.000Z',
    latestChatId: `chat-${id}`,
    latestChatTitle: `Chat ${id}`,
    preview: { role: 'assistant', content: `Hello from ${id}` },
    ...overrides,
  }
}

function createFetchResponse(body: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  }
}

describe('RecentCharactersList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders an accessible character link, exact time, and safe text preview', () => {
    render(
      <RecentCharactersList
        initialCharacters={[
          createCharacter('one', {
            characterName: 'Guide',
            preview: { role: 'assistant', content: '<b>Hello</b>\nthere' },
          }),
        ]}
        initialHasMore={false}
        initialNextCursor={null}
        referenceTimeMs={referenceTimeMs}
      />,
    )

    const link = screen.getByRole('link', { name: /Guide/ })
    const destination = new URL(link.getAttribute('href')!, 'https://rebel-ai.local')
    expect(destination.pathname).toBe('/dashboard/characters/one')
    expect(destination.searchParams.get('returnTo')).toBe('/dashboard/chats')
    expect(screen.getByText('Guide: <b>Hello</b> there')).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()

    const time = screen.getByText('2 hours ago')
    expect(time.getAttribute('datetime')).toBe('2026-08-15T10:00:00.000Z')
    expect(time.getAttribute('title')).toBe('2026-08-15T10:00:00.000Z')
  })

  it('appends one page, deduplicates characters, and guards repeated clicks', async () => {
    let resolveRequest: ((value: ReturnType<typeof createFetchResponse>) => void) | undefined
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }) as never,
    )

    render(
      <RecentCharactersList
        initialCharacters={[createCharacter('one')]}
        initialHasMore
        initialNextCursor="cursor-1"
        referenceTimeMs={referenceTimeMs}
      />,
    )

    const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
    fireEvent.click(loadMoreButton)
    fireEvent.click(loadMoreButton)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chats/recent-characters?cursor=cursor-1&limit=15',
      { headers: { Accept: 'application/json' } },
    )

    resolveRequest?.(
      createFetchResponse({
        characters: [createCharacter('one'), createCharacter('two')],
        hasMore: false,
        nextCursor: null,
      }),
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Character two/ })).toBeTruthy()
    })
    expect(screen.getAllByRole('link', { name: /Character one/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(screen.getByText('End of recent conversations')).toBeTruthy()
  })

  it('shows a retry state and recovers after a failed page request', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(createFetchResponse({}, false) as never).mockResolvedValueOnce(
      createFetchResponse({
        characters: [createCharacter('two')],
        hasMore: false,
        nextCursor: null,
      }) as never,
    )

    render(
      <RecentCharactersList
        initialCharacters={[createCharacter('one')]}
        initialHasMore
        initialNextCursor="cursor-1"
        referenceTimeMs={referenceTimeMs}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'More recent conversations could not be loaded.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Character two/ })).toBeTruthy()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders an empty state with a character-picker link', () => {
    render(
      <RecentCharactersList
        initialCharacters={[]}
        initialHasMore={false}
        initialNextCursor={null}
        referenceTimeMs={referenceTimeMs}
      />,
    )

    expect(screen.getByText('No recent conversations yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Choose a character' }).getAttribute('href')).toBe(
      '/dashboard/characters',
    )
  })
})
