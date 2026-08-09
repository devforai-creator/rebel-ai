export const ACTIVE_QUEUE_JOB_STATUSES = ['pending', 'processing'] as const

export const MAX_ACTIVE_CHAT_JOBS_PER_USER = 3
export const MAX_ACTIVE_IMPORT_JOBS_PER_USER = 1

export const ACTIVE_CHAT_JOB_CONFLICT_MESSAGE =
  'This chat already has a pending or in-progress response.'

export const ACTIVE_CHAT_JOB_CONFLICT_CONSTRAINT = 'chat_generation_jobs_active_chat_idx'
export const CHAT_SUBMISSION_NOT_FOUND_MESSAGE = 'Chat not found'
export const INVALID_REGENERATION_TARGET_MESSAGE = 'Invalid regeneration target'
export const LATEST_REGENERATION_TARGET_MESSAGE =
  'Only the latest assistant message can be regenerated'

export const ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE =
  'You already have an RBX import in progress. Wait for it to finish before starting another import.'

export function buildActiveChatJobLimitMessage(
  limit: number = MAX_ACTIVE_CHAT_JOBS_PER_USER,
): string {
  return `You already have ${limit} active chat responses. Wait for one to finish before sending another message.`
}

type SupabaseLikeError = {
  code?: string | null
  message?: string | null
  details?: string | null
} | null

export function isUniqueViolation(error: SupabaseLikeError): boolean {
  return error?.code === '23505'
}

export function isActiveChatJobConflict(error: SupabaseLikeError): boolean {
  return (
    error?.code === '23505' &&
    `${error.message ?? ''} ${error.details ?? ''}`.includes(ACTIVE_CHAT_JOB_CONFLICT_CONSTRAINT)
  )
}

export function isChatJobUserLimitViolation(error: SupabaseLikeError): boolean {
  return error?.code === 'P0001' && error.message?.includes('active chat generation jobs') === true
}

export function isChatSubmissionNotFound(error: SupabaseLikeError): boolean {
  return error?.code === 'P0002' && error.message === CHAT_SUBMISSION_NOT_FOUND_MESSAGE
}

export function getChatSubmissionValidationMessage(
  error: SupabaseLikeError,
): typeof INVALID_REGENERATION_TARGET_MESSAGE | typeof LATEST_REGENERATION_TARGET_MESSAGE | null {
  if (error?.code !== '22023') {
    return null
  }

  if (error.message === INVALID_REGENERATION_TARGET_MESSAGE) {
    return INVALID_REGENERATION_TARGET_MESSAGE
  }

  if (error.message === LATEST_REGENERATION_TARGET_MESSAGE) {
    return LATEST_REGENERATION_TARGET_MESSAGE
  }

  return null
}
