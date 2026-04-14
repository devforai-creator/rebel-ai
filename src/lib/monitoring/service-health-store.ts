import { createAdminClient } from '@/lib/supabase/admin'
import { recordServiceHealthStatus } from '@/lib/supabase/rpc'
import type { Database, Json } from '@/types/database.types'
import type { TriggerStats } from '@/lib/monitoring/trigger-tracker'

export const SERVICE_HEALTH_LABELS = [
  'assistant-stream-broadcast',
  'chat-job-lifecycle-persistence',
  'chat-job-runner-trigger',
  'summary-generation',
] as const

export type ServiceHealthLabel = (typeof SERVICE_HEALTH_LABELS)[number]

type ServiceHealthSnapshotRow = Database['public']['Tables']['service_health_status']['Row']

type ServiceHealthReader = Pick<ReturnType<typeof createAdminClient>, 'from'>

function hasAdminEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function createDefaultTriggerStats(label: string): TriggerStats {
  return {
    label,
    totalSuccesses: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    lastMetadata: null,
  }
}

function toJsonObject(value: Json | null): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export async function persistServiceHealthRecord({
  label,
  wasSuccess,
  errorMessage,
  metadata,
}: {
  label: string
  wasSuccess: boolean
  errorMessage: string | null
  metadata: Record<string, unknown> | null
}): Promise<void> {
  if (!hasAdminEnv()) {
    return
  }

  const admin = createAdminClient()
  const { error } = await recordServiceHealthStatus(admin, {
    p_service_label: label,
    p_was_success: wasSuccess,
    p_error_message: errorMessage ?? undefined,
    p_metadata: (metadata ?? null) as Json,
  })

  if (error) {
    throw new Error(`record_service_health_status failed: ${error.message}`)
  }
}

export async function loadDurableServiceHealthStats(): Promise<Map<
  ServiceHealthLabel,
  TriggerStats
> | null> {
  if (!hasAdminEnv()) {
    return null
  }

  const admin = createAdminClient() as ServiceHealthReader
  const { data, error } = await admin
    .from('service_health_status')
    .select(
      'service_label, total_successes, total_failures, consecutive_failures, last_success_at, last_failure_at, last_error_message, last_metadata',
    )
    .in('service_label', [...SERVICE_HEALTH_LABELS])

  if (error) {
    throw new Error(`Failed to load service_health_status: ${error.message}`)
  }

  const statsMap = new Map<ServiceHealthLabel, TriggerStats>()

  for (const row of (data ?? []) as ServiceHealthSnapshotRow[]) {
    if (!SERVICE_HEALTH_LABELS.includes(row.service_label as ServiceHealthLabel)) {
      continue
    }

    statsMap.set(row.service_label as ServiceHealthLabel, {
      label: row.service_label,
      totalSuccesses: Number(row.total_successes ?? 0),
      totalFailures: Number(row.total_failures ?? 0),
      consecutiveFailures: row.consecutive_failures ?? 0,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      lastErrorMessage: row.last_error_message,
      lastMetadata: toJsonObject(row.last_metadata),
    })
  }

  return statsMap
}
