// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DashboardPage from './page'

const { createClientMock, redirectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
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

vi.mock('../auth/actions', () => ({ logout: vi.fn() }))
vi.mock('./QuickStartGuide', () => ({ default: () => null }))
vi.mock('./SecurityNoticeBanner', () => ({ default: () => null }))
vi.mock('./AnnouncementBanner', () => ({ default: () => null }))
vi.mock('./FeedbackBox', () => ({ default: () => null }))

function createSupabase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'owner@example.com' } },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { display_name: 'Owner', is_admin: false },
            error: null,
          }),
        })),
      })),
    })),
  }
}

afterEach(() => {
  cleanup()
  createClientMock.mockReset()
  redirectMock.mockReset()
})

describe('DashboardPage recent conversations entry', () => {
  it('links to the recent page without changing the Start Chat destination', async () => {
    createClientMock.mockResolvedValue(createSupabase())

    render(await DashboardPage())

    expect(screen.getByRole('link', { name: /Recent Conversations/ }).getAttribute('href')).toBe(
      '/dashboard/chats',
    )
    expect(screen.getByRole('link', { name: /Start Chat/ }).getAttribute('href')).toBe(
      '/dashboard/characters',
    )
  })
})
