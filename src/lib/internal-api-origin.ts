const LOCALHOST_ORIGIN = 'http://127.0.0.1:3000'
const INTERNAL_API_ORIGIN_DEBUG_ENABLED = process.env.INTERNAL_API_ORIGIN_DEBUG === 'true'

let cachedOrigin: string | null = null
let cachedConfiguredOrigin: string | null = null

function logInternalApiOriginDebug(...args: unknown[]): void {
  if (INTERNAL_API_ORIGIN_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

/**
 * Resolves the trusted origin for calling internal API routes.
 *
 * Priority:
 * 1. Explicit INTERNAL_API_ORIGIN (required in non-local environments)
 * 2. Localhost fallback for local development only
 *
 * Throws if nothing can be resolved in production, so misconfigurations surface quickly.
 */
export function resolveInternalApiOrigin(): string {
  const configuredOrigin = process.env.INTERNAL_API_ORIGIN?.trim() ?? ''

  // INTERNAL_API_ORIGIN이 변경되면 캐시 무효화
  if (cachedOrigin && cachedConfiguredOrigin !== configuredOrigin) {
    logInternalApiOriginDebug('[Internal API Origin] Cache invalidated - origin changed', {
      oldOriginInput: cachedConfiguredOrigin,
      newOriginInput: configuredOrigin,
      oldOrigin: cachedOrigin,
    })
    cachedOrigin = null
    cachedConfiguredOrigin = null
  }

  if (cachedOrigin) {
    logInternalApiOriginDebug('[Internal API Origin] Using cached origin', {
      cachedOrigin,
      vercelEnv: process.env.VERCEL_ENV,
      hasInternalApiOrigin: configuredOrigin.length > 0,
    })
    return cachedOrigin
  }

  const normalizedConfiguredOrigin = normalizeConfiguredOrigin(configuredOrigin)
  if (normalizedConfiguredOrigin) {
    cachedOrigin = normalizedConfiguredOrigin
    cachedConfiguredOrigin = configuredOrigin
    logInternalApiOriginDebug('[Internal API Origin] Resolved from INTERNAL_API_ORIGIN', {
      origin: normalizedConfiguredOrigin,
      vercelEnv: process.env.VERCEL_ENV,
    })
    return normalizedConfiguredOrigin
  }

  if (isLocalLikeEnvironment()) {
    cachedOrigin = LOCALHOST_ORIGIN
    cachedConfiguredOrigin = configuredOrigin
    logInternalApiOriginDebug('[Internal API Origin] Using localhost fallback')
    return cachedOrigin
  }

  throw new Error('Unable to resolve internal API origin. Set INTERNAL_API_ORIGIN.')
}

export function buildInternalApiUrl(path: string | URL): URL {
  const origin = resolveInternalApiOrigin()
  return new URL(path, origin)
}

/**
 * For Edge runtime same-deployment calls: returns path with current deployment origin.
 * This uses VERCEL_URL to ensure same-deployment calls bypass protection.
 */
export function buildInternalApiUrlForEdge(path: string): string {
  // In Edge runtime on Vercel, use current deployment URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}${path}`
  }

  // Fallback to full URL (development or misconfigured)
  const origin = resolveInternalApiOrigin()
  return new URL(path, origin).toString()
}

function normalizeOrigin(candidate: string | null | undefined): string | null {
  if (!candidate || candidate.length === 0) {
    return null
  }

  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  let parsed: URL

  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('INTERNAL_API_ORIGIN must be a valid absolute URL.')
  }

  if (parsed.protocol === 'https:') {
    return parsed.origin
  }

  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1')

  if (isLocalHttp && isLocalLikeEnvironment()) {
    return parsed.origin
  }

  throw new Error(
    'INTERNAL_API_ORIGIN must use https (http is only allowed for localhost in development).',
  )
}

function normalizeConfiguredOrigin(candidate: string): string | null {
  if (!candidate) {
    return null
  }

  return normalizeOrigin(candidate)
}

function isLocalLikeEnvironment(): boolean {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV === 'development'
  }

  return process.env.NODE_ENV !== 'production'
}
