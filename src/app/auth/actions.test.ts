import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const redirectMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

type AuthSupabaseOptions = {
  signInError?: { message: string } | null
  signOutError?: { message: string } | null
}

function buildLoginFormData(overrides?: {
  email?: string
  password?: string
  omitEmail?: boolean
  omitPassword?: boolean
}) {
  const formData = new FormData()

  if (!overrides?.omitEmail) {
    formData.set('email', overrides?.email ?? 'user@example.com')
  }

  if (!overrides?.omitPassword) {
    formData.set('password', overrides?.password ?? 'super-secret')
  }

  return formData
}

function buildSupabase(options: AuthSupabaseOptions = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: options.signInError ?? null }),
      signOut: vi.fn().mockResolvedValue({ error: options.signOutError ?? null }),
    },
  }
}

describe('auth actions', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    redirectMock.mockReset()
    revalidatePathMock.mockReset()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('returns a validation error when email is missing', async () => {
    createClientMock.mockResolvedValue(buildSupabase())
    const { login } = await import('./actions')

    const result = await login(
      buildLoginFormData({
        omitEmail: true,
      }),
    )

    expect(result).toEqual({ error: 'Email is required.' })
  })

  it('returns a validation error when password is missing', async () => {
    createClientMock.mockResolvedValue(buildSupabase())
    const { login } = await import('./actions')

    const result = await login(
      buildLoginFormData({
        omitPassword: true,
      }),
    )

    expect(result).toEqual({ error: 'Password is required.' })
  })

  it('returns the auth provider error when sign-in fails', async () => {
    const supabase = buildSupabase({
      signInError: { message: 'Invalid login credentials' },
    })
    createClientMock.mockResolvedValue(supabase)
    const { login } = await import('./actions')

    const result = await login(buildLoginFormData())

    expect(result).toEqual({ error: 'Invalid login credentials' })
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'super-secret',
    })
  })

  it('signs in and redirects on success', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { login } = await import('./actions')

    const result = await login(buildLoginFormData())

    expect(result).toBeUndefined()
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'super-secret',
    })
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
    expect(redirectMock).toHaveBeenCalledWith('/dashboard')
  })

  it('returns the blocked-signup message without touching Supabase', async () => {
    const { signup } = await import('./actions')

    const result = await signup(new FormData())

    expect(result).toEqual({
      error: '현재 신규 가입이 중단되었습니다. 기존 사용자는 계속 이용 가능합니다.',
    })
    expect(createClientMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('signs out, revalidates, and redirects on logout success', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { logout } = await import('./actions')

    const result = await logout()

    expect(result).toBeUndefined()
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1)
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
    expect(redirectMock).toHaveBeenCalledWith('/auth/login')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('still redirects on logout failure after logging the error', async () => {
    const supabase = buildSupabase({
      signOutError: { message: 'session revoke failed' },
    })
    createClientMock.mockResolvedValue(supabase)
    const { logout } = await import('./actions')

    const result = await logout()

    expect(result).toBeUndefined()
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith('Logout error:', 'session revoke failed')
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
    expect(redirectMock).toHaveBeenCalledWith('/auth/login')
  })
})
