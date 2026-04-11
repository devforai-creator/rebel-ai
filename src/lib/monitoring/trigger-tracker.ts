export type TriggerStats = {
  label: string
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastErrorMessage: string | null
  lastMetadata: Record<string, unknown> | null
}

export type TriggerTracker = {
  recordSuccess(metadata?: Record<string, unknown>): Promise<void>
  recordFailure(error: unknown, metadata?: Record<string, unknown>): Promise<void>
  snapshot(): TriggerStats
  reset(): void
}

type TriggerRecord = {
  errorMessage: string | null
  metadata: Record<string, unknown> | null
  snapshot: TriggerStats
  wasSuccess: boolean
}

type TriggerTrackerOptions = {
  onRecord?: (record: TriggerRecord) => Promise<void> | void
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  return JSON.stringify(error)
}

export function createTriggerTracker(
  label: string,
  options?: TriggerTrackerOptions,
): TriggerTracker {
  const initialState: TriggerStats = {
    label,
    totalSuccesses: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    lastMetadata: null,
  }

  const state: TriggerStats = { ...initialState }

  async function notify(record: TriggerRecord): Promise<void> {
    try {
      await options?.onRecord?.(record)
    } catch (error) {
      console.error('[TriggerTracker] Failed to persist service health record', {
        label,
        wasSuccess: record.wasSuccess,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    async recordSuccess(metadata) {
      state.totalSuccesses += 1
      state.consecutiveFailures = 0
      state.lastSuccessAt = new Date().toISOString()
      state.lastMetadata = metadata ?? null
      state.lastErrorMessage = null

      await notify({
        wasSuccess: true,
        errorMessage: null,
        metadata: metadata ?? null,
        snapshot: { ...state },
      })
    },
    async recordFailure(error, metadata) {
      state.totalFailures += 1
      state.consecutiveFailures += 1
      state.lastFailureAt = new Date().toISOString()
      state.lastErrorMessage = normalizeErrorMessage(error)
      state.lastMetadata = metadata ?? null

      await notify({
        wasSuccess: false,
        errorMessage: state.lastErrorMessage,
        metadata: metadata ?? null,
        snapshot: { ...state },
      })
    },
    snapshot() {
      return { ...state }
    },
    reset() {
      Object.assign(state, initialState)
    },
  }
}
