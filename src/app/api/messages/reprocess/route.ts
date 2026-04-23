import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserRateLimit } from '@/lib/chat/rate-limiter'
import { reprocessAssistantMessageForUser } from '@/lib/chat/reprocess-service'
import {
  SUPPORT_TIER_FEATURES,
  withSupportTierHeaders as withSupportTierHeadersBase,
} from '@/lib/support-tier'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60

const reprocessRequestSchema = z.object({
  messageId: z.string().min(1),
})

function withSupportTierHeaders(headers?: HeadersInit) {
  return withSupportTierHeadersBase(SUPPORT_TIER_FEATURES.MESSAGE_REPROCESS.tier, headers)
}

function createReprocessTextResponse(body: string, init?: ResponseInit) {
  return new Response(body, {
    ...init,
    headers: withSupportTierHeaders(init?.headers),
  })
}

function createReprocessJsonResponse(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: withSupportTierHeaders(init?.headers),
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return createReprocessTextResponse('Unauthorized', { status: 401 })
  }

  const { allowed, retryAfter } = await checkUserRateLimit(user.id)
  if (!allowed) {
    return createReprocessTextResponse('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(retryAfter ?? 60) },
    })
  }

  const parsed = reprocessRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return createReprocessTextResponse('Missing messageId', { status: 400 })
  }
  const { messageId } = parsed.data

  const result = await reprocessAssistantMessageForUser({
    supabase,
    userId: user.id,
    messageId,
    getAdminClient: createAdminClient,
  })

  switch (result.status) {
    case 'message_not_found':
      return createReprocessTextResponse('Message not found', { status: 404 })
    case 'forbidden':
      return createReprocessTextResponse('Forbidden', { status: 403 })
    case 'not_assistant':
      return createReprocessTextResponse('Only assistant messages can be reprocessed', {
        status: 400,
      })
    case 'profile_not_found':
      return createReprocessTextResponse('Profile not found', { status: 404 })
    case 'settings_not_configured':
      return createReprocessTextResponse(
        'Reprocess settings not configured. Please set prompt and API key in settings.',
        { status: 400 },
      )
    case 'api_key_not_found':
      return createReprocessTextResponse('API key not found or inactive', { status: 400 })
    case 'unsupported_provider':
      return createReprocessTextResponse('Unsupported provider', { status: 400 })
    case 'decrypt_failed':
      return createReprocessTextResponse('Failed to decrypt API key', { status: 500 })
    case 'save_failed':
      return createReprocessTextResponse('Failed to save reprocessed message', { status: 500 })
    case 'reprocess_failed':
      return createReprocessTextResponse('Failed to reprocess message', { status: 500 })
    case 'success':
      return createReprocessJsonResponse({ success: true, content: result.content })
    default:
      return createReprocessTextResponse('Failed to reprocess message', { status: 500 })
  }
}
