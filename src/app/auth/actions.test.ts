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
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ error: options.signInError ?? null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }
}

describe('auth actions', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    redirectMock.mockReset()
    revalidatePathMock.mockReset()
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
})
