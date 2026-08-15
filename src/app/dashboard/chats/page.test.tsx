// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RecentConversationsPage from './page'

const { createClientMock, loadRecentConversationCharactersMock, redirectMock, listPropsMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    loadRecentConversationCharactersMock: vi.fn(),
    redirectMock: vi.fn(),
    listPropsMock: vi.fn(),
  }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/chat/recent-characters', () => ({
  loadRecentConversationCharacters: loadRecentConversationCharactersMock,
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

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

vi.mock('./RecentCharactersList', () => ({
  default: (props: unknown) => {
    listPropsMock(props)
    return <div data-testid="recent-characters-list" />
  },
}))

afterEach(() => {
  cleanup()
  createClientMock.mockReset()
  loadRecentConversationCharactersMock.mockReset()
  redirectMock.mockReset()
  listPropsMock.mockReset()
})

describe('RecentConversationsPage', () => {
  it('authenticates and loads the first page directly through the shared loader', async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    }
    createClientMock.mockResolvedValue(supabase)
    loadRecentConversationCharactersMock.mockResolvedValue({
      characters: [],
      hasMore: false,
      nextCursor: null,
    })

    render(await RecentConversationsPage())

    expect(loadRecentConversationCharactersMock).toHaveBeenCalledWith({ supabase })
    expect(screen.getByRole('heading', { name: 'Recent Conversations' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '← Dashboard' }).getAttribute('href')).toBe(
      '/dashboard',
    )
    expect(screen.getByTestId('recent-characters-list')).toBeTruthy()
    expect(listPropsMock).toHaveBeenCalledWith({
      initialCharacters: [],
      initialHasMore: false,
      initialNextCursor: null,
      referenceTimeMs: expect.any(Number),
    })
  })

  it('redirects signed-out users before loading conversations', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    })
    redirectMock.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })

    await expect(RecentConversationsPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/auth/login')
    expect(loadRecentConversationCharactersMock).not.toHaveBeenCalled()
  })
})
