import {
  USER_DRAFT_MAX_REQUEST_BYTES,
  userDraftRequestSchema,
} from '@/lib/chat/user-draft-contract'
import { generateUserDraft, UserDraftError } from '@/lib/chat/user-draft-service'
import { checkUserRateLimit } from '@/lib/chat/rate-limiter'
import {
  createApiErrorResponse,
  parseJsonRequest,
  requireAuthenticatedUser,
} from '@/lib/http/api-contract'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

async function parseDraftRequest(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) {
    return {
      success: false as const,
      response: createApiErrorResponse('Invalid request body', 400),
    }
  }
  const decoder = new TextDecoder()
  let body = ''
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > USER_DRAFT_MAX_REQUEST_BYTES) {
        await reader.cancel()
        return {
          success: false as const,
          response: createApiErrorResponse('Request body exceeds allowed size', 413),
        }
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return parseJsonRequest(
    new Request(request.url, { method: 'POST', body }),
    userDraftRequestSchema,
  )
}

export async function POST(request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const timeout = AbortSignal.timeout(50_000)
  const signal = AbortSignal.any([request.signal, timeout])
  try {
    const supabase = await createClient()
    const auth = await requireAuthenticatedUser(supabase)
    if (!auth.success) return auth.response

    const { allowed, retryAfter } = await checkUserRateLimit(auth.user.id)
    if (!allowed) {
      return createApiErrorResponse('Too many requests', 429, {
        retryAfter,
        headers: { 'Retry-After': String(retryAfter ?? 60) },
      })
    }
    const parsed = await parseDraftRequest(request)
    if (!parsed.success) return parsed.response

    const { chatId } = await params
    signal.throwIfAborted()
    const result = await generateUserDraft({
      supabase,
      getAdminClient: createAdminClient,
      userId: auth.user.id,
      chatId,
      request: parsed.data,
      signal,
    })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof UserDraftError) {
      return createApiErrorResponse(error.message, error.status)
    }
    if (signal.aborted) {
      return createApiErrorResponse('초안 작성이 취소되었거나 시간이 초과되었습니다.', 504)
    }
    console.error('[User draft] Generation failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return createApiErrorResponse('초안을 작성하지 못했습니다. 다시 시도해주세요.', 502)
  }
}
