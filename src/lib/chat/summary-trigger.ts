import { createTriggerTracker } from '@/lib/monitoring/trigger-tracker'
import { persistServiceHealthRecord } from '@/lib/monitoring/service-health-store'
import type { LlmProvider } from '@/types/database.types'

type TriggerArgs = {
  origin: string
  chatId: string
  userId: string
  provider: LlmProvider
  modelName: string
  apiKeyId: string
}

type TriggerOptions = {
  fetchImpl?: typeof fetch
}

export type TriggerResult = {
  success: boolean
  error?: string
  attempts?: number
}

const summaryTriggerTracker = createTriggerTracker('summary-generation', {
  onRecord(record) {
    return persistServiceHealthRecord({
      label: record.snapshot.label,
      wasSuccess: record.wasSuccess,
      errorMessage: record.errorMessage,
      metadata: record.metadata,
    })
  },
})

function resolveMaxAttempts(): number {
  const raw = Number(process.env.SUMMARY_TRIGGER_MAX_ATTEMPTS ?? '2')
  if (!Number.isFinite(raw) || raw < 1) {
    return 1
  }
  return Math.min(Math.trunc(raw), 5)
}

function resolveRetryDelayMs(): number {
  const raw = Number(process.env.SUMMARY_TRIGGER_RETRY_DELAY_MS ?? '250')
  if (!Number.isFinite(raw) || raw < 0) {
    return 0
  }
  return raw
}

function buildHeaders(summarySecret: string): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${summarySecret}`,
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  return headers
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function triggerSummaryGeneration(
  args: TriggerArgs,
  options?: TriggerOptions,
): Promise<TriggerResult> {
  const summarySecret = process.env.SUMMARY_GENERATION_SECRET
  if (!summarySecret) {
    console.error('[Chat Job Runner] SUMMARY_GENERATION_SECRET not configured')
    await summaryTriggerTracker.recordFailure('missing summary secret')
    return { success: false, error: 'SUMMARY_GENERATION_SECRET not configured' }
  }

  const fetchImpl = options?.fetchImpl ?? fetch
  const maxAttempts = resolveMaxAttempts()
  const retryDelay = resolveRetryDelayMs()
  const headers = buildHeaders(summarySecret)
  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${args.origin}/api/summaries/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          chatId: args.chatId,
          userId: args.userId,
          provider: args.provider,
          modelName: args.modelName,
          apiKeyId: args.apiKeyId,
        }),
      })

      if (response.ok) {
        await summaryTriggerTracker.recordSuccess({
          attempt,
          status: response.status,
        })
        return { success: true, attempts: attempt }
      }

      const text = await response.text()
      lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`
      console.error('[Chat Job Runner] Summary generation trigger failed', response.status, text)
      await summaryTriggerTracker.recordFailure(
        new Error(`Summary trigger responded with ${response.status}`),
        {
          attempt,
          status: response.status,
        },
      )

      if (attempt < maxAttempts && response.status >= 500) {
        await delay(retryDelay)
        continue
      }

      return { success: false, error: lastError, attempts: attempt }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Network error'
      console.error('[Chat Job Runner] Failed to trigger summary generation', error)
      await summaryTriggerTracker.recordFailure(error, { attempt })
      if (attempt < maxAttempts) {
        await delay(retryDelay)
        continue
      }
    }
  }

  return { success: false, error: lastError ?? 'Max attempts reached', attempts: maxAttempts }
}

export function getSummaryTriggerStats() {
  return summaryTriggerTracker.snapshot()
}

export function __resetSummaryTriggerStatsForTest() {
  summaryTriggerTracker.reset()
}
