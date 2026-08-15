// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CharacterDetailPage from './page'

const {
  createAdminClientMock,
  createClientMock,
  detailContentPropsMock,
  redirectMock,
  resolveAvatarMock,
  singleMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  detailContentPropsMock: vi.fn(),
  redirectMock: vi.fn(),
  resolveAvatarMock: vi.fn(),
  singleMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/lib/assets/character-avatar', () => ({
  resolveSingleCharacterAvatarUrl: resolveAvatarMock,
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

vi.mock('./CharacterDetailContent', () => ({
  default: (props: unknown) => {
    detailContentPropsMock(props)
    return <div data-testid="character-detail-content" />
  },
}))

beforeEach(() => {
  const characterQuery = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        or: vi.fn(() => ({
          is: vi.fn(() => ({ single: singleMock })),
        })),
      })),
    })),
  }
  createClientMock.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn(() => characterQuery),
  })
  createAdminClientMock.mockReturnValue({})
  singleMock.mockResolvedValue({
    data: {
      id: 'char-1',
      user_id: 'user-1',
      name: 'Guide',
      description: null,
      system_prompt: 'Guide the user',
      greeting_message: null,
      avatar_url: null,
      visibility: 'private',
      created_at: '2026-08-15T00:00:00.000Z',
    },
    error: null,
  })
  resolveAvatarMock.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CharacterDetailPage return navigation', () => {
  it('returns to Recent Conversations when that page supplied the entry context', async () => {
    render(
      await CharacterDetailPage({
        params: Promise.resolve({ id: 'char-1' }),
        searchParams: Promise.resolve({ returnTo: '/dashboard/chats' }),
      }),
    )

    expect(screen.getByRole('link', { name: '← Recent Conversations' }).getAttribute('href')).toBe(
      '/dashboard/chats',
    )
    expect(screen.getByTestId('character-detail-content')).toBeTruthy()
  })

  it('preserves the character-list fallback for direct or existing entry paths', async () => {
    render(
      await CharacterDetailPage({
        params: Promise.resolve({ id: 'char-1' }),
        searchParams: Promise.resolve({}),
      }),
    )

    expect(screen.getByRole('link', { name: '← 캐릭터 목록' }).getAttribute('href')).toBe(
      '/dashboard/characters',
    )
  })
})
