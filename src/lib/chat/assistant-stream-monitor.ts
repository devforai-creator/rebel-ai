import { createTriggerTracker } from '@/lib/monitoring/trigger-tracker'

const tracker = createTriggerTracker('assistant-stream-broadcast')

export function recordAssistantStreamBroadcastSuccess(metadata?: Record<string, unknown>) {
  tracker.recordSuccess(metadata)
}

export function recordAssistantStreamBroadcastFailure(
  error: unknown,
  metadata?: Record<string, unknown>,
) {
  tracker.recordFailure(error, metadata)
}

export function getAssistantStreamBroadcastStats() {
  return tracker.snapshot()
}

export function __resetAssistantStreamBroadcastStatsForTest() {
  tracker.reset()
}
