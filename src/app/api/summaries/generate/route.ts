import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateSummariesForChat } from '@/lib/chat-memory/summary-generation-service'
import {
  createApiErrorResponse,
  createUnexpectedRouteErrorResponse,
  parseJsonRequest,
  requireBearerToken,
} from '@/lib/http/api-contract'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minute timeout (summary generation can take time)
export const dynamic = 'force-dynamic' // Disable caching
export const revalidate = 0 // Invalidate cache
const SUMMARIES_API_DEBUG_ENABLED = process.env.SUMMARIES_API_DEBUG === 'true'

function logSummariesApiDebug(...args: unknown[]): void {
  if (SUMMARIES_API_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

interface SummaryRangePayload {
  startSeq: number
  endSeq: number
}

interface RegeneratePayload {
  chunkRanges?: SummaryRangePayload[]
  factRanges?: SummaryRangePayload[]
  metaRanges?: SummaryRangePayload[]
}

const generateSummariesRequestSchema = z.object({
  chatId: z.string().min(1),
  userId: z.string().min(1),
  provider: z.string().min(1),
  modelName: z.string().min(1),
  apiKeyId: z.string().min(1),
  regenerate: z.unknown().optional(),
})

type GenerateSummariesRequest = z.output<typeof generateSummariesRequestSchema>

export async function POST(request: NextRequest) {
  try {
    // 1. Verify authorization
    const summarySecret = process.env.SUMMARY_GENERATION_SECRET

    if (!summarySecret) {
      console.error('[Summaries API] SUMMARY_GENERATION_SECRET not configured')
    }

    const auth = requireBearerToken(request, summarySecret, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
    if (!auth.success) {
      if (summarySecret) {
        console.error('[Summaries API] Invalid authorization')
      }
      return auth.response
    }

    // 2. Parse request body
    const parsed = await parseJsonRequest(request, generateSummariesRequestSchema)
    if (!parsed.success) {
      return parsed.response
    }
    const { chatId, userId, provider, modelName, apiKeyId, regenerate } =
      parsed.data as GenerateSummariesRequest

    logSummariesApiDebug('[Summaries API] Request received', {
      chatId,
      provider,
      modelName,
      hasRegenerate: typeof regenerate === 'object' && regenerate !== null,
    })

    const normalizedRegenerate = sanitizeRegeneratePayload(regenerate)

    logSummariesApiDebug('[Summaries API] Normalized regenerate config', {
      chatId,
      normalizedCounts: {
        chunkRanges: normalizedRegenerate?.chunkRanges?.length ?? 0,
        factRanges: normalizedRegenerate?.factRanges?.length ?? 0,
        metaRanges: normalizedRegenerate?.metaRanges?.length ?? 0,
      },
    })

    const supabase = createAdminClient()
    const result = await generateSummariesForChat({
      supabase,
      chatId,
      userId,
      provider,
      modelName,
      apiKeyId,
      regenerate: normalizedRegenerate,
    })

    switch (result.status) {
      case 'chat_not_found':
        return createApiErrorResponse('Chat not found', 404)
      case 'forbidden':
        return createApiErrorResponse('Forbidden', 403)
      case 'summary_generation_failed':
        return createApiErrorResponse('Summary generation failed', 500)
      case 'skipped_no_work':
        return Response.json({
          success: true,
          skipped: true,
          message: 'No summary generation work pending',
        })
      case 'api_key_not_found':
        return createApiErrorResponse('API key not found', 404)
      case 'api_key_not_available':
        return createApiErrorResponse('API key not available', 403)
      case 'api_key_misconfigured':
        return createApiErrorResponse('API key misconfigured', 500)
      case 'unsupported_provider':
        return createApiErrorResponse(`Unsupported provider: ${result.provider}`, 400)
      case 'missing_model_name':
        return createApiErrorResponse('Model name missing', 400)
      case 'decrypt_failed':
        return createApiErrorResponse('Failed to decrypt API key', 500)
      case 'success':
        return Response.json({ success: true, message: 'Summary generation completed' })
      default:
        return createApiErrorResponse('Summary generation failed', 500)
    }
  } catch (error) {
    return createUnexpectedRouteErrorResponse('[Summaries API] Unexpected error:', error)
  }
}

function sanitizeRegeneratePayload(input?: unknown): RegeneratePayload | undefined {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  const regenerate = input as RegeneratePayload

  const chunkRanges = normalizeRangeArray(regenerate.chunkRanges)
  const chunkKeys = new Set(chunkRanges.map((range) => `${range.startSeq}-${range.endSeq}`))
  const factRanges = normalizeRangeArray(regenerate.factRanges).filter(
    (range) => !chunkKeys.has(`${range.startSeq}-${range.endSeq}`),
  )
  const metaRanges = normalizeRangeArray(regenerate.metaRanges)

  if (!chunkRanges.length && !factRanges.length && !metaRanges.length) {
    return undefined
  }

  return { chunkRanges, factRanges, metaRanges }
}

function normalizeRangeArray(ranges?: SummaryRangePayload[] | null): SummaryRangePayload[] {
  if (!Array.isArray(ranges)) {
    return []
  }

  const unique = new Map<string, SummaryRangePayload>()

  for (const candidate of ranges) {
    if (!candidate) {
      continue
    }

    const startSeq = Number(candidate.startSeq)
    const endSeq = Number(candidate.endSeq)

    if (!Number.isFinite(startSeq) || !Number.isFinite(endSeq)) {
      continue
    }

    if (startSeq < 1 || endSeq < startSeq) {
      continue
    }

    const key = `${startSeq}-${endSeq}`
    if (!unique.has(key)) {
      unique.set(key, { startSeq, endSeq })
    }
  }

  return Array.from(unique.values())
}
