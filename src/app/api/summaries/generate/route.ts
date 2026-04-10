import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasMemoryUpdateWork, updateMemoryState } from '@/lib/chat-memory'
import { normalizeChatModelConfig } from '@/lib/chat/model-config'
import type { ApiServiceTier, Database } from '@/types/database.types'
import { buildLanguageModel } from '@/lib/llm/model-factory'

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

interface GenerateSummariesRequest {
  chatId: string
  userId: string
  provider: string
  modelName: string
  apiKeyId: string
  regenerate?: RegeneratePayload
}

type VaultRpcClient = {
  rpc: (
    fn: 'get_decrypted_secret',
    args: Database['public']['Functions']['get_decrypted_secret']['Args'],
  ) => Promise<{
    data: Database['public']['Functions']['get_decrypted_secret']['Returns'] | null
    error: { message: string; code?: string | null; details?: string | null } | null
  }>
}

export async function POST(request: NextRequest) {
  try {
    // 1. Verify authorization
    const authHeader = request.headers.get('authorization')
    const summarySecret = process.env.SUMMARY_GENERATION_SECRET

    if (!summarySecret) {
      console.error('[Summaries API] SUMMARY_GENERATION_SECRET not configured')
      return NextResponse.json(
        { error: 'Server misconfigured' },
        {
          status: 500,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        },
      )
    }

    if (authHeader !== `Bearer ${summarySecret}`) {
      console.error('[Summaries API] Invalid authorization')
      return NextResponse.json(
        { error: 'Unauthorized' },
        {
          status: 401,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        },
      )
    }

    // 2. Parse request body
    const body = (await request.json()) as GenerateSummariesRequest
    const { chatId, userId, provider, modelName, apiKeyId, regenerate } = body

    logSummariesApiDebug('[Summaries API] Request received', {
      chatId,
      provider,
      modelName,
      hasRegenerate: !!regenerate,
      regenerateCounts: regenerate
        ? {
            chunkRanges: regenerate.chunkRanges?.length ?? 0,
            factRanges: regenerate.factRanges?.length ?? 0,
            metaRanges: regenerate.metaRanges?.length ?? 0,
          }
        : undefined,
    })

    if (!chatId || !userId || !provider || !modelName || !apiKeyId) {
      return NextResponse.json(
        { error: 'Missing required fields: chatId, userId, provider, modelName, apiKeyId' },
        { status: 400 },
      )
    }

    const normalizedRegenerate = sanitizeRegeneratePayload(regenerate)

    logSummariesApiDebug('[Summaries API] Normalized regenerate config', {
      chatId,
      normalizedCounts: {
        chunkRanges: normalizedRegenerate?.chunkRanges?.length ?? 0,
        factRanges: normalizedRegenerate?.factRanges?.length ?? 0,
        metaRanges: normalizedRegenerate?.metaRanges?.length ?? 0,
      },
    })

    // 3. Verify chat ownership with admin client (bypasses RLS)
    const supabase = createAdminClient()

    type ChatOwnership = {
      id: string
      user_id: string
      model_config: unknown
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, user_id, model_config')
      .eq('id', chatId)
      .single<ChatOwnership>()

    if (chatError || !chat) {
      console.error('[Summaries API] Chat not found:', chatError?.message)
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (chat.user_id !== userId) {
      console.error(
        `[Summaries API] Ownership violation: user ${userId} attempted to access chat ${chatId} owned by ${chat.user_id}`,
      )
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const modelConfig = normalizeChatModelConfig(chat.model_config)
    const hasWork = await hasMemoryUpdateWork({
      supabase,
      chatId,
      regenerate: normalizedRegenerate,
      modelConfig,
    })

    if (!hasWork) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'No summary generation work pending',
      })
    }

    // 4. Retrieve and decrypt API key (server-side only)
    type ApiKeyRow = {
      id: string
      user_id: string
      provider: string
      model_preference: string | null
      vault_secret_name: string
      is_active: boolean
      service_tier: ApiServiceTier
    }

    const { data: apiKeyRow, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('id, user_id, provider, model_preference, vault_secret_name, is_active, service_tier')
      .eq('id', apiKeyId)
      .single<ApiKeyRow>()

    if (apiKeyError || !apiKeyRow) {
      console.error('[Summaries API] API key lookup failed:', apiKeyError?.message)
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    if (apiKeyRow.user_id !== userId || !apiKeyRow.is_active) {
      console.error('[Summaries API] API key ownership or status invalid', {
        apiKeyId,
        expectedUser: userId,
        owner: apiKeyRow.user_id,
        isActive: apiKeyRow.is_active,
      })
      return NextResponse.json({ error: 'API key not available' }, { status: 403 })
    }

    if (!apiKeyRow.vault_secret_name) {
      console.error('[Summaries API] API key missing vault secret reference', { apiKeyId })
      return NextResponse.json({ error: 'API key misconfigured' }, { status: 500 })
    }

    const decryptArgs: Database['public']['Functions']['get_decrypted_secret']['Args'] = {
      secret_name: apiKeyRow.vault_secret_name,
      requester: userId,
    }

    const adminRpc = supabase as unknown as VaultRpcClient

    const { data: decryptedKey, error: decryptError } = await adminRpc.rpc(
      'get_decrypted_secret',
      decryptArgs,
    )

    if (decryptError || !decryptedKey) {
      console.error('[Summaries API] Failed to decrypt API key', {
        apiKeyId,
        error: decryptError?.message,
      })
      return NextResponse.json({ error: 'Failed to decrypt API key' }, { status: 500 })
    }

    const resolvedProvider = provider === apiKeyRow.provider ? provider : apiKeyRow.provider
    if (resolvedProvider !== provider) {
      console.warn('[Summaries API] Provider mismatch detected, falling back to stored provider', {
        payloadProvider: provider,
        storedProvider: apiKeyRow.provider,
      })
    }

    const resolvedModelName = modelName || apiKeyRow.model_preference || ''

    if (!resolvedModelName) {
      return NextResponse.json({ error: 'Model name missing' }, { status: 400 })
    }

    // 5. Create model
    let model
    try {
      model = buildLanguageModel({
        provider: resolvedProvider,
        modelName: resolvedModelName,
        apiKey: decryptedKey,
        serviceTier: apiKeyRow.service_tier,
      })
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unsupported provider:')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    // 6. Generate summaries (direct execution)
    // Note: Not using after() - unstable on Vercel due to early container termination after HTTP response
    // Execute directly with await to ensure completion while maintaining HTTP connection
    try {
      await updateMemoryState({
        supabase,
        chatId,
        userId,
        model,
        provider: resolvedProvider,
        modelName: resolvedModelName,
        regenerate: normalizedRegenerate,
        modelConfig,
      })
    } catch (error) {
      console.error('[Summaries API] Summary generation failed:', error)
      const message = error instanceof Error ? error.message : 'Unknown summary generation failure'

      return NextResponse.json(
        { error: 'Summary generation failed', details: message },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, message: 'Summary generation completed' })
  } catch (error) {
    console.error('[Summaries API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function sanitizeRegeneratePayload(
  input?: RegeneratePayload | null,
): RegeneratePayload | undefined {
  if (!input) {
    return undefined
  }

  const chunkRanges = normalizeRangeArray(input.chunkRanges)
  const chunkKeys = new Set(chunkRanges.map((range) => `${range.startSeq}-${range.endSeq}`))
  const factRanges = normalizeRangeArray(input.factRanges).filter(
    (range) => !chunkKeys.has(`${range.startSeq}-${range.endSeq}`),
  )
  const metaRanges = normalizeRangeArray(input.metaRanges)

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
