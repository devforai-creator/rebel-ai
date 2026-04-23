import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAssistantStreamBroadcastStats } from '@/lib/chat/assistant-stream-monitor'
import { getChatJobLifecyclePersistenceStats } from '@/lib/chat/job-lifecycle-store'
import { getChatRunnerTriggerStats } from '@/lib/chat/runner-trigger-monitor'
import { getSummaryTriggerStats } from '@/lib/chat/summary-trigger'
import { getMessageTranslationTriggerStats } from '@/lib/chat/translation-trigger-monitor'
import { requireBearerToken } from '@/lib/http/api-contract'
import {
  deriveAggregateSignalStatus,
  getExperimentalSignalStatus,
  getServiceSignalStatus,
} from '@/lib/monitoring/service-signal-policy'
import {
  createDefaultTriggerStats,
  loadDurableServiceHealthStats,
  SERVICE_HEALTH_LABELS,
  type ServiceHealthLabel,
} from '@/lib/monitoring/service-health-store'
import type { TriggerStats } from '@/lib/monitoring/trigger-tracker'

export const runtime = 'nodejs'
export const revalidate = 0
export const maxDuration = 60

const FAILED_JOB_LIMIT = 10
const RECENT_FAILED_JOB_WINDOW_HOURS = 72

type RecentFailedJob = {
  id: unknown
  chatId: unknown
  status: unknown
  error: unknown
  deliveryMode: unknown
  lifecycleStage: unknown
  failureStage: unknown
  createdAt: unknown
  updatedAt: unknown
}

function summarizeFailedJobSignal(failedJobs: RecentFailedJob[]) {
  const failureStageCounts = failedJobs.reduce<Record<string, number>>((counts, job) => {
    const stage = typeof job.failureStage === 'string' ? job.failureStage : 'unknown'
    counts[stage] = (counts[stage] ?? 0) + 1
    return counts
  }, {})

  if (failedJobs.length === 0) {
    return {
      status: 'ok' as const,
      blocking: false,
      recentFailedJobCount: 0,
      failureStageCounts,
    }
  }

  return {
    status: 'warn' as const,
    blocking: false,
    recentFailedJobCount: failedJobs.length,
    failureStageCounts,
  }
}

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  if (!adminSecret) {
    console.error('[Triage API] CHAT_ADMIN_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const auth = requireBearerToken(req, adminSecret)
  if (!auth.success) {
    return auth.response
  }

  try {
    const admin = createAdminClient()
    const failedJobsCutoffIso = new Date(
      Date.now() - RECENT_FAILED_JOB_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString()
    const [healthSnapshot, failedJobsResult] = await Promise.all([
      loadTriageHealthSnapshot(),
      admin
        .from('chat_generation_jobs')
        .select(
          'id, chat_id, status, error, delivery_mode, lifecycle_stage, failure_stage, created_at, updated_at',
        )
        .eq('status', 'error')
        .gte('created_at', failedJobsCutoffIso)
        .order('created_at', { ascending: false })
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
      (service) => service.status === 'degraded',
    )
    const warningServices = healthSnapshot.services.filter((service) => service.status === 'warn')
    const translationSignal = decorateExperimentalSignalStats(getMessageTranslationTriggerStats())
    const jobFailureSignal = summarizeFailedJobSignal(failedJobs)

    const body = {
      status: deriveAggregateSignalStatus([
        degradedServices.length > 0 ? 'degraded' : 'ok',
        warningServices.length > 0 || translationSignal.status === 'warn' ? 'warn' : 'ok',
        jobFailureSignal.status,
      ]),
      timestamp: new Date().toISOString(),
      healthSource: healthSnapshot.source,
      warningServices,
      failedJobWindowHours: RECENT_FAILED_JOB_WINDOW_HOURS,
      degradedServices,
      jobFailureSignal,
      experimentalSignals: {
        translationTrigger: translationSignal,
      },
      recentFailedJobs: failedJobs,
    }

    return NextResponse.json(body, {
      status: body.status === 'degraded' ? 503 : 200,
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
    ['chat-job-lifecycle-persistence', getChatJobLifecyclePersistenceStats()],
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
    status: getServiceSignalStatus(stats),
    totalSuccesses: stats.totalSuccesses,
    totalFailures: stats.totalFailures,
    consecutiveFailures: stats.consecutiveFailures,
    lastSuccessAt: stats.lastSuccessAt,
    lastFailureAt: stats.lastFailureAt,
    lastErrorMessage: stats.lastErrorMessage,
    lastMetadata: stats.lastMetadata,
  }
}

function decorateExperimentalSignalStats(stats: TriggerStats) {
  return {
    label: stats.label,
    status: getExperimentalSignalStatus(stats),
    totalSuccesses: stats.totalSuccesses,
    totalFailures: stats.totalFailures,
    consecutiveFailures: stats.consecutiveFailures,
    lastSuccessAt: stats.lastSuccessAt,
    lastFailureAt: stats.lastFailureAt,
    lastErrorMessage: stats.lastErrorMessage,
    lastMetadata: stats.lastMetadata,
  }
}
