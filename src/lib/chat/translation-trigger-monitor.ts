import { createTriggerTracker } from '@/lib/monitoring/trigger-tracker'

const tracker = createTriggerTracker('message-translation-trigger')

export function recordMessageTranslationTriggerSuccess(metadata?: Record<string, unknown>) {
  return tracker.recordSuccess(metadata)
}

export function recordMessageTranslationTriggerFailure(
  error: unknown,
  metadata?: Record<string, unknown>,
) {
  return tracker.recordFailure(error, metadata)
}

export function getMessageTranslationTriggerStats() {
  return tracker.snapshot()
}

export function __resetMessageTranslationTriggerStatsForTest() {
  tracker.reset()
}
