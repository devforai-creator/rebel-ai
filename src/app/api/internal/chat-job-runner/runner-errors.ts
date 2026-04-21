import type { ChatJobLifecycleStage } from '@/lib/chat/job-lifecycle'
import type { NormalizedProviderError } from '@/lib/llm/provider-error'

export type ChatJobExecutionErrorDetails = {
  normalizedProviderError?: NormalizedProviderError
  streamedTextLength?: number
  googleExplicitCacheToolConflict?: boolean
}

export class ChatJobExecutionError extends Error {
  lifecycleStage: ChatJobLifecycleStage
  details: ChatJobExecutionErrorDetails | null

  constructor(
    message: string,
    lifecycleStage: ChatJobLifecycleStage,
    details: ChatJobExecutionErrorDetails | null = null,
  ) {
    super(message)
    this.name = 'ChatJobExecutionError'
    this.lifecycleStage = lifecycleStage
    this.details = details
  }
}
