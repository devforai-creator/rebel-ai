import { createTriggerTracker } from '@/lib/monitoring/trigger-tracker'
import { persistServiceHealthRecord } from '@/lib/monitoring/service-health-store'

const tracker = createTriggerTracker('assistant-stream-broadcast', {
  onRecord(record) {
    return persistServiceHealthRecord({
      label: record.snapshot.label,
      wasSuccess: record.wasSuccess,
      errorMessage: record.errorMessage,
      metadata: record.metadata,
    })
  },
})

export function recordAssistantStreamBroadcastSuccess(metadata?: Record<string, unknown>) {
  return tracker.recordSuccess(metadata)
}

export function recordAssistantStreamBroadcastFailure(
  error: unknown,
  metadata?: Record<string, unknown>,
) {
  return tracker.recordFailure(error, metadata)
}

export function getAssistantStreamBroadcastStats() {
  return tracker.snapshot()
}

export function __resetAssistantStreamBroadcastStatsForTest() {
  tracker.reset()
}
