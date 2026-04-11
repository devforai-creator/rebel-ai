import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createDefaultTriggerStats,
  loadDurableServiceHealthStats,
  SERVICE_HEALTH_LABELS,
  type ServiceHealthLabel,
} from '@/lib/monitoring/service-health-store'
import { getAssistantStreamBroadcastStats } from '@/lib/chat/assistant-stream-monitor'
import { getChatRunnerTriggerStats } from '@/lib/chat/runner-trigger-monitor'
import { getSummaryTriggerStats } from '@/lib/chat/summary-trigger'
import type { TriggerStats } from '@/lib/monitoring/trigger-tracker'

export const runtime = 'nodejs'
export const revalidate = 0
export const maxDuration = 60

const FAILED_JOB_LIMIT = 10

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  if (!adminSecret) {
    console.error('[Triage API] CHAT_ADMIN_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const [healthSnapshot, failedJobsResult] = await Promise.all([
      loadTriageHealthSnapshot(),
      admin
        .from('chat_generation_jobs')
        .select(
          'id, chat_id, status, error, delivery_mode, lifecycle_stage, failure_stage, created_at, updated_at',
        )
        .eq('status', 'error')
        .order('updated_at', { ascending: false })
        .limit(FAILED_JOB_LIMIT),
    ])

    if (failedJobsResult.error) {
      console.error('[Triage API] Failed to load recent failed chat jobs', {
        error: failedJobsResult.error.message,
      })
      return NextResponse.json({ error: 'Failed to load triage snapshot' }, { status: 500 })
    }

    const failedJobs = (failedJobsResult.data ?? []).map((job) => ({
      id: job.id,
      chatId: job.chat_id,
      status: job.status,
      error: job.error,
      deliveryMode: job.delivery_mode,
      lifecycleStage: job.lifecycle_stage,
      failureStage: job.failure_stage,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }))

    const degradedServices = healthSnapshot.services.filter(
      (service) => service.consecutiveFailures > 0,
    )

    const body = {
      status:
        degradedServices.length > 0 || failedJobs.length > 0
          ? ('degraded' as const)
          : ('ok' as const),
      timestamp: new Date().toISOString(),
      healthSource: healthSnapshot.source,
      degradedServices,
      recentFailedJobs: failedJobs,
    }

    return NextResponse.json(body, {
      status: body.status === 'ok' ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[Triage API] Failed to assemble triage snapshot', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function loadTriageHealthSnapshot() {
  const fallbackStats = new Map<ServiceHealthLabel, TriggerStats>([
    ['assistant-stream-broadcast', getAssistantStreamBroadcastStats()],
    ['chat-job-runner-trigger', getChatRunnerTriggerStats()],
    ['summary-generation', getSummaryTriggerStats()],
  ])

  try {
    const durableStats = await loadDurableServiceHealthStats()
    const source = durableStats ? ('durable' as const) : ('memory-fallback' as const)
    const statsMap = durableStats ?? fallbackStats

    return {
      source,
      services: SERVICE_HEALTH_LABELS.map((label) =>
        decorateServiceStats(statsMap.get(label) ?? createDefaultTriggerStats(label)),
      ),
    }
  } catch (error) {
    console.error('[Triage API] Failed to load durable health snapshot', {
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      source: 'memory-fallback' as const,
      services: SERVICE_HEALTH_LABELS.map((label) =>
        decorateServiceStats(fallbackStats.get(label) ?? createDefaultTriggerStats(label)),
      ),
    }
  }
}

function decorateServiceStats(stats: TriggerStats) {
  return {
    label: stats.label,
    status: stats.consecutiveFailures > 0 ? ('degraded' as const) : ('ok' as const),
    totalSuccesses: stats.totalSuccesses,
    totalFailures: stats.totalFailures,
    consecutiveFailures: stats.consecutiveFailures,
    lastSuccessAt: stats.lastSuccessAt,
    lastFailureAt: stats.lastFailureAt,
    lastErrorMessage: stats.lastErrorMessage,
    lastMetadata: stats.lastMetadata,
  }
}
