import { createTriggerTracker } from '@/lib/monitoring/trigger-tracker'

const tracker = createTriggerTracker('chat-job-runner-trigger')

export function recordChatRunnerTriggerSuccess(metadata?: Record<string, unknown>) {
  tracker.recordSuccess(metadata)
}

export function recordChatRunnerTriggerFailure(error: unknown, metadata?: Record<string, unknown>) {
  tracker.recordFailure(error, metadata)
}

export function getChatRunnerTriggerStats() {
  return tracker.snapshot()
}

export function __resetChatRunnerTriggerStatsForTest() {
  tracker.reset()
}
