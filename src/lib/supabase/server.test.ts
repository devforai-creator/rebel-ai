import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServerClientMock = vi.fn()
const cookiesMock = vi.fn()

vi.mock('server-only', () => ({}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: Parameters<typeof createServerClientMock>) =>
    createServerClientMock(...args),
}))

vi.mock('next/headers', () => ({
  cookies: (...args: Parameters<typeof cookiesMock>) => cookiesMock(...args),
}))

describe('createClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    createServerClientMock.mockReset()
    cookiesMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wires the current cookie store into the Supabase SSR client', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')

    const cookieStore = {
      getAll: vi.fn(() => [{ name: 'sb-access-token', value: 'token-value' }]),
      set: vi.fn(),
    }
    const fakeClient = { kind: 'supabase-server-client' }

    cookiesMock.mockResolvedValue(cookieStore)
    createServerClientMock.mockReturnValue(fakeClient)

    const { createClient } = await import('./server')
    const client = await createClient()

    expect(client).toBe(fakeClient)
    expect(cookiesMock).toHaveBeenCalledTimes(1)
    expect(createServerClientMock).toHaveBeenCalledTimes(1)

    const [url, anonKey, options] = createServerClientMock.mock.calls[0]
    expect(url).toBe('https://example.supabase.co')
    expect(anonKey).toBe('anon-key')
    expect(options.cookies.getAll()).toEqual([{ name: 'sb-access-token', value: 'token-value' }])

    options.cookies.setAll([
      {
        name: 'sb-refresh-token',
        value: 'refresh-value',
        options: { path: '/', httpOnly: true },
      },
    ])

    expect(cookieStore.set).toHaveBeenCalledWith('sb-refresh-token', 'refresh-value', {
      path: '/',
      httpOnly: true,
    })
  })

  it('swallows cookie write failures so server-component renders do not crash', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')

    const cookieStore = {
      getAll: vi.fn(() => []),
      set: vi.fn(() => {
        throw new Error('set is not available in this render context')
      }),
    }

    cookiesMock.mockResolvedValue(cookieStore)
    createServerClientMock.mockReturnValue({ kind: 'supabase-server-client' })

    const { createClient } = await import('./server')
    await createClient()

    const options = createServerClientMock.mock.calls[0]?.[2]
    expect(() =>
      options.cookies.setAll([
        {
          name: 'sb-refresh-token',
          value: 'refresh-value',
          options: { path: '/' },
        },
      ]),
    ).not.toThrow()
  })
})
