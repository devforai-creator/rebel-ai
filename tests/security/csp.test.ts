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
