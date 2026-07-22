const VALID_NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/

type SupabaseCspOrigins = Readonly<{
  resourceOrigin: string | null
  realtimeOrigin: string | null
}>

type ContentSecurityPolicyOptions = Readonly<{
  nonce: string
  isDevelopment: boolean
  supabaseUrl: string | undefined
}>

function getSupabaseCspOrigins(rawUrl: string | undefined): SupabaseCspOrigins {
  if (!rawUrl) {
    return { resourceOrigin: null, realtimeOrigin: null }
  }

  try {
    const url = new URL(rawUrl)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname.includes('*')) {
      return { resourceOrigin: null, realtimeOrigin: null }
    }

    const realtimeUrl = new URL(url.origin)
    realtimeUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

    return {
      resourceOrigin: url.origin,
      realtimeOrigin: realtimeUrl.origin,
    }
  } catch {
    return { resourceOrigin: null, realtimeOrigin: null }
  }
}

function buildDirective(name: string, ...sources: Array<string | null>): string {
  return [name, ...sources.filter(Boolean)].join(' ')
}

export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
  supabaseUrl,
}: ContentSecurityPolicyOptions): string {
  if (!VALID_NONCE_PATTERN.test(nonce)) {
    throw new Error('CSP nonce contains invalid characters')
  }

  const { resourceOrigin, realtimeOrigin } = getSupabaseCspOrigins(supabaseUrl)

  return [
    "default-src 'self'",
    buildDirective(
      'script-src',
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      isDevelopment ? "'unsafe-eval'" : null,
    ),
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    buildDirective('img-src', "'self'", 'data:', 'blob:', resourceOrigin),
    "font-src 'self' data:",
    buildDirective('connect-src', "'self'", resourceOrigin, realtimeOrigin),
    buildDirective('media-src', "'self'", 'blob:', resourceOrigin),
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ')
}
