import { isIP } from 'node:net'

export async function extractClientIdentifier(req: Request): Promise<string> {
  const candidates: Array<string | null> = []
  if (process.env.VERCEL === '1') {
    candidates.push(...getForwardedForClientIps(req.headers.get('x-vercel-forwarded-for')))
  }

  if (shouldTrustProxyIpHeaders()) {
    const forwardedFor = req.headers.get('x-forwarded-for')
    candidates.push(req.headers.get('x-real-ip'), ...getForwardedForClientIps(forwardedFor))
  }

  let firstValidIp: string | null = null

  for (const candidate of candidates) {
    const normalized = normalizePotentialIp(candidate)
    if (!normalized) {
      continue
    }

    if (!firstValidIp) {
      firstValidIp = normalized
    }

    if (!isPrivateIp(normalized)) {
      return normalized
    }
  }

  if (firstValidIp) {
    return firstValidIp
  }

  // Anonymous requests cannot authenticate. Share a bucket when no trusted
  // network identity is available so client-controlled headers cannot reset it.
  return 'anonymous-unknown'
}

export function parseDeclaredContentLength(headerValue: string | null): number | null {
  if (!headerValue) {
    return null
  }

  const parsed = Number.parseInt(headerValue, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

function getForwardedForClientIps(headerValue: string | null): string[] {
  if (!headerValue) {
    return []
  }

  return headerValue
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function normalizePotentialIp(candidate: string | null): string | null {
  if (!candidate) {
    return null
  }

  const trimmed = candidate.trim()
  if (!trimmed) {
    return null
  }

  return isIP(trimmed) ? trimmed.toLowerCase() : null
}

function shouldTrustProxyIpHeaders(): boolean {
  return process.env.TRUST_PROXY_IP_HEADERS === 'true'
}

function isPrivateIp(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^127\./,
    /^fc00:/i,
    /^fe80:/i,
    /^::1$/,
  ]

  return privateRanges.some((range) => range.test(ip))
}
