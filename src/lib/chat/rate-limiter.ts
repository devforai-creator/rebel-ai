import 'server-only'

import crypto from 'crypto'
import type { Database } from '@/types/database.types'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildInternalApiUrlForEdge } from '@/lib/internal-api-origin'
import { checkAnonRateLimitRpc, checkChatRateLimit } from '@/lib/supabase/rpc'
import { CHAT_RATE_LIMITS } from './runtime-limits'

interface RateLimitResult {
  allowed: boolean
  retryAfter: number | null
}

type RateLimitRpcRow = {
  allowed: boolean | null
  retry_after: number | null
}

interface ChatAdminRequestBase {
  requester: string
}

type ChatAdminRateLimitPayload =
  | (ChatAdminRequestBase & {
      action: 'checkAnonRateLimit'
      args: Database['public']['Functions']['check_anon_rate_limit']['Args']
    })
  | (ChatAdminRequestBase & {
      action: 'checkUserRateLimit'
      args: Database['public']['Functions']['check_chat_rate_limit']['Args']
    })

type ChatAdminResponse<T> = {
  data: T
}

export async function checkUserRateLimit(userId: string): Promise<RateLimitResult> {
  const rateLimitArgs = {
    target_user_id: userId,
    window_seconds: CHAT_RATE_LIMITS.userWindowSeconds,
    max_requests: CHAT_RATE_LIMITS.userMaxRequests,
  } satisfies Database['public']['Functions']['check_chat_rate_limit']['Args']

  const adminSupabase = createAdminClient()
  const rateLimitData = hasRpcClient(adminSupabase)
    ? await readUserRateLimitViaRpc(adminSupabase, rateLimitArgs)
    : await callChatAdmin<Array<RateLimitRpcRow> | null>({
        requester: userId,
        action: 'checkUserRateLimit',
        args: rateLimitArgs,
      })

  return normalizeRateLimitResult(rateLimitData, CHAT_RATE_LIMITS.userWindowSeconds)
}

export async function checkAnonRateLimit(identifier: string): Promise<RateLimitResult> {
  const normalizedIdentifier = buildClientIdentifier(identifier)

  const rateLimitArgs = {
    identifier: normalizedIdentifier,
    window_seconds: CHAT_RATE_LIMITS.anonWindowSeconds,
    max_requests: CHAT_RATE_LIMITS.anonMaxRequests,
  } satisfies Database['public']['Functions']['check_anon_rate_limit']['Args']

  const adminSupabase = createAdminClient()
  const rateLimitData = hasRpcClient(adminSupabase)
    ? await readAnonRateLimitViaRpc(adminSupabase, rateLimitArgs)
    : await callChatAdmin<Array<RateLimitRpcRow> | null>({
        requester: 'anonymous-user',
        action: 'checkAnonRateLimit',
        args: rateLimitArgs,
      })

  return normalizeRateLimitResult(rateLimitData, CHAT_RATE_LIMITS.anonWindowSeconds)
}

export function buildClientIdentifier(identifier: string): string {
  const normalized = identifier.trim()
  if (!normalized) {
    return 'anonymous-unknown'
  }

  const hashed = hashString(normalized)
  if (hashed.length <= CHAT_RATE_LIMITS.maxAnonRateLimitIdentifierLength) {
    return hashed
  }

  return hashed.slice(0, CHAT_RATE_LIMITS.maxAnonRateLimitIdentifierLength)
}

function hashString(input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest('base64url')
  // Prefix with 'ua:' for consistency and take first 32 chars to keep it readable
  return `ua:${hash.slice(0, 32)}`
}

function hasRpcClient(client: unknown): client is ReturnType<typeof createAdminClient> {
  return typeof (client as { rpc?: unknown } | null)?.rpc === 'function'
}

async function readUserRateLimitViaRpc(
  adminSupabase: ReturnType<typeof createAdminClient>,
  rateLimitArgs: Database['public']['Functions']['check_chat_rate_limit']['Args'],
): Promise<Array<RateLimitRpcRow> | null> {
  const { data, error } = await checkChatRateLimit(adminSupabase, rateLimitArgs)

  if (error) {
    throw new Error(`check_chat_rate_limit failed (${error.code ?? 'unknown'}): ${error.message}`)
  }

  return data as Array<RateLimitRpcRow> | null
}

async function readAnonRateLimitViaRpc(
  adminSupabase: ReturnType<typeof createAdminClient>,
  rateLimitArgs: Database['public']['Functions']['check_anon_rate_limit']['Args'],
): Promise<Array<RateLimitRpcRow> | null> {
  const { data, error } = await checkAnonRateLimitRpc(adminSupabase, rateLimitArgs)

  if (error) {
    throw new Error(`check_anon_rate_limit failed (${error.code ?? 'unknown'}): ${error.message}`)
  }

  return data as Array<RateLimitRpcRow> | null
}

function normalizeRateLimitResult(
  rateLimitData: unknown,
  fallbackRetryAfter: number,
): RateLimitResult {
  const rateLimiterPayload = Array.isArray(rateLimitData)
    ? ((rateLimitData[0] ?? null) as RateLimitRpcRow | null)
    : null

  const allowed = rateLimiterPayload?.allowed ?? false
  const retryAfter =
    typeof rateLimiterPayload?.retry_after === 'number'
      ? Math.max(1, rateLimiterPayload.retry_after)
      : fallbackRetryAfter

  return { allowed, retryAfter: allowed ? null : retryAfter }
}

async function callChatAdmin<T>(payload: ChatAdminRateLimitPayload): Promise<T> {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    throw new Error('CHAT_ADMIN_SECRET is not configured')
  }

  const endpointUrl = buildInternalApiUrlForEdge('/api/internal/chat-admin')

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminSecret}`,
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Chat admin request failed (${response.status}): ${errorText}`)
  }

  const json = (await response.json()) as ChatAdminResponse<T>
  return json.data
}
