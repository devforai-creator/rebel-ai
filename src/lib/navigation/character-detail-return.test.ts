import { describe, expect, it } from 'vitest'

import {
  buildRecentCharacterDetailHref,
  resolveCharacterDetailReturnDestination,
} from './character-detail-return'

describe('character detail return navigation', () => {
  it('builds a recent-conversation character link with an explicit return target', () => {
    const href = buildRecentCharacterDetailHref('character/one')
    const url = new URL(href, 'https://rebel-ai.local')

    expect(url.pathname).toBe('/dashboard/characters/character%2Fone')
    expect(url.searchParams.get('returnTo')).toBe('/dashboard/chats')
  })

  it('returns recent-conversation entries to the recent list', () => {
    expect(resolveCharacterDetailReturnDestination('/dashboard/chats')).toEqual({
      href: '/dashboard/chats',
      label: '← Recent Conversations',
    })
  })

  it.each([
    undefined,
    ['/dashboard/chats'],
    '/dashboard',
    '/dashboard/chats/chat-1',
    'https://example.com/dashboard/chats',
  ])('falls back to the character list for unsupported return target %j', (returnTo) => {
    expect(resolveCharacterDetailReturnDestination(returnTo)).toEqual({
      href: '/dashboard/characters',
      label: '← 캐릭터 목록',
    })
  })
})
