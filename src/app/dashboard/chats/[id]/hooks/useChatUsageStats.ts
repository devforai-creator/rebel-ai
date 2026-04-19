'use client'

import { useCallback, useEffect, useState } from 'react'
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
  active,
}: {
  chatId: string
  initialUsageStats: LatestMessageTokenStats | null
  enabled: boolean
  active: boolean
}) {
  const [latestUsage, setLatestUsage] = useState<LatestMessageTokenStats | null>(initialUsageStats)
  const [isLoading, setIsLoading] = useState(false)
  const canFetchUsage = enabled && active

  const fetchLatestUsage = useCallback(async () => {
    if (!canFetchUsage) {
      return
    }

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

      setLatestUsage(parseLatestUsageStatsResponse(await response.json()))
    } catch (error) {
      console.error('Failed to load chat usage stats', error)
    } finally {
      setIsLoading(false)
    }
  }, [canFetchUsage, chatId])

  useEffect(() => {
    setLatestUsage(enabled ? initialUsageStats : null)
  }, [enabled, initialUsageStats])

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
