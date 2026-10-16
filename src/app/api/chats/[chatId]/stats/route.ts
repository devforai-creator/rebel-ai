import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { countProjectedChatMessages, loadLatestProjectedAssistantMessage } from '@/lib/chat/turns'
import { readUsageReceipt, readUsageRequestId } from '@/lib/chat/usage-receipt'

type LatestAssistantUsage = {
  id: string
  prompt_tokens: number | null
  completion_tokens: number | null
  created_at: string
  sequence: number
  debug_info: Record<string, unknown> | null
}

type LatestUsageCost = {
  model_provider: string
  model_name: string | null
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
    countProjectedChatMessages({
      supabase,
      chatId,
    }),
    supabase
      .from('chat_summaries')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId),
    loadLatestProjectedAssistantMessage({
      supabase,
      chatId,
    }),
  ])

  const messageCount = messageCountResult
  const summaryCount = summaryCountResult.count ?? 0

  const latestAssistantUsage = latestAssistantUsageResult as LatestAssistantUsage | null
  const receipt = readUsageReceipt(latestAssistantUsage?.debug_info)
  if (latestAssistantUsage && receipt) {
    const cost = receipt.cost
    return NextResponse.json({
      messageCount,
      summaryCount,
      latestMessage: {
        id: latestAssistantUsage.id,
        createdAt: latestAssistantUsage.created_at,
        provider: receipt.provider,
        modelName: receipt.modelName,
        callCount: receipt.callCount,
        prompt: receipt.input,
        completion: receipt.output,
        total:
          receipt.input !== null && receipt.output !== null ? receipt.input + receipt.output : null,
        uncachedPrompt: receipt.uncachedInput,
        cachedPrompt: receipt.cachedInput,
        cacheWrite5m: receipt.cacheWrite5m,
        cacheWrite1h: receipt.cacheWrite1h,
        cacheHit: (receipt.cachedInput ?? 0) > 0,
        cacheKey: null,
        cacheRetention: null,
        costUsd: cost?.total ?? null,
        promptCostUsd: cost?.input ?? null,
        completionCostUsd: cost?.output ?? null,
        cachedPromptCostUsd: cost?.cacheRead ?? null,
        cacheWrite5mCostUsd: cost?.cacheWrite5m ?? null,
        cacheWrite1hCostUsd: cost?.cacheWrite1h ?? null,
        reasoningCostUsd: cost?.reasoning ?? null,
        usageBreakdownAvailable: true,
      },
    })
  }

  // Old answers may only retain a request ID. Never attach a different
  // request's event just because it is the most recent event in this chat.
  const requestId = readUsageRequestId(latestAssistantUsage?.debug_info)
  const { data: latestUsageEvent, error: latestUsageEventError } = requestId
    ? ((await supabase
        .from('chat_usage_events')
        .select(
          'model_provider, model_name, prompt_tokens, completion_tokens, cached_input_tokens, reasoning_tokens, prompt_cost_usd, completion_cost_usd, cached_input_cost_usd, reasoning_cost_usd, total_cost_usd, created_at',
        )
        .eq('chat_id', chatId)
        .eq('user_id', user.id)
        .eq('request_id', requestId)
        .maybeSingle()) as {
        data: LatestUsageCost | null
        error: unknown
      })
    : { data: null, error: null }

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
          provider: latestUsageEvent?.model_provider ?? null,
          modelName: latestUsageEvent?.model_name ?? null,
          callCount: null,
          createdAt: latestAssistantUsage.created_at,
          prompt: latestPromptTokens,
          completion: latestCompletionTokens,
          total: latestTotalTokens,
          cachedPrompt: latestCachedPromptTokens,
          cacheHit: (latestCachedPromptTokens ?? 0) > 0,
          cacheKey: cacheDetails.cacheKey,
          cacheRetention: cacheDetails.cacheRetention,
          costUsd: latestCost.total,
          promptCostUsd: latestCost.prompt,
          completionCostUsd: latestCost.completion,
          cachedPromptCostUsd: latestCost.cachedPrompt,
          reasoningCostUsd: latestCost.reasoning,
          uncachedPrompt:
            latestUsageEvent?.model_provider === 'anthropic' ? latestPromptTokens : null,
          cacheWrite5m: null,
          cacheWrite1h: null,
          cacheWrite5mCostUsd: null,
          cacheWrite1hCostUsd: null,
          usageBreakdownAvailable: false,
        }
      : null,
  })
}
