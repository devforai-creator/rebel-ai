import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { AuthError, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

const AUTH_RETRY_ATTEMPTS = 3
const AUTH_RETRY_BASE_DELAY_MS = 200
type SupabaseServerClient = SupabaseClient<Database>
type GetUserResult = Awaited<ReturnType<SupabaseServerClient['auth']['getUser']>>

export async function middleware(request: NextRequest) {
  // Skip middleware for Vercel's screenshot bot (generates deployment thumbnails)
  const userAgent = request.headers.get('user-agent') || ''
  if (userAgent.includes('vercel-screenshot')) {
    return NextResponse.next()
  }

  // Skip middleware for large file uploads
  // This allows files larger than 10MB to be processed
  if (
    request.method === 'POST' &&
    (request.nextUrl.pathname === '/api/characters/import' ||
      request.nextUrl.pathname === '/dashboard/characters/new' ||
      request.nextUrl.pathname.startsWith('/dashboard/characters/'))
  ) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  // Supabase SSR returns a more specific generic signature than the middleware alias uses.
  // Keep the cast at the factory boundary instead of leaking it into auth logic below.
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  ) as unknown as SupabaseServerClient

  const pathname = request.nextUrl.pathname
  const isDashboardGet = pathname.startsWith('/dashboard') && request.method === 'GET'

  if (isDashboardGet) {
    const { error: sessionError } = await supabase.auth.getSession()
    if (sessionError) {
      console.warn('[Middleware] Supabase session refresh failed', {
        status: (sessionError as { status?: number }).status,
        message: sessionError.message,
      })
    }
    return supabaseResponse
  }

  const authResult = await getUserWithRetry(supabase)
  const {
    data: { user },
    error: authError,
  } = authResult

  // Only log actual degradation (5xx errors), not normal 4xx client errors like missing sessions
  const authErrorStatus = (authError as { status?: number })?.status
  if (authError && typeof authErrorStatus === 'number' && authErrorStatus >= 500) {
    console.warn('[Middleware] Supabase auth lookup degraded after retries', {
      status: authErrorStatus,
      message: (authError as { message?: string }).message,
    })
  }

  // Protect routes that require authentication
  if (!user && pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Redirect already logged-in users from auth pages to dashboard
  if (user && pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

function shouldRetryAuth(error: unknown): boolean {
  if (!error) return true
  const status =
    typeof (error as { status?: unknown }).status === 'number'
      ? ((error as { status?: number }).status ?? null)
      : null
  if (typeof status === 'number' && status >= 500) {
    return true
  }
  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message?: string }).message || ''
      : ''
  return /fetch failed|timeout|timed out|econnreset|network/i.test(message)
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getUserWithRetry(supabase: SupabaseServerClient): Promise<GetUserResult> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= AUTH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await supabase.auth.getUser()
      if (!result.error || !shouldRetryAuth(result.error)) {
        return result
      }
      lastError = result.error
    } catch (error) {
      lastError = error
      if (!shouldRetryAuth(error)) {
        throw error
      }
    }

    if (attempt < AUTH_RETRY_ATTEMPTS) {
      const backoff = AUTH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      console.warn('[Middleware] Supabase auth lookup failed, retrying', {
        attempt,
        backoffMs: backoff,
      })
      await delay(backoff)
    }
  }

  return {
    data: { user: null },
    error: coerceAuthError(lastError),
  }
}

function coerceAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) {
    return error
  }

  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message?: string }).message || 'Supabase auth lookup failed'
      : 'Supabase auth lookup failed'
  const status =
    typeof (error as { status?: unknown }).status === 'number'
      ? ((error as { status?: number }).status ?? 500)
      : 500

  return new AuthError(message, status)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/internal|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
