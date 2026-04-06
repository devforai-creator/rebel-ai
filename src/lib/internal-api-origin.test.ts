import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }
const CANDIDATE_ENV_KEYS = ['INTERNAL_API_ORIGIN', 'VERCEL_URL']

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function clearCandidateEnv() {
  for (const key of CANDIDATE_ENV_KEYS) {
    delete process.env[key]
  }
  delete process.env.VERCEL_ENV
  // NODE_ENV is typed as read-only, use type assertion
  delete (process.env as Record<string, string | undefined>).NODE_ENV
}

async function loadModule() {
  return await import('./internal-api-origin')
}

describe('internal-api-origin', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    clearCandidateEnv()
  })

  afterAll(() => {
    restoreEnv()
  })

  it('prefers INTERNAL_API_ORIGIN over other candidates', async () => {
    process.env.INTERNAL_API_ORIGIN = 'https://internal.example.com'
    process.env.VERCEL_URL = 'some-deploy.vercel.app'

    const { resolveInternalApiOrigin, buildInternalApiUrl } = await loadModule()
    expect(resolveInternalApiOrigin()).toBe('https://internal.example.com')
    expect(buildInternalApiUrl('/api/internal/chat-job-runner').toString()).toBe(
      'https://internal.example.com/api/internal/chat-job-runner',
    )
  })

  it('falls back to localhost in development when INTERNAL_API_ORIGIN is missing', async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'

    const { resolveInternalApiOrigin } = await loadModule()
    expect(resolveInternalApiOrigin()).toBe('http://127.0.0.1:3000')
  })

  it('throws when INTERNAL_API_ORIGIN uses non-localhost http', async () => {
    process.env.INTERNAL_API_ORIGIN = 'http://internal.example.com'
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'

    const { resolveInternalApiOrigin } = await loadModule()
    expect(() => resolveInternalApiOrigin()).toThrow(
      'INTERNAL_API_ORIGIN must use https (http is only allowed for localhost in development).',
    )
  })

  it('accepts http localhost INTERNAL_API_ORIGIN in development', async () => {
    process.env.INTERNAL_API_ORIGIN = 'http://127.0.0.1:3000'
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'

    const { resolveInternalApiOrigin } = await loadModule()
    expect(resolveInternalApiOrigin()).toBe('http://127.0.0.1:3000')
  })

  it('throws when INTERNAL_API_ORIGIN is invalid', async () => {
    process.env.INTERNAL_API_ORIGIN = '://bad-origin'

    const { resolveInternalApiOrigin } = await loadModule()
    expect(() => resolveInternalApiOrigin()).toThrow(
      'INTERNAL_API_ORIGIN must be a valid absolute URL.',
    )
  })

  it('throws in production when no origin can be resolved', async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'

    const { resolveInternalApiOrigin } = await loadModule()
    expect(() => resolveInternalApiOrigin()).toThrow(
      'Unable to resolve internal API origin. Set INTERNAL_API_ORIGIN.',
    )
  })

  it('does not use localhost fallback when VERCEL_ENV is preview', async () => {
    process.env.VERCEL_ENV = 'preview'
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'

    const { resolveInternalApiOrigin } = await loadModule()
    expect(() => resolveInternalApiOrigin()).toThrow(
      'Unable to resolve internal API origin. Set INTERNAL_API_ORIGIN.',
    )
  })

  it('invalidates cached origin when INTERNAL_API_ORIGIN changes', async () => {
    process.env.INTERNAL_API_ORIGIN = 'https://first-origin.example.com'
    const { resolveInternalApiOrigin } = await loadModule()

    expect(resolveInternalApiOrigin()).toBe('https://first-origin.example.com')

    process.env.INTERNAL_API_ORIGIN = 'https://second-origin.example.com'
    expect(resolveInternalApiOrigin()).toBe('https://second-origin.example.com')
  })

  it('builds edge URL from current VERCEL_URL when available', async () => {
    process.env.VERCEL_URL = 'edge-deploy.vercel.app'

    const { buildInternalApiUrlForEdge } = await loadModule()
    expect(buildInternalApiUrlForEdge('/api/internal/chat-job-runner')).toBe(
      'https://edge-deploy.vercel.app/api/internal/chat-job-runner',
    )
  })
})
