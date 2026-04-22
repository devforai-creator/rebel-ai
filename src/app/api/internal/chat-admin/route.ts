import { createAdminClient } from '@/lib/supabase/admin'
import {
  createApiErrorResponse,
  parseJsonRequest,
  requireBearerToken,
} from '@/lib/http/api-contract'
import type { Database } from '@/types/database.types'
import { z } from 'zod'

interface ChatAdminRequestBase {
  requester: string // user ID of the request initiator for validation
}

type ChatAdminRequest =
  | (ChatAdminRequestBase & {
      action: 'checkAnonRateLimit'
      args: Database['public']['Functions']['check_anon_rate_limit']['Args']
    })
  | (ChatAdminRequestBase & {
      action: 'checkUserRateLimit'
      args: Database['public']['Functions']['check_chat_rate_limit']['Args']
    })
  | (ChatAdminRequestBase & {
      action: 'decryptSecret'
      args: Database['public']['Functions']['get_decrypted_secret']['Args']
    })

const chatAdminRequestSchema: z.ZodType<ChatAdminRequest> = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('checkAnonRateLimit'),
    requester: z.string().min(1),
    args: z.object({
      identifier: z.string().min(1),
      window_seconds: z.number(),
      max_requests: z.number(),
    }),
  }),
  z.object({
    action: z.literal('checkUserRateLimit'),
    requester: z.string().min(1),
    args: z.object({
      target_user_id: z.string().min(1),
      window_seconds: z.number(),
      max_requests: z.number(),
    }),
  }),
  z.object({
    action: z.literal('decryptSecret'),
    requester: z.string().min(1),
    args: z.object({
      secret_name: z.string().min(1),
      requester: z.string().min(1),
    }),
  }),
])

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Chat Admin API] CHAT_ADMIN_SECRET is not configured')
  }

  const auth = requireBearerToken(req, adminSecret, {
    missingSecretMessage: 'Server misconfigured',
  })
  if (!auth.success) {
    return auth.response
  }

  const parsed = await parseJsonRequest(req, chatAdminRequestSchema)
  if (!parsed.success) {
    return parsed.response
  }

  const body = parsed.data

  const adminSupabase = createAdminClient()

  switch (body.action) {
    case 'checkAnonRateLimit': {
      // Type assertion needed due to Supabase generic RPC typing limitations
      const result = (await (adminSupabase.rpc as CallableFunction)(
        'check_anon_rate_limit',
        body.args,
      )) as { data: unknown; error: { code?: string; message?: string } | null }

      if (result.error) {
        console.error('[Chat Admin API] check_anon_rate_limit failed', {
          code: result.error.code ?? null,
        })
        return createApiErrorResponse('check_anon_rate_limit failed', 500)
      }

      return Response.json({ data: result.data ?? null })
    }
    case 'checkUserRateLimit': {
      // Validate that requester matches target_user_id to prevent spoofing
      if (body.requester !== body.args.target_user_id) {
        console.error('[Chat Admin API] Requester mismatch for checkUserRateLimit', {
          requester: body.requester,
          targetUserId: body.args.target_user_id,
        })
        return createApiErrorResponse('Forbidden', 403)
      }

      // Type assertion needed due to Supabase generic RPC typing limitations
      const result = (await (adminSupabase.rpc as CallableFunction)(
        'check_chat_rate_limit',
        body.args,
      )) as { data: unknown; error: { code?: string; message?: string } | null }

      if (result.error) {
        console.error('[Chat Admin API] check_chat_rate_limit failed', {
          code: result.error.code ?? null,
        })
        return createApiErrorResponse('check_chat_rate_limit failed', 500)
      }

      return Response.json({ data: result.data ?? null })
    }
    case 'decryptSecret': {
      // Validate that requester matches the secret owner
      if (body.requester !== body.args.requester) {
        console.error('[Chat Admin API] Requester mismatch for decryptSecret', {
          requester: body.requester,
          secretRequester: body.args.requester,
        })
        return createApiErrorResponse('Forbidden', 403)
      }

      // Type assertion needed due to Supabase generic RPC typing limitations
      const result = (await (adminSupabase.rpc as CallableFunction)(
        'get_decrypted_secret',
        body.args,
      )) as { data: string | null; error: { code?: string; message?: string } | null }

      if (result.error || !result.data) {
        console.error('[Chat Admin API] get_decrypted_secret failed', {
          code: result.error?.code ?? null,
        })
        return createApiErrorResponse('get_decrypted_secret failed', 500)
      }

      return Response.json({ data: result.data })
    }
    default:
      return createApiErrorResponse('Unsupported action', 400)
  }
}
