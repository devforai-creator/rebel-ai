import type { TriggerStats } from './trigger-tracker'

export type ServiceSignalStatus = 'ok' | 'warn' | 'degraded'
export type ExperimentalSignalStatus = 'ok' | 'warn'

const SERVICE_DEGRADATION_THRESHOLDS: Record<string, number> = {
  'assistant-stream-broadcast': 1,
  'chat-job-runner-trigger': 1,
  'chat-job-lifecycle-persistence': 1,
  'summary-generation': 2,
}

export function getServiceSignalStatus(stats: Pick<TriggerStats, 'label' | 'consecutiveFailures'>) {
  if (stats.consecutiveFailures <= 0) {
    return 'ok' satisfies ServiceSignalStatus
  }

  const threshold = SERVICE_DEGRADATION_THRESHOLDS[stats.label] ?? 1
  return stats.consecutiveFailures >= threshold ? 'degraded' : 'warn'
}

export function getExperimentalSignalStatus(
  stats: Pick<TriggerStats, 'consecutiveFailures'>,
): ExperimentalSignalStatus {
  return stats.consecutiveFailures > 0 ? 'warn' : 'ok'
}

export function deriveAggregateSignalStatus(statuses: ServiceSignalStatus[]): ServiceSignalStatus {
  if (statuses.includes('degraded')) {
    return 'degraded'
  }

  if (statuses.includes('warn')) {
    return 'warn'
  }

  return 'ok'
}
