'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiErrorMessage } from '@/lib/http/api-contract'
import type { LatestMessageTokenStats, MessageChangePayload } from '../utils'
import { shouldRefreshTokenStats } from '../utils'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseLatestMessageTokenStats(value: unknown): LatestMessageTokenStats | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    provider: typeof value.provider === 'string' ? value.provider : null,
    modelName: typeof value.modelName === 'string' ? value.modelName : null,
    callCount: parseNumberOrNull(value.callCount),
    uncachedPrompt: parseNumberOrNull(value.uncachedPrompt),
    cacheWrite5m: parseNumberOrNull(value.cacheWrite5m),
    cacheWrite1h: parseNumberOrNull(value.cacheWrite1h),
    cacheWrite5mCostUsd: parseNumberOrNull(value.cacheWrite5mCostUsd),
    cacheWrite1hCostUsd: parseNumberOrNull(value.cacheWrite1hCostUsd),
    usageBreakdownAvailable: value.usageBreakdownAvailable === true,
    id: typeof value.id === 'string' ? value.id : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
    total: parseNumberOrNull(value.total),
    prompt: parseNumberOrNull(value.prompt),
    completion: parseNumberOrNull(value.completion),
    cachedPrompt: parseNumberOrNull(value.cachedPrompt),
    cacheHit: value.cacheHit === true,
    cacheKey: typeof value.cacheKey === 'string' ? value.cacheKey : null,
    cacheRetention: typeof value.cacheRetention === 'string' ? value.cacheRetention : null,
    costUsd: parseNumberOrNull(value.costUsd),
    promptCostUsd: parseNumberOrNull(value.promptCostUsd),
    completionCostUsd: parseNumberOrNull(value.completionCostUsd),
    cachedPromptCostUsd: parseNumberOrNull(value.cachedPromptCostUsd),
    reasoningCostUsd: parseNumberOrNull(value.reasoningCostUsd),
  }
}

export function parseLatestUsageStatsResponse(value: unknown): LatestMessageTokenStats | null {
  if (!isRecord(value)) {
    return null
  }

  return parseLatestMessageTokenStats(value.latestMessage)
}

export function useChatUsageStats({
  chatId,
  initialUsageStats,
  enabled,
}: {
  chatId: string
  initialUsageStats: LatestMessageTokenStats | null
  enabled: boolean
}) {
  const [latestUsage, setLatestUsage] = useState<LatestMessageTokenStats | null>(initialUsageStats)
  const [isLoading, setIsLoading] = useState(false)
  const canFetchUsage = enabled
  const requestState = useRef({ version: 0 })

  const fetchLatestUsage = useCallback(async () => {
    if (!canFetchUsage) {
      return
    }

    const state = requestState.current
    const version = ++state.version
    setIsLoading(true)

    try {
      const response = await fetch(`/api/chats/${chatId}/stats`, { cache: 'no-store' })
      if (!response.ok) {
        console.error(
          'Failed to load chat usage stats',
          await readApiErrorMessage(response, 'Failed to load chat usage stats'),
        )
        return
      }

      const result = parseLatestUsageStatsResponse(await response.json())
      if (version === state.version) setLatestUsage(result)
    } catch (error) {
      console.error('Failed to load chat usage stats', error)
    } finally {
      if (version === state.version) setIsLoading(false)
    }
  }, [canFetchUsage, chatId])

  useEffect(() => {
    const state = requestState.current
    setLatestUsage(enabled ? initialUsageStats : null)
    setIsLoading(false)
    return () => {
      state.version++
    }
  }, [enabled, chatId, initialUsageStats])

  useEffect(() => {
    if (canFetchUsage) {
      void fetchLatestUsage()
    }
  }, [canFetchUsage, fetchLatestUsage])

  const handleUsageRealtime = useCallback(
    (payload: MessageChangePayload) => {
      if (shouldRefreshTokenStats(payload)) {
        void fetchLatestUsage()
      }
    },
    [fetchLatestUsage],
  )

  return {
    latestUsage,
    isLoading,
    fetchLatestUsage,
    handleUsageRealtime,
  }
}
