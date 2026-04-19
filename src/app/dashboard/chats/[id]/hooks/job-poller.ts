/**
 * Job poller - pure function for polling chat job status
 * Extracted for testability with dependency injection
 */

import { formatChatJobFailureMessage } from '@/lib/chat/job-lifecycle'
import { CHAT_JOB_POLLER_LIMITS } from '@/lib/chat/runtime-limits'

export interface JobPollerDeps {
  fetchJobStatus: (jobId: string) => Promise<{
    status: 'pending' | 'processing' | 'success' | 'error'
    error?: string | null
    failureStage?: string | null
  } | null>
  onSuccess: () => Promise<void>
  onError: (error: Error) => void
  /** Called when polling takes longer than expected (e.g., after 30s) */
  onSlowProgress?: (elapsedMs: number) => void
  /**
   * Optional hook for real streaming progress. When present, timeout is measured
   * from the latest known progress timestamp instead of the original poll start.
   */
  getLastProgressAt?: () => number | null
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export interface JobPollerConfig {
  timeoutMs: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  /** Threshold (ms) after which onSlowProgress is called. Default: 30000 (30s) */
  slowProgressThresholdMs?: number
}

export const DEFAULT_JOB_POLLER_CONFIG: JobPollerConfig = {
  timeoutMs: CHAT_JOB_POLLER_LIMITS.timeoutMs,
  initialDelayMs: CHAT_JOB_POLLER_LIMITS.initialDelayMs,
  maxDelayMs: CHAT_JOB_POLLER_LIMITS.maxDelayMs,
  backoffMultiplier: CHAT_JOB_POLLER_LIMITS.backoffMultiplier,
  slowProgressThresholdMs: CHAT_JOB_POLLER_LIMITS.slowProgressThresholdMs,
}

export function resolveAdaptivePollDelay({
  baseDelayMs,
  isPageVisible,
  lastProgressAt,
  now,
  hiddenTabMinDelayMs = CHAT_JOB_POLLER_LIMITS.hiddenTabMinDelayMs,
  recentStreamWindowMs = CHAT_JOB_POLLER_LIMITS.recentStreamWindowMs,
  recentStreamMinDelayMs = CHAT_JOB_POLLER_LIMITS.recentStreamMinDelayMs,
}: {
  baseDelayMs: number
  isPageVisible: boolean
  lastProgressAt: number | null
  now: number
  hiddenTabMinDelayMs?: number
  recentStreamWindowMs?: number
  recentStreamMinDelayMs?: number
}): number {
  let delayMs = Math.max(baseDelayMs, 0)

  if (!isPageVisible) {
    delayMs = Math.max(delayMs, hiddenTabMinDelayMs)
  }

  if (
    typeof lastProgressAt === 'number' &&
    Number.isFinite(lastProgressAt) &&
    now - lastProgressAt <= recentStreamWindowMs
  ) {
    delayMs = Math.max(delayMs, recentStreamMinDelayMs)
  }

  return delayMs
}

export type JobPollerResult =
  | { outcome: 'success' }
  | { outcome: 'error'; error: Error }
  | { outcome: 'timeout'; error: Error }

export async function pollJobStatus(
  jobId: string,
  deps: JobPollerDeps,
  config: JobPollerConfig = DEFAULT_JOB_POLLER_CONFIG,
): Promise<JobPollerResult> {
  const startTime = deps.now()
  let delay = config.initialDelayMs
  let slowProgressNotified = false
  const slowThreshold = config.slowProgressThresholdMs ?? 30_000

  while (true) {
    const currentTime = deps.now()
    const lastProgressAt = deps.getLastProgressAt?.()
    const timeoutReference =
      typeof lastProgressAt === 'number' && Number.isFinite(lastProgressAt)
        ? Math.max(startTime, lastProgressAt)
        : startTime
    const elapsed = currentTime - timeoutReference

    // Check timeout from the last known meaningful progress
    if (elapsed > config.timeoutMs) {
      const seconds = Math.round(config.timeoutMs / 1000)
      const timeoutError = new Error(`Response timed out after ${seconds}s`)
      deps.onError(timeoutError)
      return { outcome: 'timeout', error: timeoutError }
    }

    await deps.sleep(delay)

    // Notify slow progress after sleep (once)
    const elapsedAfterSleep = deps.now() - startTime
    if (!slowProgressNotified && elapsedAfterSleep >= slowThreshold && deps.onSlowProgress) {
      slowProgressNotified = true
      deps.onSlowProgress(elapsedAfterSleep)
    }

    // Backoff: increase delay up to max
    delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs)

    try {
      const job = await deps.fetchJobStatus(jobId)

      if (!job) {
        // Network/server error - continue polling with backoff
        continue
      }

      if (job.status === 'success') {
        await deps.onSuccess()
        return { outcome: 'success' }
      }

      if (job.status === 'error') {
        const jobError = new Error(
          formatChatJobFailureMessage({
            error: job.error,
            failureStage: job.failureStage,
          }),
        )
        deps.onError(jobError)
        return { outcome: 'error', error: jobError }
      }

      // pending or processing - continue polling
    } catch {
      // Network error - continue polling with backoff
    }
  }
}
