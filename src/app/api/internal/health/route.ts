import { NextRequest, NextResponse } from 'next/server'
import { getAssistantStreamBroadcastStats } from '@/lib/chat/assistant-stream-monitor'
import { getChatRunnerTriggerStats } from '@/lib/chat/runner-trigger-monitor'
import { getSummaryTriggerStats } from '@/lib/chat/summary-trigger'
import type { TriggerStats } from '@/lib/monitoring/trigger-tracker'
import { loadDurableServiceHealthStats } from '@/lib/monitoring/service-health-store'

export const runtime = 'nodejs'
export const revalidate = 0
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  if (!adminSecret) {
    console.error('[Health API] CHAT_ADMIN_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fallbackStats = {
    assistantStreamBroadcast: getAssistantStreamBroadcastStats(),
    chatRunnerTrigger: getChatRunnerTriggerStats(),
    summaryTrigger: getSummaryTriggerStats(),
  }
  const { services, source } = await resolveHealthServices(fallbackStats)

  const responseBody = {
    status: deriveStatus(Object.values(services)),
    timestamp: new Date().toISOString(),
    healthSource: source,
    services: decorateServiceMap(services),
  }

  return NextResponse.json(responseBody, {
    status: responseBody.status === 'ok' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

async function resolveHealthServices(fallbackStats: HealthServiceMap) {
  try {
    const durableStats = await loadDurableServiceHealthStats()
    if (!durableStats) {
      return {
        services: fallbackStats,
        source: 'memory-fallback' as const,
      }
    }

    return {
      services: {
        assistantStreamBroadcast:
          durableStats.get('assistant-stream-broadcast') ?? fallbackStats.assistantStreamBroadcast,
        chatRunnerTrigger:
          durableStats.get('chat-job-runner-trigger') ?? fallbackStats.chatRunnerTrigger,
        summaryTrigger: durableStats.get('summary-generation') ?? fallbackStats.summaryTrigger,
      },
      source: 'durable' as const,
    }
  } catch (error) {
    console.error('[Health API] Failed to load durable service health state', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      services: fallbackStats,
      source: 'memory-fallback' as const,
    }
  }
}

type ServiceStats = {
  label: string
  totalFailures: number
  consecutiveFailures: number
  lastFailureAt: string | null
  lastSuccessAt: string | null
}

type HealthServiceMap = {
  assistantStreamBroadcast: TriggerStats
  chatRunnerTrigger: TriggerStats
  summaryTrigger: TriggerStats
}

function deriveStatus(statsList: Array<ServiceStats>): 'ok' | 'degraded' {
  const hasConsecutiveFailures = statsList.some((stats) => stats.consecutiveFailures > 0)
  return hasConsecutiveFailures ? 'degraded' : 'ok'
}

function decorateServiceStats(stats: ServiceStats) {
  return {
    ...stats,
    status: stats.consecutiveFailures > 0 ? 'degraded' : 'ok',
  }
}

function decorateServiceMap(services: HealthServiceMap) {
  return {
    assistantStreamBroadcast: decorateServiceStats(services.assistantStreamBroadcast),
    chatRunnerTrigger: decorateServiceStats(services.chatRunnerTrigger),
    summaryTrigger: decorateServiceStats(services.summaryTrigger),
  }
}
