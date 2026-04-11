export const CHAT_JOB_LIFECYCLE_STAGE_QUEUED = 'queued'
export const CHAT_JOB_LIFECYCLE_STAGE_DISPATCHING_RUNNER_TRIGGER = 'dispatching_runner_trigger'
export const CHAT_JOB_LIFECYCLE_STAGE_TRIGGER_DISPATCHED = 'trigger_dispatched'
export const CHAT_JOB_LIFECYCLE_STAGE_RUNNER_CLAIMED = 'runner_claimed'
export const CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT = 'loading_context'
export const CHAT_JOB_LIFECYCLE_STAGE_REQUESTING_PROVIDER = 'requesting_provider'
export const CHAT_JOB_LIFECYCLE_STAGE_WAITING_PROVIDER_BATCH = 'waiting_provider_batch'
export const CHAT_JOB_LIFECYCLE_STAGE_POLLING_PROVIDER_BATCH = 'polling_provider_batch'
export const CHAT_JOB_LIFECYCLE_STAGE_STREAMING_RESPONSE = 'streaming_response'
export const CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR = 'provider_stream_error'
export const CHAT_JOB_LIFECYCLE_STAGE_EMPTY_RESPONSE = 'empty_response'
export const CHAT_JOB_LIFECYCLE_STAGE_CONTENT_FILTERED = 'content_filtered'
export const CHAT_JOB_LIFECYCLE_STAGE_POST_PROCESSING = 'post_processing'
export const CHAT_JOB_LIFECYCLE_STAGE_PERSISTING_RESPONSE = 'persisting_response'
export const CHAT_JOB_LIFECYCLE_STAGE_COMPLETED = 'completed'
export const CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD = 'invalid_payload'
export const CHAT_JOB_LIFECYCLE_STAGE_TIMED_OUT = 'timed_out'

export const CHAT_JOB_LIFECYCLE_STAGES = [
  CHAT_JOB_LIFECYCLE_STAGE_QUEUED,
  CHAT_JOB_LIFECYCLE_STAGE_DISPATCHING_RUNNER_TRIGGER,
  CHAT_JOB_LIFECYCLE_STAGE_TRIGGER_DISPATCHED,
  CHAT_JOB_LIFECYCLE_STAGE_RUNNER_CLAIMED,
  CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT,
  CHAT_JOB_LIFECYCLE_STAGE_REQUESTING_PROVIDER,
  CHAT_JOB_LIFECYCLE_STAGE_WAITING_PROVIDER_BATCH,
  CHAT_JOB_LIFECYCLE_STAGE_POLLING_PROVIDER_BATCH,
  CHAT_JOB_LIFECYCLE_STAGE_STREAMING_RESPONSE,
  CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
  CHAT_JOB_LIFECYCLE_STAGE_EMPTY_RESPONSE,
  CHAT_JOB_LIFECYCLE_STAGE_CONTENT_FILTERED,
  CHAT_JOB_LIFECYCLE_STAGE_POST_PROCESSING,
  CHAT_JOB_LIFECYCLE_STAGE_PERSISTING_RESPONSE,
  CHAT_JOB_LIFECYCLE_STAGE_COMPLETED,
  CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD,
  CHAT_JOB_LIFECYCLE_STAGE_TIMED_OUT,
] as const

export type ChatJobLifecycleStage = (typeof CHAT_JOB_LIFECYCLE_STAGES)[number]

const CHAT_JOB_LIFECYCLE_STAGE_LABELS: Record<ChatJobLifecycleStage, string> = {
  queued: 'queue insert',
  dispatching_runner_trigger: 'runner trigger dispatch',
  trigger_dispatched: 'runner trigger handoff',
  runner_claimed: 'runner pickup',
  loading_context: 'context loading',
  requesting_provider: 'provider request',
  waiting_provider_batch: 'provider batch wait',
  polling_provider_batch: 'provider batch poll',
  streaming_response: 'response streaming',
  provider_stream_error: 'provider stream handling',
  empty_response: 'empty provider response',
  content_filtered: 'content filtering',
  post_processing: 'post-processing',
  persisting_response: 'assistant response persistence',
  completed: 'completion',
  invalid_payload: 'payload validation',
  timed_out: 'processing timeout',
}

export function isChatJobLifecycleStage(value: unknown): value is ChatJobLifecycleStage {
  return (
    typeof value === 'string' && CHAT_JOB_LIFECYCLE_STAGES.includes(value as ChatJobLifecycleStage)
  )
}

export function getChatJobLifecycleStageLabel(stage: unknown): string | null {
  if (!isChatJobLifecycleStage(stage)) {
    return null
  }

  return CHAT_JOB_LIFECYCLE_STAGE_LABELS[stage]
}

export function formatChatJobFailureMessage({
  error,
  failureStage,
}: {
  error?: string | null
  failureStage?: unknown
}): string {
  const baseMessage = error || 'Failed to generate response.'
  const stageLabel = getChatJobLifecycleStageLabel(failureStage)

  if (!stageLabel) {
    return baseMessage
  }

  return `Failed during ${stageLabel}: ${baseMessage}`
}
