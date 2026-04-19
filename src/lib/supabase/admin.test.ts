import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: Parameters<typeof createClientMock>) => createClientMock(...args),
}))

describe('createAdminClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    createClientMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws when the public Supabase URL is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    const { createAdminClient } = await import('./admin')

    expect(() => createAdminClient()).toThrow('NEXT_PUBLIC_SUPABASE_URL is not set')
  })

  it('throws when the service role key is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    const { createAdminClient } = await import('./admin')

    expect(() => createAdminClient()).toThrow('SUPABASE_SERVICE_ROLE_KEY is not set')
  })

  it('creates a fresh admin client with stateless auth options and timeout-bound fetch', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    const fakeClient = { kind: 'supabase-admin-client' }
    const timeoutSignal = new AbortController().signal
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)

    vi.stubGlobal('fetch', fetchMock)
    createClientMock.mockReturnValue(fakeClient)

    const { createAdminClient } = await import('./admin')
    const client = createAdminClient()

    expect(client).toBe(fakeClient)
    expect(createClientMock).toHaveBeenCalledTimes(1)

    const [url, serviceRoleKey, options] = createClientMock.mock.calls[0]
    expect(url).toBe('https://example.supabase.co')
    expect(serviceRoleKey).toBe('service-role-key')
    expect(options).toMatchObject({
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    await options.global.fetch('https://example.supabase.co/rest/v1/test', {
      method: 'POST',
      headers: { 'x-test': '1' },
    })

    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/test',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-test': '1' },
        signal: timeoutSignal,
      }),
    )
  })
})
