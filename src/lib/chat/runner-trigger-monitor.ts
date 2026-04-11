import { createTriggerTracker } from '@/lib/monitoring/trigger-tracker'
import { persistServiceHealthRecord } from '@/lib/monitoring/service-health-store'

const tracker = createTriggerTracker('chat-job-runner-trigger', {
  onRecord(record) {
    return persistServiceHealthRecord({
      label: record.snapshot.label,
      wasSuccess: record.wasSuccess,
      errorMessage: record.errorMessage,
      metadata: record.metadata,
    })
  },
})

export function recordChatRunnerTriggerSuccess(metadata?: Record<string, unknown>) {
  return tracker.recordSuccess(metadata)
}

export function recordChatRunnerTriggerFailure(error: unknown, metadata?: Record<string, unknown>) {
  return tracker.recordFailure(error, metadata)
}

export function getChatRunnerTriggerStats() {
  return tracker.snapshot()
}

export function __resetChatRunnerTriggerStatsForTest() {
  tracker.reset()
}
