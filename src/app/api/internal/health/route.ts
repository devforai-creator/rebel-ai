import { NextRequest, NextResponse } from 'next/server'
import { getChatRunnerTriggerStats } from '@/lib/chat/runner-trigger-monitor'
import { getSummaryTriggerStats } from '@/lib/chat/summary-trigger'

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

  const chatRunnerStats = getChatRunnerTriggerStats()
  const summaryTriggerStats = getSummaryTriggerStats()

  const responseBody = {
    status: deriveStatus([chatRunnerStats, summaryTriggerStats]),
    timestamp: new Date().toISOString(),
    services: {
      chatRunnerTrigger: decorateServiceStats(chatRunnerStats),
      summaryTrigger: decorateServiceStats(summaryTriggerStats),
    },
  }

  return NextResponse.json(responseBody, {
    status: responseBody.status === 'ok' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

type ServiceStats = {
  label: string
  totalFailures: number
  consecutiveFailures: number
  lastFailureAt: string | null
  lastSuccessAt: string | null
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
