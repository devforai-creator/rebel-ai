import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from '@/lib/security/content-security-policy'

describe('CSP invariants', () => {
  type NextConfigShape = {
    headers: () => Promise<
      Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    >
    poweredByHeader?: boolean
  }

  const TEST_NONCE = 'dGVzdC1ub25jZQ=='

  function getCSP({
    nonce = TEST_NONCE,
    isDevelopment = false,
    supabaseUrl = 'https://project-ref.supabase.co',
  }: {
    nonce?: string
    isDevelopment?: boolean
    supabaseUrl?: string
  } = {}): string {
    return buildContentSecurityPolicy({ nonce, isDevelopment, supabaseUrl })
  }

  function getDirective(csp: string, name: string): string {
    const directive = csp.split('; ').find((part) => part.startsWith(`${name} `))
    if (!directive) {
      throw new Error(`${name} directive not found in CSP`)
    }
    return directive
  }

  async function getNextConfig(): Promise<NextConfigShape> {
    const configModule = await import('../../next.config.js')
    return (configModule.default ?? configModule) as NextConfigShape
  }

  it('does not define a conflicting static CSP in next.config.js', async () => {
    const config = await getNextConfig()
    const headerSets = await config.headers()
    const cspHeaders = headerSets.flatMap((headerSet) =>
      headerSet.headers.filter((header) => header.key === 'Content-Security-Policy'),
    )

    expect(cspHeaders).toEqual([])
  })

  it('disables the Next.js powered-by response header', async () => {
    const config = await getNextConfig()

    expect(config.poweredByHeader).toBe(false)
  })

  it('restricts app resources to same-origin embedding', async () => {
    const config = await getNextConfig()
    const headerSets = await config.headers()
    const globalHeaders = headerSets.find((headerSet) => headerSet.source === '/(.*)')?.headers

    expect(globalHeaders).toContainEqual({
      key: 'Cross-Origin-Resource-Policy',
      value: 'same-origin',
    })
  })

  it('uses a nonce and strict-dynamic instead of unsafe-inline in production', () => {
    const csp = getCSP()

    expect(getDirective(csp, 'script-src')).toBe(
      `script-src 'self' 'nonce-${TEST_NONCE}' 'strict-dynamic'`,
    )
    expect(getDirective(csp, 'script-src')).not.toContain("'unsafe-inline'")
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('allows unsafe-eval only for the development runtime', () => {
    const csp = getCSP({ isDevelopment: true })

    expect(getDirective(csp, 'script-src')).toBe(
      `script-src 'self' 'nonce-${TEST_NONCE}' 'strict-dynamic' 'unsafe-eval'`,
    )
    expect(getDirective(csp, 'script-src')).not.toContain("'unsafe-inline'")
  })

  it('rejects nonces that could escape the CSP source expression', () => {
    expect(() => getCSP({ nonce: "bad'nonce" })).toThrow('CSP nonce contains invalid characters')
  })

  it('blocks inline HTML script event attributes', () => {
    expect(getCSP()).toContain("script-src-attr 'none'")
  })

  it('scopes browser Supabase access to the configured project origin', () => {
    const csp = getCSP({ supabaseUrl: 'https://project-ref.supabase.co/rest/v1' })

    expect(getDirective(csp, 'img-src')).toBe(
      "img-src 'self' data: blob: https://project-ref.supabase.co",
    )
    expect(getDirective(csp, 'connect-src')).toBe(
      "connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co",
    )
    expect(getDirective(csp, 'media-src')).toBe(
      "media-src 'self' blob: https://project-ref.supabase.co",
    )
    expect(csp).not.toContain('*.supabase.co')
  })

  it('maps a local HTTP Supabase origin to its WebSocket origin', () => {
    const csp = getCSP({ supabaseUrl: 'http://127.0.0.1:54321' })

    expect(getDirective(csp, 'connect-src')).toBe(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    )
  })

  it.each(['', 'not-a-url', 'https://*.supabase.co'])(
    'fails closed for an absent or invalid Supabase URL: %s',
    (supabaseUrl) => {
      const csp = getCSP({ supabaseUrl })

      expect(getDirective(csp, 'img-src')).toBe("img-src 'self' data: blob:")
      expect(getDirective(csp, 'connect-src')).toBe("connect-src 'self'")
      expect(getDirective(csp, 'media-src')).toBe("media-src 'self' blob:")
      expect(csp).not.toContain('supabase.co')
    },
  )

  it('does not allow unused Google Fonts origins', () => {
    const csp = getCSP()
    expect(csp).not.toContain('fonts.googleapis.com')
    expect(csp).not.toContain('fonts.gstatic.com')
  })

  it('disables unused frame and base capabilities', () => {
    const csp = getCSP()
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("base-uri 'none'")
  })
})
