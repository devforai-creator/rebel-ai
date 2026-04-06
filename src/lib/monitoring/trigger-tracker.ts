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
  recordSuccess(metadata?: Record<string, unknown>): void
  recordFailure(error: unknown, metadata?: Record<string, unknown>): void
  snapshot(): TriggerStats
  reset(): void
}

export function createTriggerTracker(label: string): TriggerTracker {
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

  return {
    recordSuccess(metadata) {
      state.totalSuccesses += 1
      state.consecutiveFailures = 0
      state.lastSuccessAt = new Date().toISOString()
      state.lastMetadata = metadata ?? null
    },
    recordFailure(error, metadata) {
      state.totalFailures += 1
      state.consecutiveFailures += 1
      state.lastFailureAt = new Date().toISOString()
      state.lastErrorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error)
      state.lastMetadata = metadata ?? null
    },
    snapshot() {
      return { ...state }
    },
    reset() {
      Object.assign(state, initialState)
    },
  }
}
