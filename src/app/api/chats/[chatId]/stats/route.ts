import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type LatestAssistantUsage = {
  id: string
  prompt_tokens: number | null
  completion_tokens: number | null
  created_at: string
  sequence: number
  debug_info: Record<string, unknown> | null
}

type LatestUsageCost = {
  prompt_tokens: number | null
  completion_tokens: number | null
  cached_input_tokens: number | null
  reasoning_tokens: number | null
  prompt_cost_usd: number
  completion_cost_usd: number
  cached_input_cost_usd: number
  reasoning_cost_usd: number
  total_cost_usd: number
  created_at: string
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'number') {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: chat } = await supabase
    .from('chats')
    .select('id, user_id')
    .eq('id', chatId)
    .single()

  if (!chat || chat.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fetch counts in parallel with other queries
  const [messageCountResult, summaryCountResult, latestAssistantUsageResult] = await Promise.all([
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .eq('user_id', user.id),
    supabase
      .from('chat_summaries')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId),
    supabase
      .from('messages')
      .select('id, sequence, prompt_tokens, completion_tokens, created_at, debug_info')
      .eq('chat_id', chatId)
      .eq('user_id', user.id)
      .eq('role', 'assistant')
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const messageCount = messageCountResult.count ?? 0
  const summaryCount = summaryCountResult.count ?? 0

  const { data: latestAssistantUsage, error: latestUsageError } = latestAssistantUsageResult as {
    data: LatestAssistantUsage | null
    error: unknown
  }

  if (latestUsageError) {
    console.error('[Chat stats] Failed to load latest message usage', latestUsageError)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }

  const { data: latestUsageEvent, error: latestUsageEventError } = (await supabase
    .from('chat_usage_events')
    .select(
      'prompt_tokens, completion_tokens, cached_input_tokens, reasoning_tokens, prompt_cost_usd, completion_cost_usd, cached_input_cost_usd, reasoning_cost_usd, total_cost_usd, created_at',
    )
    .eq('chat_id', chatId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: LatestUsageCost | null
    error: unknown
  }

  if (latestUsageEventError) {
    console.warn('[Chat stats] Failed to load latest usage event', latestUsageEventError)
  }

  const latestPromptTokens = toNumber(latestAssistantUsage?.prompt_tokens ?? null)
  const latestCompletionTokens = toNumber(latestAssistantUsage?.completion_tokens ?? null)
  const latestTotalTokens =
    latestPromptTokens !== null && latestCompletionTokens !== null
      ? latestPromptTokens + latestCompletionTokens
      : null

  function extractLatestCacheDetails(debugInfo: Record<string, unknown> | null): {
    cachedPromptTokens: number | null
    cacheHit: boolean
    cacheKey: string | null
    cacheRetention: string | null
  } {
    if (!debugInfo || typeof debugInfo !== 'object') {
      return {
        cachedPromptTokens: null,
        cacheHit: false,
        cacheKey: null,
        cacheRetention: null,
      }
    }

    const modelConfig = debugInfo['modelConfig']
    const usage =
      modelConfig && typeof modelConfig === 'object'
        ? (modelConfig as Record<string, unknown>)['usage']
        : null
    const cachedPromptValue =
      usage && typeof usage === 'object'
        ? (usage as Record<string, unknown>)['cachedInputTokens']
        : null
    const cachedPromptTokens = toNumber(cachedPromptValue as number | string | null | undefined)

    const promptCache = debugInfo['promptCache']
    const cacheKey =
      promptCache && typeof promptCache === 'object'
        ? (promptCache as Record<string, unknown>)['key']
        : null
    const cacheRetention =
      promptCache && typeof promptCache === 'object'
        ? (promptCache as Record<string, unknown>)['retention']
        : null

    const cacheHitRaw = debugInfo['cacheHit']
    const cacheHit =
      typeof cacheHitRaw === 'boolean' ? cacheHitRaw : cacheHitRaw === 'true' || cacheHitRaw === '1'

    return {
      cachedPromptTokens,
      cacheHit,
      cacheKey: typeof cacheKey === 'string' ? cacheKey : null,
      cacheRetention: typeof cacheRetention === 'string' ? cacheRetention : null,
    }
  }

  const cacheDetails = latestAssistantUsage
    ? extractLatestCacheDetails(latestAssistantUsage.debug_info ?? null)
    : {
        cachedPromptTokens: null,
        cacheHit: false,
        cacheKey: null,
        cacheRetention: null,
      }

  const latestCachedPromptTokens =
    cacheDetails.cachedPromptTokens !== null
      ? cacheDetails.cachedPromptTokens
      : toNumber(latestUsageEvent?.cached_input_tokens ?? null)

  const latestCost = {
    total: toNumber(latestUsageEvent?.total_cost_usd ?? null),
    prompt: toNumber(latestUsageEvent?.prompt_cost_usd ?? null),
    completion: toNumber(latestUsageEvent?.completion_cost_usd ?? null),
    cachedPrompt: toNumber(latestUsageEvent?.cached_input_cost_usd ?? null),
    reasoning: toNumber(latestUsageEvent?.reasoning_cost_usd ?? null),
  }

  return NextResponse.json({
    messageCount,
    summaryCount,
    latestMessage: latestAssistantUsage
      ? {
          id: latestAssistantUsage.id,
          createdAt: latestAssistantUsage.created_at,
          prompt: latestPromptTokens,
          completion: latestCompletionTokens,
          total: latestTotalTokens,
          cachedPrompt: latestCachedPromptTokens,
          cacheHit: cacheDetails.cacheHit,
          cacheKey: cacheDetails.cacheKey,
          cacheRetention: cacheDetails.cacheRetention,
          costUsd: latestCost.total,
          promptCostUsd: latestCost.prompt,
          completionCostUsd: latestCost.completion,
          cachedPromptCostUsd: latestCost.cachedPrompt,
          reasoningCostUsd: latestCost.reasoning,
        }
      : null,
  })
}
