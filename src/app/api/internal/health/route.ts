import { NextRequest, NextResponse } from 'next/server'
import { getAssistantStreamBroadcastStats } from '@/lib/chat/assistant-stream-monitor'
import { getChatJobLifecyclePersistenceStats } from '@/lib/chat/job-lifecycle-store'
import { getChatRunnerTriggerStats } from '@/lib/chat/runner-trigger-monitor'
import { getSummaryTriggerStats } from '@/lib/chat/summary-trigger'
import { requireBearerToken } from '@/lib/http/api-contract'
import {
  deriveAggregateSignalStatus,
  getServiceSignalStatus,
  type ServiceSignalStatus,
} from '@/lib/monitoring/service-signal-policy'
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

  const auth = requireBearerToken(req, adminSecret)
  if (!auth.success) {
    return auth.response
  }

  const fallbackStats = {
    assistantStreamBroadcast: getAssistantStreamBroadcastStats(),
    chatJobLifecyclePersistence: getChatJobLifecyclePersistenceStats(),
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
    status: responseBody.status === 'degraded' ? 503 : 200,
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
        chatJobLifecyclePersistence:
          durableStats.get('chat-job-lifecycle-persistence') ??
          fallbackStats.chatJobLifecyclePersistence,
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
  chatJobLifecyclePersistence: TriggerStats
  chatRunnerTrigger: TriggerStats
  summaryTrigger: TriggerStats
}

function deriveStatus(statsList: Array<ServiceStats>): ServiceSignalStatus {
  return deriveAggregateSignalStatus(statsList.map((stats) => getServiceSignalStatus(stats)))
}

function decorateServiceStats(stats: ServiceStats) {
  return {
    ...stats,
    status: getServiceSignalStatus(stats),
  }
}

function decorateServiceMap(services: HealthServiceMap) {
  return {
    assistantStreamBroadcast: decorateServiceStats(services.assistantStreamBroadcast),
    chatJobLifecyclePersistence: decorateServiceStats(services.chatJobLifecyclePersistence),
    chatRunnerTrigger: decorateServiceStats(services.chatRunnerTrigger),
    summaryTrigger: decorateServiceStats(services.summaryTrigger),
  }
}
