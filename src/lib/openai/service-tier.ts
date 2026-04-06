import { createOpenAI } from '@ai-sdk/openai'
import type { ApiServiceTier } from '@/types/database.types'

const SERVICE_TIER_ENDPOINT_SEGMENTS = ['/chat/completions', '/responses'] as const

const throwFetchUnavailable: typeof fetch = () => {
  throw new Error('Global fetch is not available in this environment')
}

const BASE_FETCH: typeof fetch = typeof fetch === 'function' ? fetch : throwFetchUnavailable

function shouldInjectServiceTier(
  serviceTier: ApiServiceTier,
  input: RequestInfo | URL,
  init?: RequestInit,
): init is RequestInit & { body: string } {
  if (serviceTier === 'standard') {
    return false
  }

  if (!init || typeof init.body !== 'string' || !init.body) {
    return false
  }

  const targetUrl = resolveRequestUrl(input)
  if (!targetUrl) {
    return false
  }

  return SERVICE_TIER_ENDPOINT_SEGMENTS.some((segment) => targetUrl.includes(segment))
}

function resolveRequestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url
  }

  if (typeof input === 'object' && input && 'url' in input) {
    return String((input as { url?: unknown }).url ?? '')
  }

  return null
}

function injectServiceTier(body: string, serviceTier: ApiServiceTier): string {
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && !('service_tier' in parsed)) {
      parsed.service_tier = serviceTier
      return JSON.stringify(parsed)
    }

    return body
  } catch (error) {
    console.warn('[OpenAI] Failed to inject service_tier', {
      error: error instanceof Error ? error.message : String(error),
    })
    return body
  }
}

function createTierAwareFetch(serviceTier: ApiServiceTier): typeof fetch {
  return async (input, init) => {
    if (shouldInjectServiceTier(serviceTier, input, init)) {
      const nextBody = injectServiceTier(init.body, serviceTier)
      const nextInit: RequestInit = { ...(init ?? {}), body: nextBody }
      return BASE_FETCH(input, nextInit)
    }

    return BASE_FETCH(input, init)
  }
}

export function createOpenAIWithServiceTier({
  apiKey,
  serviceTier = 'standard',
}: {
  apiKey: string
  serviceTier?: ApiServiceTier | null
}) {
  const normalizedTier: ApiServiceTier =
    serviceTier && serviceTier !== 'standard' ? (serviceTier as ApiServiceTier) : 'standard'

  if (normalizedTier === 'standard') {
    return createOpenAI({ apiKey })
  }

  const tierAwareFetch = createTierAwareFetch(normalizedTier)
  return createOpenAI({ apiKey, fetch: tierAwareFetch })
}
