import { describe, it, expect, afterEach, vi } from 'vitest'

describe('CSP invariants', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  type NextConfigShape = {
    headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>>
  }

  async function getCSP(): Promise<string> {
    vi.resetModules()
    const configModule = await import('../../next.config.js')
    const config = (configModule.default ?? configModule) as NextConfigShape
    const headerSets = await config.headers()
    const cspHeader = headerSets[0].headers.find(
      (h: { key: string; value: string }) => h.key === 'Content-Security-Policy',
    )
    if (!cspHeader) {
      throw new Error('Content-Security-Policy header not found in next.config.js')
    }
    return cspHeader.value
  }

  function getDirective(csp: string, name: string): string {
    const directive = csp.split('; ').find((part) => part.startsWith(`${name} `))
    if (!directive) {
      throw new Error(`${name} directive not found in CSP`)
    }
    return directive
  }

  it('production CSP must NOT contain "unsafe-eval"', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const csp = await getCSP()
    expect(
      csp,
      "Production CSP must not contain 'unsafe-eval'. " +
        'It would widen XSS attack surface — any string reaching eval context becomes executable JS. ' +
        'If dev needs eval, use the NODE_ENV branch in next.config.js (prod branch must stay clean).',
    ).not.toContain("'unsafe-eval'")
  })

  it('development CSP allows unsafe-eval (Next.js dev runtime)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const csp = await getCSP()
    expect(csp).toContain("'unsafe-eval'")
  })

  it('blocks inline HTML script event attributes', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const csp = await getCSP()
    expect(csp).toContain("script-src-attr 'none'")
  })

  it('scopes browser Supabase access to the configured project origin', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project-ref.supabase.co/rest/v1')
    const csp = await getCSP()

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

  it('maps a local HTTP Supabase origin to its WebSocket origin', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    const csp = await getCSP()

    expect(getDirective(csp, 'connect-src')).toBe(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    )
  })

  it.each(['', 'not-a-url', 'https://*.supabase.co'])(
    'fails closed for an absent or invalid Supabase URL: %s',
    async (supabaseUrl) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl)
      const csp = await getCSP()

      expect(getDirective(csp, 'img-src')).toBe("img-src 'self' data: blob:")
      expect(getDirective(csp, 'connect-src')).toBe("connect-src 'self'")
      expect(getDirective(csp, 'media-src')).toBe("media-src 'self' blob:")
      expect(csp).not.toContain('supabase.co')
    },
  )

  it('does not allow unused Google Fonts origins', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const csp = await getCSP()
    expect(csp).not.toContain('fonts.googleapis.com')
    expect(csp).not.toContain('fonts.gstatic.com')
  })

  it('disables unused frame and base capabilities', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const csp = await getCSP()
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("base-uri 'none'")
  })
})
