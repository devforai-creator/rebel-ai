import { describe, expect, it } from 'vitest'
import { buildPersonaManagementHref, resolveDashboardReturnPath } from './dashboard-return'

describe('dashboard return paths', () => {
  it('preserves dashboard paths with query parameters and hashes', () => {
    expect(
      resolveDashboardReturnPath('/dashboard/chats/new?character=char-1&persona=persona-1#form'),
    ).toBe('/dashboard/chats/new?character=char-1&persona=persona-1#form')
  })

  it.each([
    'https://example.com/dashboard',
    '//example.com/dashboard',
    '/auth/login',
    'javascript:alert(1)',
  ])('falls back for unsafe return target %s', (value) => {
    expect(resolveDashboardReturnPath(value)).toBe('/dashboard')
  })

  it('encodes a validated return target in the persona management link', () => {
    const href = buildPersonaManagementHref(
      '/dashboard/chats/new?character=char-1&apiKey=key-1&greeting=2',
    )
    const url = new URL(href, 'https://rebel-ai.local')

    expect(url.pathname).toBe('/dashboard/personas')
    expect(url.searchParams.get('returnTo')).toBe(
      '/dashboard/chats/new?character=char-1&apiKey=key-1&greeting=2',
    )
  })
})
